const Dispatcher = require("../../Dispatcher/Dispatcher");

module.exports = async function loadModules(system) {
  system.Modules.forEach(
    (mod) => (mod.module = system.Service.module(mod.name, mod.__constructor))
  );

  if (system.routing) await system.Service.startService(system.routing);
  system.App.emit("ready", system);
};
