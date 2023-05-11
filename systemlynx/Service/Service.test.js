const { expect } = require("chai");
const request = require("request");
const createService = require("./Service");
const createClient = require("../Client/Client");
describe("createService", () => {
  it("should return a new instance of a Service", () => {
    const Service = createService();
    expect(Service)
      .to.be.an("object")
      .that.has.all.keys("startService", "module", "server", "WebSocket", "before")
      .that.respondsTo("startService")
      .that.respondsTo("module")
      .that.respondsTo("before");
  });
});

describe("Service factory", () => {
  it("should be able to use Service.startService to initiate a ServerManager instance that hosts the Service Connection Data", async () => {
    const Service = createService();
    const route = "/testService";
    const port = 5500;
    const url = `http://localhost:${port}${route}`;

    await Service.startService({ route, port });
    const results = await new Promise((resolve) => {
      request({ url, json: true }, (err, res, body) => {
        resolve(body);
      });
    });

    expect(results)
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
  });

  it("should throw an Error if the first parameter (the constructor function) is not a normal function or object", () => {});
  it("should throw an Error if Service.startService(options) is called twice", () => {});
});

describe("Service.module(constructor)", () => {
  const Service = createService();
  const port = 6542;
  const route = "test/service";
  const url = `http://localhost:${port}/${route}`;

  it("should be able to return a Service instance constructed using the 'this' value in the constructor function", () => {
    const mod = Service.module("mod", function () {
      this.test = () => {};
      this.test2 = () => {};
    });

    expect(mod)
      .to.be.an("Object")
      .that.has.all.keys("on", "emit", "$clearEvent", "before", "test", "test2")
      .that.respondsTo("on")
      .that.respondsTo("emit")
      .that.respondsTo("$clearEvent")
      .that.respondsTo("before")
      .that.respondsTo("test")
      .that.respondsTo("test2");
  });
  it("should 'Serve' Service connection data", async () => {
    await Service.startService({ route, port });

    const results = await new Promise((resolve) =>
      request({ url, json: true }, (err, res, body) => resolve(body))
    );

    expect(results)
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
    expect(results.modules[0])
      .to.be.an("Object")
      .that.has.all.keys("namespace", "route", "name", "methods")
      .that.has.property("methods")
      .that.is.an("Array");
    expect(results.modules[0].methods, [
      { method: "PUT", name: "test" },
      { method: "PUT", name: "test2" },
    ]);
    expect(results.modules[0].name, "mod");
    expect(results.modules[0].route).to.be.a("String");
    expect(results.modules[0].namespace).to.match(
      new RegExp("https?://localhost:\\d+/.+")
    );
    expect(results.SystemLynxServerService, {
      serviceUrl: "localhost:6542/test/service",
    });
    expect(results.host, "localhost");
    expect(results.port, port);
  });
});

describe("Service.module(object)", () => {
  const Service = createService();
  const port = 6543;
  const route = "test/service2";
  const url = `http://localhost:${port}/${route}`;
  it("should return a ServerModule instance created using an object as the constructor", () => {
    const mod = Service.module("mod", {
      action1: function () {
        const { req } = this;
        const { beforeAction1, beforeAction12, beforeModule, beforeService } = req;
        return {
          beforeAction1,
          beforeModule,
          beforeService,
          beforeAction12,
        };
      },
      action2: function () {
        const { req } = this;
        const { beforeAction1, beforeModule, beforeService } = req;
        return { beforeAction1, beforeModule, beforeService };
      },
    });
    Service.module("mod2", function () {
      this.action3 = function () {
        const { req } = this;
        const { beforeAction3, beforeModule, beforeService } = req;
        return { beforeAction3, beforeModule, beforeService };
      };
      this.before("action3", (req, res, next) => {
        req.beforeAction3 = true;
        next();
      });
    });
    mod.before(
      "action1",
      (req, res, next) => {
        req.beforeAction1 = true;
        next();
      },
      (req, res, next) => {
        req.beforeAction12 = true;
        next();
      }
    );

    mod.before((req, res, next) => {
      req.beforeModule = true;
      next();
    });

    Service.before((req, res, next) => {
      req.beforeService = true;
      next();
    });
    expect(mod)
      .to.be.an("Object")
      .that.has.all.keys("action1", "action2", "on", "emit", "$clearEvent", "before")
      .that.respondsTo("action1")
      .that.respondsTo("action2")
      .that.respondsTo("on")
      .that.respondsTo("emit")
      .that.respondsTo("$clearEvent")
      .that.respondsTo("before");
  });
  it("should 'Serve' Service connection data created using an object as the constructor", async () => {
    await Service.startService({ route, port });

    const results = await new Promise((resolve) =>
      request({ url, json: true }, (err, res, body) => resolve(body))
    );

    expect(results)
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
    expect(results.modules[0])
      .to.be.an("Object")
      .that.has.all.keys("namespace", "route", "name", "methods")
      .that.has.property("methods")
      .that.is.an("Array");
    expect(results.modules[0].methods, [
      { method: "PUT", name: "test" },
      { method: "PUT", name: "test2" },
    ]);
    expect(results.modules[0].name, "mod");
    expect(results.modules[0].route).to.be.a("String");
    expect(results.modules[0].namespace).to.match(
      new RegExp("https?://localhost:\\d+/.+")
    );
    expect(results.SystemLynxServerService, {
      serviceUrl: "localhost:6542/test/service",
    });
    expect(results.host, "localhost");
    expect(results.port, port);
  });

  it("should use SeverModule.before method to add a route handler before a target method", async () => {
    const Client = createClient();
    const { mod, mod2 } = await Client.loadService(url);
    const result = await mod.action1();
    expect(result).to.deep.equal({
      beforeAction1: true,
      beforeAction12: true,
      beforeModule: true,
      beforeService: true,
    });
    const result2 = await mod.action2();
    expect(result2).to.deep.equal({ beforeModule: true, beforeService: true });
    const result3 = await mod2.action3();
    expect(result3).to.deep.equal({ beforeAction3: true, beforeService: true });
  });
});
