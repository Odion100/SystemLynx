const { expect } = require("chai");
const SystemLynxApp = require("../App");
const HttpClient = require("../../HttpClient/HttpClient")();
const SystemLynxService = require("../../Service/Service");

describe("SystemLynxApp()", () => {
  it("should return a SystemLynx App", () => {
    const App = SystemLynxApp();

    expect(App)
      .to.be.an("object")
      .that.has.all.keys(
        "module",
        "on",
        "emit",
        "startService",
        "loadService",
        "onLoad",
        "config"
      )
      .that.respondsTo("module")
      .that.respondsTo("on")
      .that.respondsTo("emit")
      .that.respondsTo("startService")
      .that.respondsTo("loadService")
      .that.respondsTo("onLoad")
      .that.respondsTo("config");
  });
});
describe("App: Loading Services", () => {
  it("should be able to use App.loadService(str_url) to load as hosted Service", async () => {
    const Service = SystemLynxService();
    const route = "test-service";
    const port = "8503";

    Service.module("mod", function () {
      this.test = () => {};
      this.test2 = () => {};
    });

    await Service.startService({ route, port });

    await new Promise((resolve) => {
      const App = SystemLynxApp();
      App.loadService("test", `http://localhost:${port}/${route}`).on(
        "ready",
        (system) => {
          expect(system.Services[0]).to.be.an("object");

          expect(system.Services[0].client)
            .to.be.an("object")
            .that.has.all.keys("emit", "on", "resetConnection", "disconnect", "mod")
            .that.respondsTo("emit")
            .that.respondsTo("on")
            .that.respondsTo("resetConnection")
            .that.respondsTo("disconnect");
          resolve();
        }
      );
    });
  });

  it("should be able to use App.loadService(...).onLoad(handler) to fire a callback when the Service connects", async () => {
    const Service = SystemLynxService();
    const route = "test-service";
    const port = "8422";
    const url = `http://localhost:${port}/${route}`;

    Service.module("mod", function () {
      this.test = () => {};
      this.test2 = () => {};
    });

    await Service.startService({ route, port });

    await new Promise((resolve) => {
      const App = SystemLynxApp();
      App.loadService("test", url).onLoad((test) => {
        expect(test)
          .to.be.an("object")
          .that.has.all.keys("emit", "on", "resetConnection", "disconnect", "mod")
          .that.respondsTo("emit")
          .that.respondsTo("on")
          .that.respondsTo("resetConnection")
          .that.respondsTo("disconnect");
        resolve();
      });
    });
  });

  it('should use App.on("service_loaded[:name]", callback) to fire when a Service has loaded', async () => {
    const Service = SystemLynxService();
    const route = "test-service";
    const port = "8423";
    const url = `http://localhost:${port}/${route}`;
    Service.module("mod", function () {
      this.test = () => {};
      this.test2 = () => {};
    });

    await Service.startService({ route, port });

    await new Promise((resolve) => {
      const App = SystemLynxApp();
      App.loadService("test", url)
        .on("service_loaded", (test) => {
          expect(test)
            .to.be.an("object")
            .that.has.all.keys("emit", "on", "resetConnection", "disconnect", "mod")
            .that.respondsTo("emit")
            .that.respondsTo("on")
            .that.respondsTo("resetConnection");
        })
        .on("service_loaded:test", (test) => {
          expect(test)
            .to.be.an("object")
            .that.has.all.keys("emit", "on", "resetConnection", "disconnect", "mod")
            .that.respondsTo("emit")
            .that.respondsTo("on")
            .that.respondsTo("resetConnection");
          resolve();
        });
    });
  });

  it("should be accessible to SystemObjects via the module.useService method", async () => {
    const Service = SystemLynxService();
    const route = "test-service";
    const port = "8442";
    const url = `http://localhost:${port}/${route}`;

    Service.module("mod", function () {
      this.test = () => {};
      this.test2 = () => {};
    });

    await Service.startService({ route, port });

    await new Promise((resolve) => {
      const App = SystemLynxApp();
      App.loadService("test", url)
        .module("module_name", function () {
          const test = this.useService("test");
          expect(test)
            .to.be.an("object")
            .that.has.all.keys("emit", "on", "resetConnection", "disconnect", "mod")
            .that.respondsTo("emit")
            .that.respondsTo("on")
            .that.respondsTo("resetConnection");
          resolve();
        })
        .on("ready", resolve);
    });
  });
});

describe("App SystemObjects: Initializing Modules,  Modules and configurations", () => {
  it("should be able to use App.module to initialize a module", async () => {
    const App = SystemLynxApp();
    return new Promise((resolve) =>
      App.module("test", function () {
        expect(this)
          .to.be.an("object")
          .that.has.all.keys("useModule", "useService", "useConfig", "on", "emit")
          .that.respondsTo("useModule")
          .that.respondsTo("useService")
          .that.respondsTo("useConfig")
          .that.respondsTo("on")
          .that.respondsTo("emit");
      }).module("test2", function () {
        expect(this)
          .to.be.an("object")
          .that.has.all.keys("useModule", "useService", "useConfig", "on", "emit")
          .that.respondsTo("useModule")
          .that.respondsTo("useService")
          .that.respondsTo("useConfig")
          .that.respondsTo("on")
          .that.respondsTo("emit");
        resolve();
      })
    );
  });
  it("should be able to use App.startService to start as Service", async () => {
    const App = SystemLynxApp();
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
        "serviceUrl"
      )
      .that.has.property("modules")
      .that.is.an("array").that.is.empty;
    expect(connData.serviceUrl).to.equal(url);
  });
  it("should be able to use App.module to add a hosted Module to the Service", async () => {
    const App = SystemLynxApp();
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
        "serviceUrl"
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
    const App = SystemLynxApp();

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
            "Services",
            "Service",
            "Modules",
            "configurations",
            "routing"
          );
        resolve();
      })
    );
  });

  it("should be able to use App.config(constructor) to construct a configuration module", async () => {
    const App = SystemLynxApp();

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

describe("SystemContext", () => {
  it("should be able to use this.useModule and this.useService within modules and Module", () => {
    const App = SystemLynxApp();
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
    const AppBackend = SystemLynxApp();
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

    const AppClient = SystemLynxApp();
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
