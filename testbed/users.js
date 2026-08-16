// testbed/users.js — a regular SystemLynx service (buAPI style), joined to the LoadBalancer and
// observed by SystemView. Same reporter-election as games.js (via the LB's `delegate`), so if
// Users is ever cloned only one instance reports.
//
//   node testbed/users.js
//
// Env: PORT (default 6312), LB_URL, SYSTEMVIEW_HOST.

const { createApp, createClient, LoadBalancer } = require("../index.js");
const systemview = require("systemview-plugin");

const SERVICE_ID = "Users";
const PORT = Number(process.env.PORT) || 6312;
const LB_URL = process.env.LB_URL || "http://localhost:6300/loadbalancer";
const HUB = process.env.SYSTEMVIEW_HOST || "http://localhost:3000/systemview/api";

function Users() {
  this.get = function ({ id = "u1" } = {}) {
    return { id, name: "Demo User" };
  };
  this.list = function () {
    return { users: [{ id: "u1", name: "Demo User" }] };
  };
}

async function main() {
  // One SystemView reporter per service, elected via the LoadBalancer's `delegate`.
  let reporter = true;
  try {
    // Same boot race as games.js: retry rather than falling through to "everyone reports".
    const lb = await createClient().loadService(LB_URL, { limit: 10, wait: 500 });
    reporter = (await lb.Tentacle.delegate(`systemview:${SERVICE_ID}`)).delegated;
  } catch {
    reporter = true; // no LB after retrying — genuinely standalone, so report
  }

  const App = createApp();
  App.startService({ route: SERVICE_ID.toLowerCase(), port: PORT }).module(
    SERVICE_ID,
    Users,
  );
  App.use(LoadBalancer.clone({ url: LB_URL, serviceId: SERVICE_ID })); // join the cluster
  if (reporter)
    App.use(
      systemview({ connection: HUB, projectCode: "systemlynx", serviceId: SERVICE_ID }),
    );

  console.log(
    `[${SERVICE_ID}] :${PORT} — ${reporter ? "SystemView reporter" : "cluster-only (another clone reports)"}`,
  );
}

main();
