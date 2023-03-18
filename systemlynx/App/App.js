"use strict";
const { isNode } = require("../../utils/ProcessChecker");
const createService = require("../Service/Service");
const createDispatcher = require("../Dispatcher/Dispatcher");
const initializeApp = require("./components/initializeApp");
const SystemLynxContext = require("../utils/SystemContext");
const System = require("../utils/System");

module.exports = function createApp(server, WebSocket, customClient) {
  const system = new System();
  const systemContext = SystemLynxContext(system);
  const App = createDispatcher(undefined, systemContext);
  const plugins = [];
  setTimeout(() => {
    plugins.forEach((plugin) => {
      if (typeof plugin === "function") plugin.apply({}, [App, system]);
    });
    initializeApp(system, App, customClient, systemContext);
  }, 0);

  if (isNode) {
    system.Service = createService(server, WebSocket, systemContext);

    App.startService = (options) => {
      system.routing = options;
      return App;
    };

    App.module = (name, __constructor) => {
      system.modules.push({ name, __constructor });
      return App;
    };

    App.before = system.Service.before;
    App.server = system.Service.server;
    App.WebSocket = system.Service.WebSocket;
  }

  App.loadService = (name, url) => {
    system.services.push({ name, url, onLoad: null, client: {} });
    return App;
  };

  App.onLoad = (handler) => {
    const service = system.services[system.services.length - 1];
    service.onLoad = handler;
    return App;
  };

  App.config = (__constructor) => {
    if (typeof __constructor === "function")
      system.configurations = { __constructor, module: SystemLynxContext(system) };
    else
      throw Error(
        "[SystemLynx][App][Error]: App.config(...) methods requires a constructor function as its first parameter."
      );
    return App;
  };

  App.use = (plugin) => {
    plugins.push(plugin);
    return App;
  };
  return App;
};
