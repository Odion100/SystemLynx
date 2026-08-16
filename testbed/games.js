// testbed/games.js — a regular SystemLynx service (buAPI style), joined to the LoadBalancer.
//
// Only ONE clone reports to SystemView: the reporter is elected via the LoadBalancer's `delegate`
// (at-most-once, cluster-wide), so two Games clones don't both register with the hub. Both still
// join the cluster and serve traffic — just one carries the observability.
//
//   PORT=6310 node testbed/games.js
//   PORT=6311 node testbed/games.js      # a second clone — LB balances; only one reports
//
// Env: PORT, LB_URL, SYSTEMVIEW_HOST.

const { createApp, createClient, LoadBalancer } = require("../index.js");
const systemview = require("systemview-plugin");

const SERVICE_ID = "Games";
const PORT = Number(process.env.PORT) || 6310;
const LB_URL = process.env.LB_URL || "http://localhost:6300/loadbalancer";
const HUB = process.env.SYSTEMVIEW_HOST || "http://localhost:3000/systemview/api";

// The module — a plain constructor function, methods on `this` (buAPI style).
function Games() {
  this.create = function ({ name = "game" } = {}) {
    return { created: name };
  };
  this.list = function () {
    return { games: [] };
  };
}

async function main() {
  // Elect the single SystemView reporter via the LoadBalancer's `delegate` — the first clone to
  // claim the key wins, the rest skip the plugin. (The plugin connects on `ready`, before
  // `App.clone` exists, so we claim the role directly through the Tentacle up front.)
  let reporter = true;
  try {
    // Retry: start.js launches the LB and the clones together, so the LB is usually not listening
    // yet. Without this both clones fail the lookup, both fall into the standalone branch, and both
    // report — which is exactly the duplicate the delegate is meant to prevent.
    const lb = await createClient().loadService(LB_URL, { limit: 10, wait: 500 });
    reporter = (await lb.Tentacle.delegate(`systemview:${SERVICE_ID}`)).delegated;
  } catch {
    reporter = true; // no LB after retrying — genuinely standalone, so report
  }

  const App = createApp();
  App.startService({ route: SERVICE_ID.toLowerCase(), port: PORT }).module(SERVICE_ID, Games);
  App.use(LoadBalancer.clone({ url: LB_URL, serviceId: SERVICE_ID })); // join the cluster
  if (reporter)
    App.use(systemview({ connection: HUB, projectCode: "systemlynx", serviceId: SERVICE_ID }));

  console.log(
    `[${SERVICE_ID}] :${PORT} — ${reporter ? "SystemView reporter" : "cluster-only (another clone reports)"}`,
  );
}

main();
