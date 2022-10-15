const loadModules = require("./loadModules");
const loadServices = require("./loadServices");

module.exports = async function initApp(system) {
  let configComplete = false;
  const continuationERROR = () => {
    if (!configComplete)
      console.warn(
        `
        continuationERROR: Failed to call continuation function in App Configuariotn module 
        
        Fix: Must call next function during App.config( constructor(=>next) )
        
        `
      );
  };

  try {
    await loadServices(system);
  } catch (err) {
    throw `(AppERROR): Initialization Error - failed to load all services`;
  }

  if (typeof system.configurations.__constructor === "function") {
    setTimeout(continuationERROR, 0);
    system.configurations.__constructor.apply(system.configurations.module, [
      () => {
        configComplete = true;
        loadModules(system);
      }
    ]);
  } else loadModules(system);
};
