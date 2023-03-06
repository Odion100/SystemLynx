const { expect } = require("chai");
const SystemLynxServerManager = require("../ServerManager");
const request = require("request");

describe("SystemLynxServerManager function", () => {
  it("should return an ServerManager instance", () => {
    const ServerManager = SystemLynxServerManager();

    expect(ServerManager)
      .to.be.an("Object")
      .that.has.all.keys(["startService", "addModule", "server", "WebSocket"])
      .that.respondsTo("startService")
      .that.respondsTo("addModule");
  });
});
describe("ServerManager", () => {
  it("should be able use ServerManager.startService to start a server that will accept requests for Module Connection Data on the given route", async () => {
    const ServerManager = SystemLynxServerManager();
    const route = "/testService";
    const port = 4400;
    const url = `http://localhost:${port}${route}`;

    await ServerManager.startService({ route, port });
    const results = await new Promise((resolve) => {
      request({ url, json: true }, (err, res, body) => {
        resolve(body);
      });
    });

    expect(results)
      .to.be.an("Object")
      .that.has.all.keys(
        "SystemLynxService",
        "serviceUrl",
        "route",
        "host",
        "port",
        "modules",
        "namespace"
      )
      .that.has.property("modules")
      .that.is.an("array").that.is.empty;
  });

  it("should be able to use the ServerManager.addModule method to add data to the ServerManager instance that can be accessed via a GET request", async () => {
    const ServerManager = SystemLynxServerManager();
    const route = "/testService";
    const port = 4634;
    const url = `http://localhost:${port}${route}`;
    const name = "TestModule";
    await ServerManager.startService({ route, port });

    ServerManager.addModule(name, {});
    ServerManager.addModule(name + 1, {});
    const results = await new Promise((resolve) => {
      request({ url, json: true }, (err, res, body) => {
        resolve(body);
      });
    });

    expect(results)
      .to.be.an("object")
      .that.has.all.keys(
        "SystemLynxService",
        "serviceUrl",
        "route",
        "host",
        "port",
        "modules",
        "namespace"
      )
      .that.has.property("modules")
      .that.is.an("array")
      .that.has.a.lengthOf(2);
    expect(results.modules[0])
      .to.be.an("object")
      .that.has.all.keys("name", "methods", "route", "namespace");
  });

  it("should be able call ServerManager.addModule method before or after calling ServerManager.startService", async () => {
    const ServerManager = SystemLynxServerManager();
    const route = "/testService";
    const port = 4500;
    const url = `http://localhost:${port}${route}`;
    const name = "TestModule";

    ServerManager.addModule(name, {});
    ServerManager.addModule(name + 1, {});

    await ServerManager.startService({ route, port });

    const results = await new Promise((resolve) => {
      request({ url, json: true }, (err, res, body) => {
        resolve(body);
      });
    });

    expect(results)
      .to.be.an("object")
      .that.has.all.keys(
        "SystemLynxService",
        "serviceUrl",
        "route",
        "host",
        "port",
        "modules",
        "namespace"
      )
      .that.has.property("modules")
      .that.is.an("array")
      .that.has.a.lengthOf(2);
    expect(results.modules[0])
      .to.be.an("object")
      .that.has.all.keys("name", "methods", "route", "namespace");
  });
});

describe("ServerManager.startService(ServerConfiguration)", () => {
  it("should be able to use the useREST=true property to create a REST API route for any method with the name 'get', 'put', 'post' or 'delete'", async () => {
    const ServerManager = SystemLynxServerManager();
    const route = "/testAPI";
    const port = 8372;
    const url = `http://localhost:${port}${route}`;
    const name = "testObject";
    const object = {
      get: () => (null, { REST_TEST_PASSED: true }),
      put: () => {},
      post: () => {},
      delete: () => {},
    };

    ServerManager.addModule(name, object);

    await ServerManager.startService({
      route,
      port,
      useREST: true,
    });

    const results = await new Promise((resolve) => {
      request({ url: `${url}/${name}`, json: true }, (err, res, body) => {
        resolve(body);
      });
    });

    expect(results).to.deep.equal({
      fn: "get",
      message: "[SystemLynx][response]: testObject.get(...) returned successfully",
      module_name: "testObject",
      returnValue: {
        REST_TEST_PASSED: true,
      },
      serviceUrl: "http://localhost:8372/testAPI",
      status: 200,
    });
  });

  it("should be able to use the staticRouting=true property to create static routes to the Modules", async () => {
    const ServerManager = SystemLynxServerManager();
    const route = "/testAPI";
    const port = 2233;
    const url = `http://localhost:${port}${route}`;
    const name = "testObject";
    const object = {
      get: () => (null, { SERVICE_TEST_PASSED: true }),
      put: () => (null, { SERVICE_TEST_PASSED: true }),
      post: () => {},
      delete: () => {},
    };

    ServerManager.addModule(name, object);

    await ServerManager.startService({
      route,
      port,
      staticRouting: true,
      useREST: true,
    });

    const results = await new Promise((resolve) => {
      request({ url: `${url}/${name}/get`, json: true }, (err, res, body) => {
        resolve(body);
      });
    });

    expect(results).to.deep.equal({
      returnValue: { SERVICE_TEST_PASSED: true },
      fn: "get",
      message: "[SystemLynx][response]: testObject.get(...) returned successfully",
      module_name: "testObject",
      serviceUrl: "http://localhost:2233/testAPI",
      status: 200,
    });
  });
});
