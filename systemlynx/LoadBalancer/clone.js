"use strict";
const createClient = require("../Client/Client");
const createDispatcher = require("../Dispatcher/Dispatcher");
const HttpClient = require("../HttpClient/HttpClient")();

// The clone-facing subset of the remote Tentacle. Cluster coordination only — the LB-admin
// methods (register/directory) are not exposed on a clone's local handle.
const CLONE_METHODS = ["delegate", "broadcast", "elect", "resign"];

// LoadBalancer.clone(options) → a SystemLynx plugin. A service joins the cluster with:
//
//   App.use(LoadBalancer.clone({ url: "http://host:port/loadbalancer" }));
//
// It connects to the remote LoadBalancer, auto-registers this service, and installs a
// `this[namespace]` handle (default `this.clone`) on every module — plus `App[namespace]`
// as a capturable handle for background/event code. `this.clone.delegate(...)` is the local
// near side; it proxies over the wire to the remote `Tentacle.delegate(...)` that does the work.
//
// Options is an open object (SystemView-plugin shape): `url` (required), `namespace`
// (default "clone"), an optional `name` alias, and any future tunables pass through.
module.exports = function clone(options = {}) {
  // `serviceId` names this service in the cluster (matches the SystemView plugin convention).
  const { url, namespace = "clone", serviceId, ...rest } = options;
  if (!url)
    throw new Error("[LoadBalancer.clone]: `url` (the LoadBalancer to connect to) is required");

  let resolveInstalled, rejectInstalled;
  const installed = new Promise((resolve, reject) => {
    resolveInstalled = resolve;
    rejectInstalled = reject;
  });
  // `installed` settles once the handle is in place (sync); `joined` settles once the service
  // has actually connected to the LoadBalancer and registered.
  let resolveJoined;
  const joined = new Promise((resolve) => (resolveJoined = resolve));
  let lbConnection = null; // the loaded LoadBalancer client, kept for a graceful stop()
  let reportTimer = null;

  const plugin = function cloneTentaclePlugin(App) {
    // In-flight load, tracked via `$all` middleware. Registered in the plugin body (runs
    // before startService), so it lands in every route's middleware chain. `res.finish`
    // decrements on both success and error responses.
    let inFlight = 0;
    App.before("$all", (req, res, next) => {
      inFlight++;
      res.on("finish", () => inFlight--);
      next();
    });

    App.on("ready", function (system) {
      // The handle's methods await the LB connection, so `this.clone.delegate(...)` works
      // even if called before the connection settles.
      let resolveTentacle;
      const tentacleReady = new Promise((resolve) => (resolveTentacle = resolve));
      const handle = CLONE_METHODS.reduce((h, method) => {
        h[method] = async (...args) => (await tentacleReady)[method](...args);
        return h;
      }, {});
      // Local registry for received broadcasts. `this.clone.broadcast(key)` fans out over the
      // cluster; `this.clone.on(key, cb)` is how a clone *receives* one.
      const broadcasts = new createDispatcher();
      handle.on = (key, cb, options) => broadcasts.on(key, cb, options);

      // Synchronous: collision-check and install the handle. Fail loud — never silently
      // clobber a developer's own `clone`.
      try {
        const claim = (owner, label) => {
          if (owner[namespace] !== undefined)
            throw new Error(
              `[LoadBalancer.clone]: ${label} already defines "${namespace}" — rename it or ` +
                `pass { namespace } to LoadBalancer.clone(...)`
            );
          owner[namespace] = handle;
        };
        claim(App, "the App");
        Object.entries(App.getModules()).forEach(([name, module]) =>
          claim(module, `module "${name}"`)
        );
        resolveInstalled(handle);
      } catch (err) {
        // Reject `installed` — await it to handle gracefully; left unhandled it surfaces as
        // a loud unhandled-rejection startup failure. Either way we do not silently clobber.
        rejectInstalled(err);
        return;
      }

      // Async: connect to the LoadBalancer, wire the handle to the remote Tentacle, register.
      (async () => {
        try {
          const lbConnData = await HttpClient.request({ url });
          const lb = createClient().createService(lbConnData);
          lbConnection = lb;
          await new Promise((resolve) => lb.on("connect", resolve));
          resolveTentacle(lb.Tentacle);
          // route cluster broadcasts to this clone's local handlers (this.clone.on(key, cb))
          lb.Tentacle.on("broadcast", ({ key, data } = {}) => broadcasts.emit(key, data));
          await lb.Tentacle.register({
            url: system.connectionData.serviceUrl,
            name: serviceId,
          });
          resolveJoined(handle);
          App.emit("clone_ready", handle);
        } catch (err) {
          console.error(`[LoadBalancer.clone]: failed to join LoadBalancer @${url}\n`, err);
          return;
        }

        // Reporting is separate from joining: push current load (also a heartbeat) immediately
        // and on an interval. Fully swallow its errors — a report firing after shutdown must
        // never surface as a join failure or a stray log. Unref the timer so it can't keep the
        // process alive on its own.
        const location = system.connectionData.serviceUrl;
        const push = () => {
          try {
            lbConnection.Tentacle.report({ location, load: inFlight }).catch(() => {});
          } catch (e) {}
        };
        push();
        reportTimer = setInterval(push, rest.reportInterval || 10000);
        if (reportTimer && reportTimer.unref) reportTimer.unref();
      })();
    });

    return App;
  };

  plugin.installed = installed; // await to catch a namespace collision (or get the handle)
  plugin.joined = joined; // await to know the service has registered with the LoadBalancer
  // Leave the cluster gracefully — stop reporting and drop the LB connection.
  plugin.stop = () => {
    if (reportTimer) clearInterval(reportTimer);
    if (lbConnection && lbConnection.disconnect) lbConnection.disconnect();
  };
  return plugin;
};
