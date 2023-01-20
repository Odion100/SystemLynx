module.exports = async function loadModules(system, App) {
  system.modules.forEach(
    (mod) => (mod.module = system.Service.module(mod.name, mod.__constructor))
  );

  if (system.routing) await system.Service.startService(system.routing);
  App.emit("ready", system);
};
