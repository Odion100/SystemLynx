"use strict";
const HttpClient = require("../../HttpClient/HttpClient")();

const DELEGATE_TTL = 60000; // how long a delegated key is remembered
const LEADER_TTL = 15000; // a leader lease; holders renew by re-electing

// The `Tentacle` is the LoadBalancer's central module — the shared remote that every clone
// routes to via its local `this.clone` handle. It manages service discovery (register +
// round-robin routing), a directory for bulk connectionData, and cluster delegation
// (delegate / broadcast / elect). Methods return values/promises (SystemLynx RPC idiom).
// The module constructor receives the Express `server`.
module.exports = function Tentacle(server) {
  const Tentacle = this;
  Tentacle.services = []; // [{ route, name, locations: [url], index }]
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

  const nextLocation = (service) => {
    service.index = (service.index + 1) % service.locations.length;
    return service.locations[service.index];
  };

  // A location goes stale only if it ever heartbeated and then stopped — clones without the
  // tentacle (no heartbeat) are never staleness-evicted.
  const isStale = (location) => {
    if (!Tentacle.heartbeatTTL) return false;
    const entry = Tentacle.loads.get(location);
    if (!entry || entry.seen === undefined) return false;
    return Date.now() - entry.seen > Tentacle.heartbeatTTL;
  };

  // Pick the location to route to per the active policy, after dropping stale ones.
  const pickLocation = (service) => {
    const stale = new Set(service.locations.filter(isStale));
    if (stale.size) {
      stale.forEach((loc) => {
        Tentacle.loads.delete(loc);
        Tentacle.emit("location_removed", { url: loc, route: service.route, reason: "stale" });
      });
      service.locations = service.locations.filter((loc) => !stale.has(loc));
    }
    if (!service.locations.length) return null;
    if (Tentacle.policy === "least-load")
      return service.locations.reduce((best, loc) =>
        ((Tentacle.loads.get(loc) || {}).load || 0) < ((Tentacle.loads.get(best) || {}).load || 0)
          ? loc
          : best
      );
    return nextLocation(service); // round-robin (default)
  };

  // --- discovery: pick a live location per policy, evicting dead ones safely (terminates) ---
  const routeToClone = (service, req, res) => {
    const url = pickLocation(service);
    if (!url)
      return res
        .status(404)
        .json({ message: `No live clones for ${service.route}`, route: service.route });

    HttpClient.request({ url })
      .then((connData) => {
        // Reconnect must flow back through the LoadBalancer, so a dead clone fails over to a
        // live one rather than retrying the same corpse. Point serviceUrl at the LB route the
        // client used; host/port/namespace still target the chosen clone for the direct
        // connection. (SystemLynx's resetConnection re-fetches from serviceUrl.)
        const proto = req.protocol || "http";
        connData.serviceUrl = `${proto}://${req.headers.host}${service.route}`;
        res.json(connData);
      })
      .catch(() => {
        service.locations = service.locations.filter((location) => location !== url);
        Tentacle.loads.delete(url);
        console.warn(`(LoadBalancer): removed dead clone (${url}) from ${service.route}`);
        Tentacle.emit("location_removed", {
          url,
          route: service.route,
          locations: service.locations,
        });
        routeToClone(service, req, res);
      });
  };

  const addServiceRoute = (service) =>
    server.get(service.route, (req, res) => routeToClone(service, req, res));

  // --- registration: URL-first. The connectionData at the URL is self-describing, so the
  // caller supplies only a url (and an optional alias). The fetch doubles as a liveness check.
  Tentacle.register = async ({ url, name } = {}) => {
    if (!url) return { message: "a url is required to register a clone", status: 400 };
    try {
      const connData = await HttpClient.request({ url });
      const route = connData.route;
      const location = connData.serviceUrl || url;
      let service = Tentacle.services.find((s) => s.route === route);

      if (service) {
        // re-admission: a previously evicted (or new) location rejoins
        if (!service.locations.includes(location)) {
          service.locations.push(location);
          Tentacle.emit("new_clone", { url: location, service });
        }
        return { message: "clone registered", service };
      }

      service = { route, name: name || route, locations: [location], index: -1 };
      Tentacle.services.push(service);
      addServiceRoute(service);
      Tentacle.emit("new_service", { url: location, service });
      Tentacle.emit("new_clone", { url: location, service });
      return { url: location, service };
    } catch (error) {
      return { message: `Failed to reach service @${url}`, status: 502 };
    }
  };

  // --- directory: connectionData for many services in one shot, keyed by name. `only` may
  // be an array or comma string of routes/names; omit (or "all") for every service. ---
  Tentacle.directory = async (only) => {
    const wanted =
      Array.isArray(only) || (typeof only === "string" && only && only !== "all")
        ? new Set(Array.isArray(only) ? only : only.split(","))
        : null;

    const chosen = Tentacle.services
      .filter((s) => s.locations.length && (!wanted || wanted.has(s.route) || wanted.has(s.name)))
      .map((s) => ({ name: s.name, route: s.route, url: nextLocation(s) }));

    const bundle = {};
    await Promise.all(
      chosen.map(async ({ name, route, url }) => {
        try {
          const connData = await HttpClient.request({ url });
          // point reconnect back through the LB (failover) for directory-loaded services too
          if (Tentacle.lbBase) connData.serviceUrl = Tentacle.lbBase + route;
          bundle[name] = connData;
        } catch (error) {
          /* skip a location that failed to answer */
        }
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
};
