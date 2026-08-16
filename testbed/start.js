// testbed/start.js — launch the whole testbed cluster with one command:  npm run testbed
//
// Spawns the LoadBalancer, two Games clones, and Users as SEPARATE processes (each is still a
// normal standalone service — this only starts them together). Ctrl-C tears them all down.
//
// Start the SystemView hub first (`systemview`) so the services register with it.

const { spawn } = require("child_process");
const path = require("path");

const children = [];
const run = (file, env = {}) => {
  const child = spawn(process.execPath, [path.join(__dirname, file)], {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  children.push(child);
};

const shutdown = () => {
  for (const c of children) {
    try {
      c.kill("SIGINT");
    } catch {}
  }
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// LoadBalancer first; then the services a beat later so they register with a live LB.
run("loadbalancer.js");
setTimeout(() => {
  run("games.js", { PORT: "6310" });
  run("games.js", { PORT: "6311" }); // a 2nd Games clone → the LB balances across them
  run("users.js");
}, 1500);
