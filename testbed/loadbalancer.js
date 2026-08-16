// testbed/loadbalancer.js — run the LoadBalancer as a real SystemLynx service.
//
//   node testbed/loadbalancer.js
//
// Then launch the services (they join this LB). See the other files in testbed/.

const { createLoadBalancer } = require("../index.js");

const PORT = Number(process.env.PORT) || 6300;

const LB = createLoadBalancer();
LB.startService({ route: "loadbalancer", port: PORT });
console.log(`[LoadBalancer] http://localhost:${PORT}/loadbalancer`);
