const { expect } = require("chai");
const createClient = require("../Client");
const createService = require("../../Service/Service");
const Service = createService();
const port = 6757;
const route = "service-test";
const url = `http://localhost:${port}/${route}`;

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

  it("should be able to use 'useReturnValue' configuration option to enable synchronous return values from Module methods", async () => {
    const service = createService();
    const route = "sync/test";
    const port = 4920;
    const host = "localhost";
    const url = `http://localhost:${port}/${route}`;
    service.module("AsyncMath", function () {
      this.max = Math.max;
      this.min = Math.min;
      this.round = Math.round;
    });

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
