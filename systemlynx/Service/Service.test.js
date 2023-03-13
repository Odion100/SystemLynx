const { expect } = require("chai");
const request = require("request");
const createService = require("./Service");

describe("createService", () => {
  it("should return a new instance of a Service", () => {
    const Service = createService();
    expect(Service)
      .to.be.an("object")
      .that.has.all.keys("startService", "module", "server", "WebSocket")
      .that.respondsTo("startService")
      .that.respondsTo("module");
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
      .that.has.all.keys("on", "emit", "test", "test2")
      .that.respondsTo("on")
      .that.respondsTo("emit")
      .that.respondsTo("test")
      .that.respondsTo("test2");
  });
  it("should 'Serve' Service connection data created using the 'this' value of the constructor function", async () => {
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
  it("should be able to return a Service instance created using an object as the constructor", () => {
    const mod = Service.module("mod", {
      action1: () => {},
      action2: () => {},
    });

    expect(mod)
      .to.be.an("Object")
      .that.has.all.keys("action1", "action2", "on", "emit")
      .that.respondsTo("action1")
      .that.respondsTo("action2")
      .that.respondsTo("on")
      .that.respondsTo("emit");
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
});
