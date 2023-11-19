const loadModules = require("./loadModules");
const loadServices = require("./loadServices");

module.exports = async function initApp(system, App, customClient, systemContext) {
  let configComplete = false;
  const continuationERROR = () => {
    if (!configComplete)
      console.warn(
        `
        continuationERROR: Failed to call next function in App.config() callback 
        
        Fix: Must call next function during App.config( callback(=>next) )
        
        `
      );
  };

  try {
    await loadServices(system, App, customClient, systemContext);
  } catch (err) {
    throw `[SystemLynx][App][Error]: Initialization Error - failed to load all services`;
  }

  if (typeof system.configurations.__constructor === "function") {
    setTimeout(continuationERROR, 0);
    system.configurations.__constructor.apply(system.configurations.module, [
      () => {
        configComplete = true;
        loadModules(system, App);
      },
    ]);
  } else loadModules(system, App);
};
