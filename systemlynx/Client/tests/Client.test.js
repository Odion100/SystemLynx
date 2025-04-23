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
      ["action3"]
    );

    await Service.startService({ route, port });
    const Client = createClient();
    const buAPI = await Client.loadService(url);

    expect(buAPI)
      .to.be.an("object")
      .that.has.all.keys(
        "emit",
        "on",
        "$clearEvent",
        "resetConnection",
        "disconnect",
        "headers",
        "setHeaders",
        "orders"
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
        "$clearEvent",
        "disconnect",
        "headers",
        "setHeaders",
        "__setConnection",
        "__connectionData",
        "action1",
        "action2",
        "multiArgTest",
        "noArgTest"
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
      "other params file upload test confirmation"
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
});
