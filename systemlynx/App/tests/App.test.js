const { expect } = require("chai");
const createApp = require("../App");
const HttpClient = require("../../HttpClient/HttpClient")();
const createService = require("../../Service/Service");

describe("createApp()", () => {
  it("should return a SystemLynx App", () => {
    const App = createApp();

    expect(App)
      .to.be.an("object")
      .that.has.all.keys(
        "module",
        "on",
        "once",
        "emit",
        "before",
        "after",
        "$clearEvent",
        "destroy",
        "use",
        "startService",
        "loadService",
        "onLoad",
        "config",
        "server",
        "WebSocket",
        "getModule",
        "getModules",
        "Modules",
        "close"
      )
      .that.respondsTo("module")
      .that.respondsTo("getModule")
      .that.respondsTo("getModules")
      .that.respondsTo("Modules")
      .that.respondsTo("on")
      .that.respondsTo("emit")
      .that.respondsTo("$clearEvent")
      .that.respondsTo("before")
      .that.respondsTo("after")
      .that.respondsTo("use")
      .that.respondsTo("startService")
      .that.respondsTo("loadService")
      .that.respondsTo("onLoad")
      .that.respondsTo("config");
  });
});
describe("App: Loading Services", () => {
  it("should be able to use App.loadService(str_url) to load as hosted Service", async () => {
    const Service = createService();
    const route = "test-service";
    const port = "8503";

    Service.module("mod", function () {
      this.test = () => {};
      this.test2 = () => {};
    });

    await Service.startService({ route, port });

    await new Promise((resolve) => {
      const App = createApp();
      App.loadService("test", `http://localhost:${port}/${route}`).on(
        "ready",
        (system) => {
          expect(system.services[0]).to.be.an("object");

          expect(system.services[0].client)
            .to.be.an("object")
            .that.has.all.keys(
              "emit",
              "on",
              "once",
              "$clearEvent",
              "destroy",
              "resetConnection",
              "disconnect",
              "headers",
              "setHeaders",
              "mod"
            )
            .that.respondsTo("emit")
            .that.respondsTo("on")
            .that.respondsTo("$clearEvent")
            .that.respondsTo("resetConnection")
            .that.respondsTo("disconnect")
            .that.respondsTo("headers")
            .that.respondsTo("setHeaders");
          resolve();
        }
      );
    });
  });

  it("should be able to use App.loadService(...).onLoad(handler) to fire a callback when the Service connects", async () => {
    const Service = createService();
    const route = "test-service";
    const port = "8422";
    const url = `http://localhost:${port}/${route}`;

    Service.module("mod", function () {
      this.test = () => {};
      this.test2 = () => {};
    });

    await Service.startService({ route, port });

    await new Promise((resolve) => {
      const App = createApp();
      App.loadService("test", url).onLoad((test) => {
        expect(test)
          .to.be.an("object")
          .that.has.all.keys(
            "emit",
            "on",
            "once",
            "$clearEvent",
            "destroy",
            "resetConnection",
            "disconnect",
            "headers",
            "setHeaders",
            "mod"
          )
          .that.respondsTo("emit")
          .that.respondsTo("$clearEvent")
          .that.respondsTo("on")
          .that.respondsTo("resetConnection")
          .that.respondsTo("disconnect")
          .that.respondsTo("headers")
          .that.respondsTo("setHeaders");
        resolve();
      });
    });
  });

  it('should use App.on("service_loaded[:name]", callback) to fire when a Service has loaded', async () => {
    const Service = createService();
    const route = "test-service";
    const port = "8423";
    const url = `http://localhost:${port}/${route}`;
    Service.module("mod", function () {
      this.test = () => {};
      this.test2 = () => {};
    });

    await Service.startService({ route, port });

    await new Promise((resolve) => {
      const App = createApp();
      App.loadService("test", url);
      App.on("service_loaded", (test) => {
        expect(test)
          .to.be.an("object")
          .that.has.all.keys(
            "emit",
            "on",
            "once",
            "$clearEvent",
            "destroy",
            "resetConnection",
            "disconnect",
            "headers",
            "setHeaders",
            "mod"
          )
          .that.respondsTo("emit")
          .that.respondsTo("$clearEvent")
          .that.respondsTo("on")
          .that.respondsTo("resetConnection")
          .that.respondsTo("headers")
          .that.respondsTo("setHeaders");
      });
      App.on("service_loaded:test", (test) => {
        expect(test)
          .to.be.an("object")
          .that.has.all.keys(
            "emit",
            "on",
            "once",
            "$clearEvent",
            "destroy",
            "resetConnection",
            "disconnect",
            "headers",
            "setHeaders",
            "mod"
          )
          .that.respondsTo("emit")
          .that.respondsTo("$clearEvent")
          .that.respondsTo("on")
          .that.respondsTo("resetConnection")
          .that.respondsTo("headers")
          .that.respondsTo("setHeaders");
        resolve();
      });
    });
  });

  it("should be accessible to SystemObjects via the module.useService method", async () => {
    const Service = createService();
    const route = "test-service";
    const port = "8442";
    const url = `http://localhost:${port}/${route}`;

    Service.module("mod", function () {
      this.test = () => {};
      this.test2 = () => {};
    });

    await Service.startService({ route, port });

    await new Promise((resolve) => {
      const App = createApp();
      App.loadService("test", url)
        .module("module_name", function () {
          const test = this.useService("test");
          expect(test)
            .to.be.an("object")
            .that.has.all.keys(
              "emit",
              "on",
              "once",
              "$clearEvent",
              "destroy",
              "resetConnection",
              "disconnect",
              "headers",
              "setHeaders",
              "mod"
            )
            .that.respondsTo("emit")
            .that.respondsTo("$clearEvent")
            .that.respondsTo("on")
            .that.respondsTo("resetConnection")
            .that.respondsTo("headers")
            .that.respondsTo("setHeaders");
          resolve();
        })
        .on("ready", resolve);
    });
  });
});

describe("App SystemObjects: Initializing Modules,  Modules and configurations", () => {
  it("should be able to use App.module to initialize a module", async () => {
    const App = createApp();
    return new Promise((resolve) =>
      App.module("test", function () {
        expect(this)
          .to.be.an("object")
          .that.has.all.keys(
            "useModule",
            "useService",
            "useConfig",
            "on",
            "once",
            "emit",
            "$clearEvent",
            "destroy",
            "before",
            "after"
          )
          .that.respondsTo("useModule")
          .that.respondsTo("useService")
          .that.respondsTo("useConfig")
          .that.respondsTo("on")
          .that.respondsTo("emit")
          .that.respondsTo("$clearEvent")
          .that.respondsTo("before")
          .that.respondsTo("after");
      }).module("test2", function () {
        expect(this)
          .to.be.an("object")
          .that.has.all.keys(
            "useModule",
            "useService",
            "useConfig",
            "on",
            "once",
            "emit",
            "$clearEvent",
            "destroy",
            "before",
            "after"
          )
          .that.respondsTo("useModule")
          .that.respondsTo("useService")
          .that.respondsTo("useConfig")
          .that.respondsTo("on")
          .that.respondsTo("emit")
          .that.respondsTo("$clearEvent")
          .that.respondsTo("before")
          .that.respondsTo("after");
        resolve();
      })
    );
  });
  it("should be able to use App.startService to start as Service", async () => {
    const App = createApp();
    const route = "test-service";
    const port = "8493";
    const url = `http://localhost:${port}/${route}`;

    await new Promise((resolve) =>
      App.startService({ route, port }).on("ready", resolve)
    );
    const connData = await HttpClient.request({ url });

    expect(connData)
      .to.be.an("Object")
      .that.has.all.keys(
        "SystemLynxService",
        "host",
        "port",
        "modules",
        "route",
        "namespace",
        "serviceUrl",
        "socketPath"
      )
      .that.has.property("modules")
      .that.is.an("array").that.is.empty;
    expect(connData.serviceUrl).to.equal(url);
  });
  it("should be able to use App.module to add a hosted Module to the Service", async () => {
    const App = createApp();
    const route = "test-service";
    const port = "8494";
    const url = `http://localhost:${port}/${route}`;
    await new Promise((resolve) =>
      App.startService({ route, port })
        .module("mod", function () {
          this.test = () => {};
          this.test2 = () => {};
        })
        .module("mod2", function () {
          this.test = () => {};
          this.test2 = () => {};
        })
        .on("ready", resolve)
    );

    const connData = await HttpClient.request({ url });

    expect(connData)
      .to.be.an("Object")
      .that.has.all.keys(
        "SystemLynxService",
        "host",
        "port",
        "modules",
        "route",
        "namespace",
        "serviceUrl",
        "socketPath"
      )
      .that.has.property("modules")
      .that.is.an("array");
    expect(connData.modules).to.have.a.lengthOf(2);
    expect(connData.modules[0])
      .to.be.an("Object")
      .that.has.all.keys("namespace", "route", "name", "methods")
      .that.has.property("methods")
      .that.is.an("array");
    expect(connData.modules[0].methods, [
      { method: "PUT", name: "test" },
      { method: "PUT", name: "test2" },
    ]);
  });

  it('should be able to use App.on("ready", callback) fire a callback when App initialization is complete', async () => {
    const App = createApp();
    const route = "system-test";
    const port = "4242";
    App.startService({ route, port });
    App.module("mod", function () {
      this.test = () => {};
      this.test2 = () => {};
    }).module("mod", function () {
      this.test = () => {};
      this.test2 = () => {};
    });

    await new Promise((resolve) =>
      App.on("ready", (system) => {
        expect(system)
          .to.be.an("object")
          .that.has.all.keys(
            "services",
            "Service",
            "modules",
            "connectionData",
            "configurations",
            "routing"
          );
        resolve();
      })
    );
  });

  it("should expose live modules via App.getModule(name) and App.getModules() after ready", async () => {
    const App = createApp();
    const route = "test-service";
    const port = "8495";

    App.module("mod", function () {
      this.test = () => {};
    }).module("mod2", function () {
      this.test = () => {};
    });

    // before initialization the live module reference does not exist yet
    expect(App.getModule("mod")).to.equal(undefined);
    expect(App.getModules()).to.be.an("object").that.is.empty;

    await new Promise((resolve) => App.startService({ route, port }).on("ready", resolve));

    const mod = App.getModule("mod");
    expect(mod).to.be.an("object").that.respondsTo("on").that.respondsTo("emit");
    expect(App.getModule("missing")).to.equal(undefined);

    const modules = App.getModules();
    expect(modules).to.be.an("object").that.has.all.keys("mod", "mod2");
    expect(modules.mod).to.respondTo("on").that.respondsTo("emit");
  });

  it("should expose callable, this-bound module copies via App.Modules()", async () => {
    const App = createApp();
    const route = "test-service";
    const port = "8497";

    App.module("mod", function () {
      // returns a marker read off `this` — only the live module instance has it
      this.whoAmI = function () {
        return this.__isLiveModule;
      };
      // reports which internal SystemLynx methods are reachable via `this`
      this.reachableContext = function () {
        return {
          useService: typeof this.useService,
          useModule: typeof this.useModule,
          useConfig: typeof this.useConfig,
          emit: typeof this.emit,
          $emit: typeof this.$emit,
          on: typeof this.on,
          once: typeof this.once,
          before: typeof this.before,
          after: typeof this.after,
        };
      };
    });

    await new Promise((resolve) => App.startService({ route, port }).on("ready", resolve));

    const live = App.getModule("mod");
    const bound = App.Modules();
    // marker placed on the live instance AFTER the copies are built, so a copy can
    // only "see" it if its methods are bound to the live module rather than the copy
    live.__isLiveModule = "live";

    expect(bound).to.be.an("object").that.has.all.keys("mod");
    // it is a distinct copy, not the raw handle...
    expect(bound.mod).to.not.equal(live);
    // ...yet its methods run with `this` === the live module
    expect(bound.mod.whoAmI()).to.equal("live");
    // and that holds even when a method is detached from the object (real binding,
    // not call-site `this`)
    const { whoAmI } = bound.mod;
    expect(whoAmI()).to.equal("live");

    // the bound copy exposes the module's built-in SystemLynx methods directly
    expect(bound.mod)
      .to.respondTo("useService")
      .that.respondsTo("useModule")
      .that.respondsTo("useConfig")
      .that.respondsTo("emit")
      .that.respondsTo("$emit")
      .that.respondsTo("on")
      .that.respondsTo("once")
      .that.respondsTo("before")
      .that.respondsTo("after");

    // ...and every one of them is reachable via `this` inside a locally-called method
    expect(bound.mod.reachableContext()).to.deep.equal({
      useService: "function",
      useModule: "function",
      useConfig: "function",
      emit: "function",
      $emit: "function",
      on: "function",
      once: "function",
      before: "function",
      after: "function",
    });
  });

  it("should emit a local 'error' event on the module when a method throws back to the client", async () => {
    const App = createApp();
    const route = "test-service";
    const port = "8496";

    App.module("errMod", function () {
      this.boom = () => {
        throw { status: 400, message: "boom went the method" };
      };
    });

    await new Promise((resolve) => App.startService({ route, port }).on("ready", resolve));

    const errMod = App.getModule("errMod");
    const errorEvent = new Promise((resolve) => errMod.on("error", resolve));

    const url = `http://localhost:${port}/${route}/errMod/boom`;
    try {
      await HttpClient.request({ method: "POST", url, body: { __arguments: [{ x: 1 }] } });
    } catch (e) {
      // expected — the method throws and the error is returned over HTTP
    }

    const info = await errorEvent;
    expect(info)
      .to.be.an("object")
      .that.has.all.keys("module_name", "fn", "arguments", "status", "message", "error");
    expect(info.module_name).to.equal("errMod");
    expect(info.fn).to.equal("boom");
    expect(info.status).to.equal(400);
    expect(info.message).to.equal("boom went the method");
    expect(info.arguments).to.deep.equal([{ x: 1 }]);
  });

  it("should be able to use App.config(constructor) to construct a configuration module", async () => {
    const App = createApp();

    App.module("mod", function () {
      this.test = () => {};
      this.test2 = () => {};
    })
      .module("mod", function () {
        this.test = () => {};
        this.test2 = () => {};
      })
      .config(function (next) {
        this.test = () => {};
        this.test2 = () => {};
        next();
      });

    await new Promise((resolve) =>
      App.on("ready", ({ configurations }) => {
        expect(configurations)
          .to.be.an("object")
          .that.has.all.keys("module", "__constructor")
          .that.has.property("module")
          .that.is.an("object")
          .that.has.all.keys("useService", "useModule", "useConfig", "test", "test2");

        resolve();
      })
    );
  });
});
describe("Use App.use(SystemLynxPlugin), to initializing Modules, and load Services", () => {
  it("should allow for adding new modules and services before app initialization", async () => {
    const Service = createService();
    const route = "test-service";
    const port = "8520";
    const pluginUrl = `http://localhost:${port}/${route}`;
    Service.module("mod", function () {
      this.test = () => {};
      this.test2 = () => {};
    });
    await Service.startService({ route, port });

    const plugin = (App, system) => {
      App.loadService("PluginService", pluginUrl);
      App.module("plugin", { testMethod: (data) => data });
    };
    await new Promise((resolve) => {
      const App = createApp();
      App.module("testModule", { testFunction: () => data })
        .use(plugin)
        .on("ready", (system) => {
          expect(system.services).to.have.lengthOf(1);
          expect(system.services[0]).to.be.an("object");
          expect(system.services[0]).to.have.property("name", "PluginService");
          expect(system.services[0]).to.have.property("url", pluginUrl);
          expect(system.modules).to.have.lengthOf(2);
          expect(system.modules[1]).to.have.property("name", "plugin");
          resolve();
        });
    });
  });
});
describe("SystemContext", () => {
  it("should be able to use this.useModule and this.useService within modules and Module", () => {
    const App = createApp();
    App.module("mod1", function () {
      expect(this)
        .to.be.an("object")
        .that.respondsTo("useService")
        .that.respondsTo("useModule")
        .that.respondsTo("useConfig");

      this.testPassed = true;
    })
      .module("mod2", function () {
        expect(this)
          .to.be.an("object")
          .that.respondsTo("useService")
          .that.respondsTo("useModule")
          .that.respondsTo("useConfig");
        const mod1 = this.useModule("mod1");
        const config = this.useConfig();
        expect(mod1.testPassed).to.equal(true);
        expect(config.configPassed).to.equal(true);
        this.testPassed = true;
      })
      .config(function (next) {
        expect(this)
          .to.be.an("object")
          .that.respondsTo("useService")
          .that.respondsTo("useModule")
          .that.respondsTo("useConfig");
        this.configPassed = true;
        next();
      });
    App.on("ready", function () {
      expect(this)
        .to.be.an("object")
        .that.respondsTo("useService")
        .that.respondsTo("useModule")
        .that.respondsTo("useConfig");
      const mod1 = this.useModule("mod1");
      const config = this.useConfig();
      expect(mod1.testPassed).to.equal(true);
      expect(config.configPassed).to.equal(true);
    });
    App.on("ready", function () {
        expect(this)
          .to.be.an("object")
          .that.respondsTo("useService")
          .that.respondsTo("useModule")
          .that.respondsTo("useConfig");
        const mod2 = this.useModule("mod2");
        const config = this.useConfig();
        expect(mod2.testPassed).to.equal(true);
        expect(config.configPassed).to.equal(true);
      });
    return new Promise((resolve) => App.on("ready", () => resolve()));
  });
  it("[SystemLynx][App][Client][on] should have access to systemContext during event callbacks.", async () => {
    const AppBackend = createApp();
    const eventName = "testing-this";
    const _route = "test-service";
    const _port = "8900";
    const _url = `http://localhost:${_port}/${_route}`;
    AppBackend.module("EventTesterModule", function () {
      this.sendEvent = () => this.emit(eventName, { testPassed: true });

      //testing local event callback context
      this.on(eventName, function () {
        console.log("Aww man... here we go again!", this);
        expect(this)
          .to.be.an("object")
          .that.respondsTo("useService")
          .that.respondsTo("useModule")
          .that.respondsTo("useConfig");
      });
    });
    await AppBackend.startService({ route: _route, port: _port });

    const AppClient = createApp();
    const route = "test-service";
    const port = "8901";

    AppClient.startService({ route, port }).loadService("buAPI", _url);
    await new Promise((resolve) =>
      AppClient.on("ready", function () {
        const { EventTesterModule } = this.useService("buAPI");
        EventTesterModule.on(eventName, function (data, event) {
          console.log("Ladies and gentleman... another one!");
          expect(this)
            .to.be.an("object")
            .that.respondsTo("useService")
            .that.respondsTo("useModule")
            .that.respondsTo("useConfig");
          expect(data).to.deep.equal({ testPassed: true });
          expect(event)
            .to.be.an("object")
            .that.has.all.keys("id", "name", "data", "type");
          expect(event.name).to.equal(eventName);
          expect(event.data).to.deep.equal({ testPassed: true });
          expect(event.id).to.be.a("string");
          expect(event.type).to.equal("WebSocket");
          resolve();
        });
        // small delay so "subscribe" WebSocket message is processed before the HTTP call triggers the emit
        setTimeout(() => EventTesterModule.sendEvent(eventName), 100);
      })
    );
  });
});
