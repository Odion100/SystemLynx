"use strict";
module.exports = function SystemObject(system) {
  const App = this || {};
  App.useModule = modName => (system.Modules.find(mod => mod.name === modName) || {}).module || {};
  App.useService = serviceName =>
    (system.Services.find(mod => mod.name === serviceName) || {}).client || {};
  App.useConfig = () => system.configurations.module || {};
  return App;
};
