"use strict";
const HttpClient = require("../../HttpClient/HttpClient")();

const DELEGATE_TTL = 60000; // how long a delegated key is remembered
const LEADER_TTL = 15000; // a leader lease; holders renew by re-electing

// The `Tentacle` is the LoadBalancer's central module — the shared remote that every clone
// routes to via its local `this.clone` handle. It manages service discovery (register +
// per-module routing), a directory for bulk connectionData, and cluster delegation
// (delegate / broadcast / elect). Methods return values/promises (SystemLynx RPC idiom).
// The module constructor receives the Express `server`.
//
// RFC 006 — services are keyed by `serviceId`. Physical members sharing a serviceId (a whole-
// service clone, OR a partial deployment that hosts only some modules) attach into ONE logical
// service served at `/{serviceId}`. On a load the Tentacle COMPOSES the union of modules across
// members, each module entry carrying its own resolved location — so the client gets one service
// whose modules may physically live in several places. When every member hosts the full module
// set (today's whole-service cloning) the union degenerates to the current behavior.
module.exports = function Tentacle(server) {
  const Tentacle = this;
  // [{ serviceId, route: `/${serviceId}`, members: [url], cursors: { module -> index } }]
  Tentacle.services = [];
  Tentacle.delegateTTL = DELEGATE_TTL; // configurable retention for delegated keys
  Tentacle.leaseTTL = LEADER_TTL; // configurable leader lease
  Tentacle.loads = new Map(); // location -> { load, seen } (pushed by clone tentacles)
  Tentacle.policy = "round-robin"; // "round-robin" | "least-load"
  Tentacle.heartbeatTTL = 30000; // ms; evict a location that stops heartbeating (0 = off)
  Tentacle.lbBase = null; // this LoadBalancer's own base URL, learned from the first request

  const delegated = new Map(); // key  -> expiry timestamp
  const leaders = new Map(); // role -> { holderId, expiry }

  // Learn this LoadBalancer's own base URL from the first incoming request, so discovery and
  // directory can point clients' reconnect (serviceUrl) back through the LB for failover.
  server.use((req, res, next) => {
    if (!Tentacle.lbBase) Tentacle.lbBase = `${req.protocol || "http"}://${req.headers.host}`;
    next();
  });

  const pruneExpired = (map) => {
    const now = Date.now();
    for (const [key, value] of map) {
      const expiry = typeof value === "number" ? value : value.expiry;
      if (expiry <= now) map.delete(key);
    }
  };

  const load = (location) => (Tentacle.loads.get(location) || {}).load || 0;

  // A location goes stale only if it ever heartbeated and then stopped — clones without the
  // tentacle (no heartbeat) are never staleness-evicted.
  const isStale = (location) => {
    if (!Tentacle.heartbeatTTL) return false;
    const entry = Tentacle.loads.get(location);
    if (!entry || entry.seen === undefined) return false;
    return Date.now() - entry.seen > Tentacle.heartbeatTTL;
  };

  // Pick, per the active policy, one of `choices` ([{ connData, ... }]) — keeping an independent
  // round-robin cursor under `cursorKey` (per module, or "$primary" for the service-level pick),
  // so each module balances across its own clones and the service-level location balances across
  // full clones (today's whole-service round-robin / least-load).
  const pick = (service, cursorKey, choices) => {
    if (Tentacle.policy === "least-load")
      return choices.reduce((best, c) =>
        load(c.connData.serviceUrl) < load(best.connData.serviceUrl) ? c : best
      );
    const prev = service.cursors[cursorKey];
    const i = ((prev == null ? -1 : prev) + 1) % choices.length;
    service.cursors[cursorKey] = i;
    return choices[i];
  };

  // Fetch every member's live connectionData, evicting stale (stopped heartbeating) and dead
  // (unreachable) members along the way. Returns the surviving [{ location, connData }].
  const gatherMembers = async (service) => {
    const stale = service.members.filter(isStale);
    if (stale.length) {
      const staleSet = new Set(stale);
      staleSet.forEach((loc) => {
        Tentacle.loads.delete(loc);
        Tentacle.emit("location_removed", { url: loc, route: service.route, reason: "stale" });
      });
      service.members = service.members.filter((loc) => !staleSet.has(loc));
    }

    const fetched = await Promise.all(
      service.members.map(async (location) => {
        try {
          return { location, connData: await HttpClient.request({ url: location }) };
        } catch (error) {
          return { location, connData: null };
        }
      })
    );

    const dead = fetched.filter((f) => !f.connData).map((f) => f.location);
    if (dead.length) {
      const deadSet = new Set(dead);
      service.members = service.members.filter((loc) => !deadSet.has(loc));
      deadSet.forEach((loc) => {
        Tentacle.loads.delete(loc);
        console.warn(`(LoadBalancer): removed dead member (${loc}) from ${service.route}`);
        Tentacle.emit("location_removed", {
          url: loc,
          route: service.route,
          locations: service.members,
        });
      });
    }

    return fetched.filter((f) => f.connData);
  };

  // Compose the logical service: the UNION of modules across live members, each module resolved
  // (per policy) to a member that hosts it, with that member's physical location stamped on the
  // module entry (`connectionData`) so the client can reach it directly. Service-level fields
  // come from a primary member (the client's fallback + service-level socket); `serviceUrl`
  // points back through the LB so reconnect re-composes with live members. Self-describing:
  // `serviceId` + `discovery` let any consumer (e.g. SystemView) read the logical→physical map
  // straight from the payload. Returns null when no member is live.
  const composeService = async (service, req) => {
    const live = await gatherMembers(service);
    if (!live.length) return null;

    const moduleHosts = {}; // module name -> [{ mod, connData }]
    live.forEach(({ connData }) =>
      (connData.modules || []).forEach((mod) => {
        (moduleHosts[mod.name] || (moduleHosts[mod.name] = [])).push({ mod, connData });
      })
    );

    const modules = Object.keys(moduleHosts).map((name) => {
      const chosen = pick(service, name, moduleHosts[name]);
      // Local-only observability: which member served this module, under which policy — a
      // co-loaded observer (SystemView inside the LB) watches balance via route_assigned.
      if (typeof Tentacle.$emit === "function")
        Tentacle.$emit("route_assigned", {
          route: service.route,
          module: name,
          location: chosen.connData.serviceUrl,
          policy: Tentacle.policy,
        });
      // Attach the chosen member's physical location so the client points THIS module there.
      return {
        ...chosen.mod,
        connectionData: {
          host: chosen.connData.host,
          port: chosen.connData.port,
          socketPath: chosen.connData.socketPath,
        },
      };
    });

    // Service-level fields (the client's fallback location + the service-level socket) come from a
    // policy-picked "primary" member, so whole-service clones still round-robin / least-load at the
    // service level exactly as before.
    const primary = pick(service, "$primary", live).connData;
    const proto = (req && req.protocol) || "http";
    const base =
      req && req.headers && req.headers.host
        ? `${proto}://${req.headers.host}`
        : Tentacle.lbBase || "";

    return {
      ...primary,
      modules,
      route: service.route,
      serviceUrl: `${base}${service.route}`,
      serviceId: service.serviceId,
      discovery: true,
      SystemLynxService: true,
    };
  };

  const addServiceRoute = (service) =>
    server.get(service.route, async (req, res) => {
      const connData = await composeService(service, req);
      if (!connData)
        return res
          .status(404)
          .json({ message: `No live members for ${service.route}`, route: service.route });
      res.json(connData);
    });

  // --- registration: URL-first. The connectionData at the URL is self-describing, so the
  // caller supplies a url and the `serviceId` this member attaches into (falling back to the
  // member's own route name when omitted, so a lone service still registers). The fetch doubles
  // as a liveness check. Members sharing a serviceId compose into one logical service. ---
  Tentacle.register = async ({ url, serviceId, name } = {}) => {
    if (!url) return { message: "a url is required to register a clone", status: 400 };
    try {
      const connData = await HttpClient.request({ url });
      const id = serviceId || name || (connData.route || "").replace(/^\//, "") || url;
      const location = connData.serviceUrl || url;
      const route = `/${id}`;
      let service = Tentacle.services.find((s) => s.serviceId === id);

      if (service) {
        // re-admission: a previously evicted (or new) member rejoins this logical service
        if (!service.members.includes(location)) {
          service.members.push(location);
          Tentacle.emit("new_clone", { url: location, service });
        }
        return { message: "clone registered", service };
      }

      service = { serviceId: id, route, members: [location], cursors: {} };
      Tentacle.services.push(service);
      addServiceRoute(service);
      Tentacle.emit("new_service", { url: location, service });
      Tentacle.emit("new_clone", { url: location, service });
      return { url: location, service };
    } catch (error) {
      return { message: `Failed to reach service @${url}`, status: 502 };
    }
  };

  // --- directory: composed connectionData for many logical services in one shot, keyed by
  // serviceId. `only` may be an array or comma string of serviceIds/routes; omit (or "all")
  // for every service. Each entry is composed exactly like a direct load. ---
  Tentacle.directory = async (only) => {
    const wanted =
      Array.isArray(only) || (typeof only === "string" && only && only !== "all")
        ? new Set(Array.isArray(only) ? only : only.split(","))
        : null;

    const chosen = Tentacle.services.filter(
      (s) => s.members.length && (!wanted || wanted.has(s.route) || wanted.has(s.serviceId))
    );

    const bundle = {};
    await Promise.all(
      chosen.map(async (service) => {
        const connData = await composeService(service, null);
        if (connData) bundle[service.serviceId] = connData;
      })
    );
    return bundle;
  };

  // --- delegation: exactly one clone proceeds for a given (deterministic, shared) key ---
  // At-most-once: the first caller to claim `key` wins; the rest are told it's handled.
  // Work that must survive a winner crashing should use `elect`, not `delegate`.
  Tentacle.delegate = (key) => {
    if (!key) return { message: "delegate requires a key", status: 400 };
    pruneExpired(delegated);
    if (delegated.has(key)) return { delegated: false, key };
    delegated.set(key, Date.now() + Tentacle.delegateTTL);
    return { delegated: true, key };
  };

  // --- broadcast: every clone acts. Fans the action out as an event all clones subscribe to. ---
  Tentacle.broadcast = (key, data) => {
    if (!key) return { message: "broadcast requires a key", status: 400 };
    Tentacle.emit("broadcast", { key, data });
    return { broadcast: true, key };
  };

  // --- elect: one clone holds a role over time (lease-based). Holders renew by re-electing;
  // if a holder lapses (dies), the next caller wins. This is the durable, crash-safe path. ---
  Tentacle.elect = ({ role, holderId } = {}) => {
    if (!role || !holderId)
      return { message: "elect requires a role and holderId", status: 400 };
    pruneExpired(leaders);
    const current = leaders.get(role);
    const now = Date.now();
    if (!current || current.holderId === holderId || current.expiry <= now) {
      leaders.set(role, { holderId, expiry: now + Tentacle.leaseTTL });
      return { role, leader: true, holderId };
    }
    return { role, leader: false, holderId: current.holderId };
  };

  // --- resign: a leader stepping down cleanly, so another clone can take over
  // immediately instead of waiting for the lease to lapse. ---
  Tentacle.resign = ({ role, holderId } = {}) => {
    const current = leaders.get(role);
    if (current && current.holderId === holderId) {
      leaders.delete(role);
      return { role, resigned: true };
    }
    return { role, resigned: false };
  };

  // --- metrics + health: clone tentacles push these; discovery consults them ---
  // `report` carries current load (and doubles as a heartbeat); `heartbeat` is liveness only.
  Tentacle.report = ({ location, load } = {}) => {
    if (!location) return { ok: false, message: "location required", status: 400 };
    Tentacle.loads.set(location, { load: load || 0, seen: Date.now() });
    return { ok: true };
  };

  Tentacle.heartbeat = ({ location } = {}) => {
    if (!location) return { ok: false, message: "location required", status: 400 };
    const entry = Tentacle.loads.get(location) || { load: 0 };
    entry.seen = Date.now();
    Tentacle.loads.set(location, entry);
    return { ok: true };
  };

  // --- observability: a stable, read-only snapshot of cluster state. External observers (e.g. a
  // SystemView plugin loaded inside the LB) read THIS contract instead of internal fields, so a
  // future rewrite can rename internals without breaking them. Returns copies — mutating the
  // snapshot never touches live state. ---
  Tentacle.getClusterState = () => ({
    policy: Tentacle.policy,
    services: Tentacle.services.map((s) => ({
      serviceId: s.serviceId,
      route: s.route,
      members: s.members.slice(),
    })),
    loads: Array.from(Tentacle.loads.entries()).map(([location, { load, seen }]) => ({
      location,
      load,
      seen,
    })),
    ttls: {
      delegate: Tentacle.delegateTTL,
      lease: Tentacle.leaseTTL,
      heartbeat: Tentacle.heartbeatTTL,
    },
  });
};
