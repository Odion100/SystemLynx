const fs = require("fs");
const { expect } = require("chai");
const createClient = require("../Client");
const createService = require("../../Service/Service");
const Service = createService();
const port = 6757;
const route = "service-test";
const url = `http://localhost:${port}/${route}`;
const TEST_FILE = process.cwd() + "/test.file.json";

describe("createClient()", () => {
  it("should return a SystemLynx Client", () => {
    const Client = createClient();
    expect(Client)
      .to.be.an("object")
      .that.has.property("loadService")
      .that.is.a("function");
  });
});
describe("Client", () => {
  it("should be able to use Client.loadService(url, options) to return a promise that resolve into a backend service", async () => {
    Service.module(
      "orders",
      function () {
        this.action1 = (data) => ({ SERVICE_TEST_PASSED: true, ...data, action1: true });
        this.action2 = (data) => ({ SERVICE_TEST_PASSED: true, ...data, action2: true });
        this.action3 = (data) => ({ SERVICE_TEST_PASSED: true, ...data, action3: true });
        this.noArgTest = () => ({ SERVICE_TEST_PASSED: true, noArgTest: true });
        this.multiArgTest = (arg1, arg2, arg3) => ({
          SERVICE_TEST_PASSED: true,
          multiArgTest: true,
          arg1,
          arg2,
          arg3,
        });
      },
      ["action3"],
    );

    await Service.startService({ route, port });
    const Client = createClient();
    const buAPI = await Client.loadService(url);

    expect(buAPI)
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
        "orders",
      )
      .that.respondsTo("emit")
      .that.respondsTo("$clearEvent")
      .that.respondsTo("on")
      .that.respondsTo("resetConnection")
      .that.respondsTo("disconnect")
      .that.respondsTo("headers")
      .that.respondsTo("setHeaders");

    expect(buAPI.orders)
      .to.be.an("object")
      .that.has.all.keys(
        "emit",
        "on",
        "once",
        "$clearEvent",
        "destroy",
        "disconnect",
        "headers",
        "setHeaders",
        "__setConnection",
        "__connectionData",
        "action1",
        "action2",
        "multiArgTest",
        "noArgTest",
      )
      .that.respondsTo("emit")
      .that.respondsTo("$clearEvent")
      .that.respondsTo("on")
      .that.respondsTo("emit")
      .that.respondsTo("headers")
      .that.respondsTo("setHeaders")
      .that.respondsTo("$clearEvent")
      .that.respondsTo("__setConnection")
      .that.respondsTo("__connectionData")
      .that.respondsTo("action1")
      .that.respondsTo("action2")
      .that.respondsTo("multiArgTest")
      .that.respondsTo("noArgTest");
  });
});

describe("Service", () => {
  it("should be able to call methods from the frontend client to the backend Module", async () => {
    const Client = createClient();
    const buAPI = await Client.loadService(url);

    const results = await buAPI.orders.action1({ code: 3 });

    const results2 = await buAPI.orders.action2({ code: 11 });

    expect(results).to.deep.equal({ SERVICE_TEST_PASSED: true, code: 3, action1: true });
    expect(results2).to.deep.equal({
      SERVICE_TEST_PASSED: true,
      code: 11,
      action2: true,
    });
  });
  it("should be able to send multiple arguments to the backend Module", async () => {
    const Client = createClient();
    const buAPI = await Client.loadService(url);
    const arg1 = 4,
      arg2 = 5,
      arg3 = 6;

    const results = await buAPI.orders.multiArgTest(arg1, arg2, arg3);

    expect(results).to.deep.equal({
      SERVICE_TEST_PASSED: true,
      multiArgTest: true,
      arg1,
      arg2,
      arg3,
    });
  });

  it("should be able to send no arguments and use a promise", async () => {
    const Client = createClient();
    const buAPI = await Client.loadService(url);
    const results = await buAPI.orders.noArgTest();

    expect(results).to.deep.equal({
      SERVICE_TEST_PASSED: true,
      noArgTest: true,
    });
  });

  it("should be able to receive events emitted from the backend Client", async () => {
    const eventName = "testing";
    const route = "test-service";
    const port = "8980";
    const url = `http://localhost:${port}/${route}`;
    const Service = createService();
    const eventTester = Service.module("eventTester", function () {
      this.sendEvent = () => this.emit(eventName, { testPassed: true });
    });
    await Service.startService({ route, port });

    const Client = createClient();

    const buAPI = await Client.loadService(url);
    setTimeout(() => eventTester.emit(eventName, { testPassed: true }), 500);

    await new Promise((resolve) => {
      buAPI.eventTester.on(eventName, (data, event) => {
        console.log("Ladies and gentleman... mission accomplish!");
        expect(data).to.deep.equal({ testPassed: true });
        expect(event).to.be.an("object").that.has.all.keys("id", "name", "data", "type");
        expect(event.name).to.equal(eventName);
        expect(event.data).to.deep.equal({ testPassed: true });
        expect(event.id).to.be.a("string");
        expect(event.type).to.equal("WebSocket");
        resolve();
      });
    });
  });

  it("should be able to send REST http requests", async () => {
    const Client = createClient();
    const Service = createService();
    const route = "rest-tester";
    const port = "8492";
    const url = `http://localhost:${port}/${route}`;
    const useREST = true;
    Service.module("restTester", function () {
      this.get = (data) => ({ REST_TEST_PASSED: true, getResponse: true, ...data });
      this.put = (data) => ({ REST_TEST_PASSED: true, putResponse: true, ...data });
      this.post = () => ({ REST_TEST_PASSED: true, postResponse: true });
      this.delete = () => ({ REST_TEST_PASSED: true, deleteResponse: true });
    });

    await Service.startService({ route, port, useREST });
    const buAPI = await Client.loadService(url);
    const getResponse = await buAPI.restTester.get({ name: "GET TEST", id: 12 });
    const putResponse = await buAPI.restTester.put({ name: "PUT TEST", id: 13 });
    const postResponse = await buAPI.restTester.post();
    const deleteResponse = await buAPI.restTester.delete();

    expect(getResponse).to.deep.equal({
      REST_TEST_PASSED: true,
      getResponse: true,
      name: "GET TEST",
      id: 12,
    });
    expect(putResponse).to.deep.equal({
      REST_TEST_PASSED: true,
      putResponse: true,
      name: "PUT TEST",
      id: 13,
    });
    expect(postResponse).to.deep.equal({ REST_TEST_PASSED: true, postResponse: true });
    expect(deleteResponse).to.deep.equal({
      REST_TEST_PASSED: true,
      deleteResponse: true,
    });
  });

  it("should be able to asynchronously return values from Module methods", async () => {
    const service = createService();
    const route = "sync/test";
    const port = 4920;
    const host = "localhost";
    const url = `http://localhost:${port}/${route}`;
    service.module("AsyncMath", Math);

    await service.startService({
      route,
      port,
      host,
    });
    const Client = createClient();
    const { AsyncMath } = await Client.loadService(url);
    const results = await AsyncMath.max(10, 2);
    expect(results).to.equal(10);
    const results2 = await AsyncMath.min(10, 2);
    expect(results2).to.equal(2);
    const results3 = await AsyncMath.round(10.2);
    expect(results3).to.equal(10);
  });

  it("should send proper error responses", async () => {
    const service = createService();
    const route = "sync/test";
    const port = 7860;
    const host = "localhost";
    const url = `http://localhost:${port}/${route}`;
    service.module("ErrorTest", function () {
      this.sendError = () => {
        return { status: 404, message: "test error" };
      };
      this.throwError = () => {
        throw Error("This is my error!");
      };
    });

    await service.startService({
      route,
      port,
      host,
    });
    const Client = createClient();
    const { ErrorTest } = await Client.loadService(url);
    try {
      await ErrorTest.sendError();
      throw Error("this test should throw before this point");
    } catch (error) {
      expect(error).to.deep.equal({
        SystemLynxService: true,
        fn: "sendError",
        message: "test error",
        module_name: "ErrorTest",
        serviceUrl: "http://localhost:7860/sync/test",
        status: 404,
      });
    }
    try {
      await ErrorTest.throwError();
      throw Error("this test should throw before this point");
    } catch (error) {
      expect(error).to.deep.equal({
        SystemLynxService: true,
        fn: "throwError",
        message: "This is my error!",
        module_name: "ErrorTest",
        serviceUrl: "http://localhost:7860/sync/test",
        status: 500,
      });
    }
  });

  it("should be able pass a ReadStream or file path for upload the via property names file or files on an object in the first parameter", async () => {
    const service = createService();
    const route = "file-upload/test";
    const port = 4568;
    const host = "localhost";
    const url = `http://localhost:${port}/${route}`;

    service.module("storage", function () {
      this.save = ({ file, files, message }) => {
        return { file, files, message };
      };
      this.testOtherParams = (param1, { file, files, message }) => {
        return { files, message, param1 };
      };
    });
    await service.startService({
      route,
      port,
      host,
    });

    const Client = createClient();
    const { storage } = await Client.loadService(url);

    const singleFileResponse = await storage.save({
      file: fs.createReadStream(TEST_FILE),
      message: "single file upload test confirmation",
    });
    const multiFileResponse = await storage.save({
      files: [TEST_FILE, fs.createReadStream(TEST_FILE)],
      message: "multi file upload test confirmation",
    });

    const extraParamResponse = await storage.testOtherParams("OtherParamsTest", {
      files: [TEST_FILE, fs.createReadStream(TEST_FILE)],
      message: "other params file upload test confirmation",
    });
    expect(singleFileResponse).to.be.an("object").that.has.all.keys("file", "message");
    expect(singleFileResponse.message).to.be.an("string");
    expect(singleFileResponse.message).to.equal("single file upload test confirmation");
    expect(singleFileResponse.file).to.be.an("object");
    expect(singleFileResponse.file.originalname).to.equal("test.file.json");
    expect(singleFileResponse.file.mimetype).to.equal("application/json");

    expect(multiFileResponse).to.be.an("object").that.has.all.keys("files", "message");
    expect(multiFileResponse.message).to.be.an("string");
    expect(multiFileResponse.message).to.equal("multi file upload test confirmation");
    expect(multiFileResponse.files).to.be.an("array");
    expect(multiFileResponse.files[0]).to.be.an("object");
    expect(multiFileResponse.files[1]).to.be.an("object");
    expect(multiFileResponse.files[0].originalname).to.equal("test.file.json");
    expect(multiFileResponse.files[1].mimetype).to.equal("application/json");

    expect(extraParamResponse)
      .to.be.an("object")
      .that.has.all.keys("files", "message", "param1");
    expect(extraParamResponse.message).to.be.an("string");
    expect(extraParamResponse.message).to.equal(
      "other params file upload test confirmation",
    );
    expect(extraParamResponse.param1).to.be.an("string");
    expect(extraParamResponse.param1).to.equal("OtherParamsTest");
    expect(extraParamResponse.files).to.be.an("array");
    expect(extraParamResponse.files[0]).to.be.an("object");
    expect(extraParamResponse.files[1]).to.be.an("object");
    expect(extraParamResponse.files[0].originalname).to.equal("test.file.json");
    expect(extraParamResponse.files[1].mimetype).to.equal("application/json");
  });

  it("should maintain service and module level headers on a Client instance", async () => {
    const service = createService();
    const route = "setHeaders/test";
    const port = 4999;
    const host = "localhost";
    const url = `http://localhost:${port}/${route}`;
    service.module("Test", function () {
      this.getHeaders = function () {
        return this.req.headers.origin;
      };
    });
    service.module("Test2", function () {
      this.getHeaders = function () {
        return this.req.headers.origin;
      };
    });

    await service.startService({ route, port, host });

    const Client = createClient();
    const myService = await Client.loadService(url);
    myService.setHeaders({ Origin: `http://localhost:${port}` });
    myService.Test.setHeaders({ Origin: `http://localhost:${port + 1}` });

    //because a module level headers were set for Test then I expect what was set
    // for The Test2 module I expect the Service level header to be applied
    const results = await myService.Test.getHeaders();
    expect(results).to.equal(`http://localhost:${port + 1}`);
    const results2 = await myService.Test2.getHeaders();
    expect(results2).to.equal(`http://localhost:${port}`);
  });

  it("layers service headers UNDER module headers — a module setHeaders must not drop service-level auth", async () => {
    // regression: the old logic REPLACED service headers with module headers the moment a module
    // had any set, silently dropping service-level auth on a DIFFERENT key. Merge layers instead.
    const service = createService();
    const route = "header-merge";
    const port = 8529;
    service.module("Api", function () {
      this.seen = function () {
        return {
          auth: this.req.headers["x-svc-auth"] || null,
          tag: this.req.headers["x-mod-tag"] || null,
        };
      };
    });
    await service.startService({ route, port });

    const svc = await createClient().loadService(`http://localhost:${port}/${route}`);
    svc.setHeaders({ "x-svc-auth": "token-123" }); // service-level (e.g. per-request auth)
    svc.Api.setHeaders({ "x-mod-tag": "M" }); // a DIFFERENT key at the module level

    // before the fix: the module header replaced the service header → auth dropped → 401 in the wild
    const seen = await svc.Api.seen();
    expect(seen).to.deep.equal({ auth: "token-123", tag: "M" }); // auth survives, module layered on top
  });

  it("runs client-side before/after hooks around an outbound call (RFC 005)", async () => {
    const service = createService();
    const route = "hooks-test";
    const port = 8521;
    const url = `http://localhost:${port}/${route}`;
    service.module("Hooked", function () {
      this.echo = function (data) {
        return { got: data, trace: this.req.headers["x-trace"] || null };
      };
    });
    await service.startService({ route, port });

    const Client = createClient();
    const svc = await Client.loadService(url);

    const seen = [];
    // module-level before: set a header through `this` (the module) and modify the outgoing payload
    svc.Hooked.before("echo", function (payload, next) {
      this.setHeaders({ "x-trace": "T-123" });
      payload[0].tagged = true;
      next();
    });
    // module-level after: observe the returned value
    svc.Hooked.after("echo", function (result, next) {
      seen.push(result);
      next();
    });

    const res = await svc.Hooked.echo({ n: 1 });
    expect(res.got).to.deep.equal({ n: 1, tagged: true }); // payload modification reached the server
    expect(res.trace).to.equal("T-123"); // header set by the before hook reached the server
    expect(seen).to.have.lengthOf(1); // after hook ran
    expect(seen[0]).to.deep.equal(res); // and saw the response
  });

  it("accepts arrays and nested arrays of hooks, like the server (RFC 005)", async () => {
    const service = createService();
    const route = "hooks-array";
    const port = 8522;
    const url = `http://localhost:${port}/${route}`;
    service.module("Arr", function () {
      this.run = () => ({ ok: true });
    });
    await service.startService({ route, port });

    const Client = createClient();
    const svc = await Client.loadService(url);

    const order = [];
    // an array containing a nested array of before hooks — all run, flattened, in order
    svc.Arr.before("run", [
      function (p, next) {
        order.push("a");
        next();
      },
      [
        function (p, next) {
          order.push("b");
          next();
        },
      ],
      function (p, next) {
        order.push("c");
        next();
      },
    ]);

    const res = await svc.Arr.run();
    expect(res).to.deep.equal({ ok: true });
    expect(order).to.deep.equal(["a", "b", "c"]); // every hook ran, in order
  });

  it("applies client / service-instance / module middleware across namespaces, in specificity order (Hooker)", async () => {
    const service = createService();
    const route = "ns-test";
    const port = 8525;
    const url = `http://localhost:${port}/${route}`;
    service.module("Orders", function () {
      this.reprice = () => ({ ok: true });
    });
    await service.startService({ route, port });

    const Client = createClient();
    const svc = await Client.loadService(url);

    const order = [];
    const mark = (label) =>
      function (payload, next) {
        order.push(label);
        next();
      };

    // register at every namespace level, deliberately OUT of specificity order — gather must sort it
    svc.Orders.before("reprice", mark("module.reprice")); // module store, bare method
    svc.Orders.before("$all", mark("module.$all"));
    svc.before("Orders.reprice", mark("svc.Orders.reprice")); // service instance, full namespace
    svc.before("Orders", mark("svc.Orders"));
    svc.before("$all", mark("svc.$all"));
    Client.before("Orders.reprice", mark("client.Orders.reprice")); // client, full namespace
    Client.before("Orders", mark("client.Orders"));
    Client.before("$all", mark("client.$all"));

    await svc.Orders.reprice();

    // outermost-first (client → service instance → module), each level broad → specific
    expect(order).to.deep.equal([
      "client.$all",
      "client.Orders",
      "client.Orders.reprice",
      "svc.$all",
      "svc.Orders",
      "svc.Orders.reprice",
      "module.$all",
      "module.reprice",
    ]);
  });

  it("hooks an ARRAY of targets — methods at the module handle, namespaces at the service level (Hooker)", async () => {
    const service = createService();
    const route = "ns-array";
    const port = 8526;
    const url = `http://localhost:${port}/${route}`;
    service.module("Orders", function () {
      this.reprice = () => ({ ok: "reprice" });
      this.cancel = () => ({ ok: "cancel" });
    });
    service.module("Users", function () {
      this.ban = () => ({ ok: "ban" });
    });
    await service.startService({ route, port });

    const svc = await createClient().loadService(url);

    const hits = [];
    // module handle: already scoped to Orders, so the array names METHODS
    svc.Orders.before(["reprice", "cancel"], function (p, next) {
      hits.push("orders-methods");
      next();
    });
    // service instance: the array names NAMESPACES (multiple modules)
    svc.before(["Orders", "Users"], function (p, next) {
      hits.push("svc-modules");
      next();
    });

    await svc.Orders.reprice(); // svc(Orders) + module(reprice)
    await svc.Orders.cancel(); // svc(Orders) + module(cancel)
    await svc.Users.ban(); // svc(Users) only — the Orders module hook doesn't apply

    expect(hits).to.deep.equal([
      "svc-modules",
      "orders-methods",
      "svc-modules",
      "orders-methods",
      "svc-modules",
    ]);
  });

  it("catches a THROWN server middleware error and passes it back to the client", async () => {
    const service = createService();
    const route = "mw-error";
    const port = 8527;
    const url = `http://localhost:${port}/${route}`;
    service.module("Guard", function () {
      this.open = () => ({ ok: true });
    });
    service.before("Guard.open", () => {
      throw { status: 403, message: "blocked" }; // middleware throws instead of calling sendError
    });
    await service.startService({ route, port });

    const svc = await createClient().loadService(url);
    let err;
    try {
      await svc.Guard.open();
    } catch (e) {
      err = e;
    }
    expect(err).to.exist; // the caller got the error back, not a hang
    expect(err.message).to.equal("blocked");
    expect(err.status).to.equal(403);
    expect(err.SystemLynxService).to.equal(true); // came back as a genuine SystemLynx error response
  });
});
