const { expect } = require("chai");
const createServerManager = require("../ServerManager");
const request = require("request");

describe("createServerManager function", () => {
  it("should return an ServerManager instance", () => {
    const ServerManager = createServerManager();

    expect(ServerManager)
      .to.be.an("Object")
      .that.has.all.keys([
        "startService",
        "addModule",
        "addBeforware",
        "addAfterware",
        "server",
      ])
      .that.respondsTo("startService")
      .that.respondsTo("addModule")
      .that.respondsTo("addBeforware")
      .that.respondsTo("addAfterware");
  });
});
describe("ServerManager", () => {
  it("should be able use ServerManager.startService to start a server that will accept requests for Module Connection Data on the given route", async () => {
    const ServerManager = createServerManager();
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
        "socketPath",
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
    const ServerManager = createServerManager();
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
        "socketPath",
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
    const ServerManager = createServerManager();
    const route = "/testService";
    const port = 4600;
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
        "socketPath",
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
    const ServerManager = createServerManager();
    const route = "/testAPI";
    const port = 8372;
    const url = `http://localhost:${port}${route}`;
    const name = "testObject";
    const object = {
      get: () => ({ REST_TEST_PASSED: true }),
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
    const ServerManager = createServerManager();
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

  it("should be able to use the ServerManager.addBeforware method to add additional route handling", async () => {
    const ServerManager = createServerManager();
    const route = "/testAPI";
    const port = 5454;
    const url = `http://localhost:${port}${route}`;
    const name = "testObject";
    const object = {
      get: function () {
        const { req } = this;
        return {
          SERVICE_TEST_PASSED: true,
          $allHandlerAdded: req.$allHandlerAdded,
          putHandlerAdded: req.putHandlerAdded,
        };
      },
      put: function () {
        const { req } = this;
        return {
          SERVICE_TEST_PASSED: true,
          $allHandlerAdded: req.$allHandlerAdded,
          putHandlerAdded: req.putHandlerAdded,
        };
      },
      test: function () {
        return { SERVICE_TEST_PASSED: false };
      },
    };

    ServerManager.addBeforware((req, res, next) => {
      req.$allHandlerAdded = true;
      next();
    });
    ServerManager.addBeforware(`${name}.put`, (req, res, next) => {
      req.putHandlerAdded = true;
      next();
    });
    ServerManager.addBeforware(`${name}.test`, (req, res, next) => {
      res.sendError({ status: 400, message: "tested passed" });
    });
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
      returnValue: {
        SERVICE_TEST_PASSED: true,
        $allHandlerAdded: true,
      },
      fn: "get",
      message: "[SystemLynx][response]: testObject.get(...) returned successfully",
      module_name: "testObject",
      serviceUrl: "http://localhost:5454/testAPI",
      status: 200,
    });

    const result2 = await new Promise((resolve) => {
      request(
        { url: `${url}/${name}/put`, json: true, method: "PUT" },
        (err, res, body) => {
          resolve(body);
        }
      );
    });

    expect(result2).to.deep.equal({
      returnValue: {
        SERVICE_TEST_PASSED: true,
        $allHandlerAdded: true,
        putHandlerAdded: true,
      },
      fn: "put",
      message: "[SystemLynx][response]: testObject.put(...) returned successfully",
      module_name: "testObject",
      serviceUrl: "http://localhost:5454/testAPI",
      status: 200,
    });

    const result3 = await new Promise((resolve) => {
      request(
        { url: `${url}/${name}/test`, json: true, method: "post" },
        (err, res, body) => {
          resolve(body);
        }
      );
    });

    expect(result3).to.deep.equal({
      message: "tested passed",
      fn: "test",
      module_name: "testObject",
      serviceUrl: "http://localhost:5454/testAPI",
      status: 400,
      SystemLynxService: true,
    });
  });
  it("should be able to use the ServerManager.addAfterware method to add additional route handling after the method call", async () => {
    const ServerManager = createServerManager();
    const route = "/testAPI";
    const port = 5455;
    const url = `http://localhost:${port}${route}`;
    const name = "testObject";
    const object = {
      get: function () {
        const { req } = this;
        return {
          SERVICE_TEST_PASSED: false,
          $allHandlerAdded: false,
          putHandlerAdded: false,
        };
      },
      put: function () {
        const { req } = this;
        return {
          SERVICE_TEST_PASSED: false,
          $allHandlerAdded: false,
          putHandlerAdded: false,
        };
      },
      test: function () {
        return { SERVICE_TEST_PASSED: false };
      },
    };

    ServerManager.addAfterware((req, res, next) => {
      req.returnValue.$allHandlerAdded = true;
      req.returnValue.SERVICE_TEST_PASSED = true;
      next();
    });
    ServerManager.addAfterware(`${name}.put`, (req, res, next) => {
      req.returnValue.putHandlerAdded = true;
      next();
    });
    ServerManager.addAfterware(`${name}.test`, (req, res, next) => {
      res.sendError({ status: 400, message: "tested passed" });
    });
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
      returnValue: {
        SERVICE_TEST_PASSED: true,
        $allHandlerAdded: true,
        putHandlerAdded: false,
      },
      fn: "get",
      message: "[SystemLynx][response]: testObject.get(...) returned successfully",
      module_name: "testObject",
      serviceUrl: "http://localhost:5455/testAPI",
      status: 200,
    });

    const result2 = await new Promise((resolve) => {
      request(
        { url: `${url}/${name}/put`, json: true, method: "PUT" },
        (err, res, body) => {
          resolve(body);
        }
      );
    });

    expect(result2).to.deep.equal({
      returnValue: {
        SERVICE_TEST_PASSED: true,
        $allHandlerAdded: true,
        putHandlerAdded: true,
      },
      fn: "put",
      message: "[SystemLynx][response]: testObject.put(...) returned successfully",
      module_name: "testObject",
      serviceUrl: "http://localhost:5455/testAPI",
      status: 200,
    });

    const result3 = await new Promise((resolve) => {
      request(
        { url: `${url}/${name}/test`, json: true, method: "post" },
        (err, res, body) => {
          resolve(body);
        }
      );
    });

    expect(result3).to.deep.equal({
      message: "tested passed",
      fn: "test",
      module_name: "testObject",
      serviceUrl: "http://localhost:5455/testAPI",
      status: 400,
      SystemLynxService: true,
    });
  });
});
