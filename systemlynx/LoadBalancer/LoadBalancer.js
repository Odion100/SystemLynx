"use strict";
const Service = require("../Service/Service");
const Tentacle = require("./components/Tentacle");
const clone = require("./clone");

// The LoadBalancer is a SystemLynx Service whose central `Tentacle` module manages the
// cluster: service discovery, a connectionData directory, and delegation
// (delegate/broadcast/elect). Load balancing falls out for free — clients connect once, so
// round-robin at discovery is the balance.
//
// A service joins the cluster with the `clone` plugin: App.use(LoadBalancer.clone({ url })).
module.exports = function LoadBalancer() {
  const LoadBalancer = Service();
  const Tentacle_module = LoadBalancer.module("Tentacle", Tentacle);
  return { ...LoadBalancer, Tentacle: Tentacle_module, clone };
};
