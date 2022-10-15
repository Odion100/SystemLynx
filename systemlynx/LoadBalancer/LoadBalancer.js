const Service = require("../Service/Service");
const CloneManager = require("./components/CloneManager");
module.exports = function LoadBalancer() {
  const LoadBalancer = Service();
  const clones = LoadBalancer.ServerModule("clones", CloneManager);
  return { ...LoadBalancer, clones };
};
