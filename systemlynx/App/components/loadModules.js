const Dispatcher = require("../../Dispatcher/Dispatcher");

module.exports = async function loadModules(system, App) {
  system.Modules.forEach(
    (mod) => (mod.module = system.Service.module(mod.name, mod.__constructor))
  );

  if (system.routing) await system.Service.startService(system.routing);
  App.emit("ready", system);
};
