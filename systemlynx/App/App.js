"use strict";
const { isNode } = require("../../utils/ProcessChecker");
const ServiceFactory = require("../Service/Service");
const SystemObject = require("./components/SystemObject");
const Dispatcher = require("../Dispatcher/Dispatcher");
const initializeApp = require("./components/initializeApp");

module.exports = function SystemLynxApp() {
  const { on, emit } = Dispatcher();
  const App = { emit };
  const system = { Services: [], Modules: [], configurations: {}, App, routing: null };
  const systemObject = SystemObject(system);
  setTimeout(() => initializeApp(system), 0);

  App.on = (name, callback) => on(name, callback.bind(systemObject));

  if (isNode) {
    system.Service = ServiceFactory();
    system.Service.defaultModule = systemObject;

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
      system.configurations = { __constructor, module: SystemObject(system) };
    else
      throw Error(
        "[SystemLynx][App][Error]: App.config(...) methods requires a constructor function as its first parameter."
      );
    return App;
  };

  return App;
};
