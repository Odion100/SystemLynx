"use strict";
const { isNode } = require("../../utils/ProcessChecker");
const SystemLynxService = require("../Service/Service");
const SystemLynxDispatcher = require("../Dispatcher/Dispatcher");
const initializeApp = require("./components/initializeApp");
const SystemContext = require("../utils/SystemContext");
const System = require("../utils/System");

module.exports = function SystemLynxApp() {
  const system = new System();
  const systemContext = SystemContext(system);
  const App = SystemLynxDispatcher(undefined, systemContext);
  setTimeout(() => initializeApp(system, App, systemContext), 0);

  if (isNode) {
    system.Service = SystemLynxService(systemContext);

    App.startService = (options) => {
      system.routing = options;
      return App;
    };

    App.module = (name, __constructor) => {
      system.Modules.push({
        name,
        __constructor,
      });
      return App;
    };
  }

  App.loadService = (name, url) => {
    system.Services.push({
      name,
      url,
      onLoad: null,
      client: {},
    });
    return App;
  };

  App.onLoad = (handler) => {
    const service = system.Services[system.Services.length - 1];
    service.onLoad = handler;
    return App;
  };

  App.config = (__constructor) => {
    if (typeof __constructor === "function")
      system.configurations = { __constructor, module: SystemContext(system) };
    else
      throw Error(
        "[SystemLynx][App][Error]: App.config(...) methods requires a constructor function as its first parameter."
      );
    return App;
  };

  return App;
};
