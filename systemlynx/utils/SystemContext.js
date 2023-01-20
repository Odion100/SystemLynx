"use strict";
module.exports = function SystemObject(system) {
  const context = this || {};
  context.useModule = (modName) =>
    (system.modules.find((mod) => mod.name === modName) || {}).module || {};
  context.useService = (serviceName) =>
    (system.services.find((mod) => mod.name === serviceName) || {}).client || {};
  context.useConfig = () => system.configurations.module || {};
  return context;
};
