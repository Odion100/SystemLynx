"use strict";
const { isNode } = require("../../utils/ProcessChecker");
const ServiceFactory = require("../Service/Service");
const SystemObject = require("./components/SystemObject");
const Dispatcher = require("../Dispatcher/Dispatcher");
const initializeApp = require("./components/initializeApp");

module.exports = function SystemLynxApp() {
  const App = Dispatcher();
  const system = {
    Services: [],
    Modules: [],
    ServerModules: [],
    configurations: {},
    App,
    routing: null,
  };
  SystemObject.apply(system, [system]);
  setTimeout(() => initializeApp(system), 0);

  if (isNode) {
    system.Service = ServiceFactory();
    system.Service.defaultModule = SystemObject(system);

    App.startService = (options) => {
      system.routing = options;
      return App;
    };

    App.ServerModule = (name, __constructor) => {
      system.ServerModules.push({
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

  App.module = (name, __constructor) => {
    system.Modules.push({
      name,
      __constructor,
      module: SystemObject(system),
    });
    return App;
  };

  App.config = (__constructor) => {
    if (typeof __constructor === "function")
      system.configurations = { __constructor, module: SystemObject(system) };
    else
      throw Error(
        "[SystemLynx][App][Error]: App.config(...) methods requires a constructor function as its first parameter."
      );
    return App;
  };

  return App;
};
