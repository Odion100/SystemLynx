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
        "emit",
        "before",
        "after",
        "$clearEvent",
        "use",
        "startService",
        "loadService",
        "onLoad",
        "config",
        "server",
        "WebSocket"
      )
      .that.respondsTo("module")
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
              "$clearEvent",
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
            "$clearEvent",
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
      App.loadService("test", url)
        .on("service_loaded", (test) => {
          expect(test)
            .to.be.an("object")
            .that.has.all.keys(
              "emit",
              "on",
              "$clearEvent",
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
        })
        .on("service_loaded:test", (test) => {
          expect(test)
            .to.be.an("object")
            .that.has.all.keys(
              "emit",
              "on",
              "$clearEvent",
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
              "$clearEvent",
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
            "emit",
            "$clearEvent",
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
            "emit",
            "$clearEvent",
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
      })
      .on("ready", function () {
        expect(this)
          .to.be.an("object")
          .that.respondsTo("useService")
          .that.respondsTo("useModule")
          .that.respondsTo("useConfig");
        const mod1 = this.useModule("mod1");
        const config = this.useConfig();
        expect(mod1.testPassed).to.equal(true);
        expect(config.configPassed).to.equal(true);
      })
      .on("ready", function () {
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
        EventTesterModule.sendEvent(eventName);
      })
    );
  });
});
