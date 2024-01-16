module.exports = async function loadModules(system, App) {
  system.modules.forEach(
    (mod) => (mod.module = system.Service.module(mod.name, mod.__constructor))
  );

  if (system.routing) {
    system.connectionData = await system.Service.startService(system.routing);
  }
  system.modules.forEach((mod) => mod.module.emit("ready"));
  App.emit("ready", system);
};
