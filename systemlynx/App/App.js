"use strict";
const createService = require("../Service/Service");
const createDispatcher = require("../Dispatcher/Dispatcher");
const initializeApp = require("./components/initializeApp");
const SystemLynxContext = require("../utils/SystemContext");
const System = require("../utils/System");

// Return a callable copy of a module whose methods are bound to the live module,
// so `this` (emit, $emit, useService, useModule, etc.) resolves correctly when the
// method is invoked locally — even if detached from the object. `this.req`/`this.res`
// are undefined for local calls, which the method is expected to handle.
const bindModule = (module) =>
  Object.keys(module).reduce((bound, key) => {
    bound[key] =
      typeof module[key] === "function" ? module[key].bind(module) : module[key];
    return bound;
  }, {});

module.exports = function createApp(server, WebSocket, customClient) {
  const system = new System();
  const systemContext = SystemLynxContext(system);
  const App = new createDispatcher(undefined, systemContext);
  const plugins = [];

  const init = () => {
    plugins.forEach((plugin) => {
      if (typeof plugin === "function") plugin.apply({}, [App, system]);
    });
    initializeApp(system, App, customClient, systemContext);
  };

  let timeoutId = setTimeout(() => {
    timeoutId = null;
    init();
  }, 0);

  system.Service = createService(server, WebSocket, systemContext);
  App.server = system.Service.server;
  App.WebSocket = system.Service.WebSocket;
  App.close = (...args) => system.Service.close(...args);

  App.startService = (options) => {
    system.routing = options;
    if (!timeoutId) {
      timeoutId = setTimeout(() => {
        timeoutId = null;
        init();
      }, 0);
    }
    return App;
  };

  App.module = (name, __constructor) => {
    system.modules.push({ name, __constructor });
    return App;
  };

  // Live module accessors. Modules are constructed during initialization, so the
  // `module` reference only exists after the "ready" event — before that these
  // return undefined / an empty list.
  App.getModule = (name) => {
    const found = system.modules.find((mod) => mod.name === name);
    return found ? found.module : undefined;
  };

  App.getModules = () =>
    system.modules.reduce((obj, { name, module }) => {
      if (module) obj[name] = module;
      return obj;
    }, {});

  // Callable, `this`-bound copies of every module keyed by name — for invoking
  // module methods locally. Use getModule/getModules for the raw live handles.
  App.Modules = () =>
    system.modules.reduce((obj, { name, module }) => {
      if (module) obj[name] = bindModule(module);
      return obj;
    }, {});

  App.before = (...args) => {
    system.Service.before(...args);
    return App;
  };

  App.after = (...args) => {
    system.Service.after(...args);
    return App;
  };

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
