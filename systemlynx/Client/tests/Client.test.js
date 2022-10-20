const { expect } = require("chai");
const SystemLynxClient = require("../Client");
const SystemLynxService = require("../../Service/Service");
const Service = SystemLynxService();
const port = 6757;
const route = "service-test";
const url = `http://localhost:${port}/${route}`;

describe("SystemLynxClient()", () => {
  it("should return a SystemLynx Client", () => {
    const Client = SystemLynxClient();
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
    const Client = SystemLynxClient();
    const buAPI = await Client.loadService(url);

    expect(buAPI)
      .to.be.an("object")
      .that.has.all.keys("emit", "on", "resetConnection", "disconnect", "orders")
      .that.respondsTo("emit")
      .that.respondsTo("on")
      .that.respondsTo("resetConnection")
      .that.respondsTo("disconnect");

    expect(buAPI.orders)
      .to.be.an("object")
      .that.has.all.keys(
        "emit",
        "on",
        "disconnect",
        "__setConnection",
        "__connectionData",
        "action1",
        "action2",
        "multiArgTest",
        "noArgTest"
      )
      .that.respondsTo("emit")
      .that.respondsTo("on")
      .that.respondsTo("emit")
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
    const Client = SystemLynxClient();
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
    const Client = SystemLynxClient();
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
    const Client = SystemLynxClient();
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
    const Service = SystemLynxService();
    const eventTester = Service.module("eventTester", function () {
      this.sendEvent = () => this.emit(eventName, { testPassed: true });
    });
    await Service.startService({ route, port });

    const Client = SystemLynxClient();

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
    const Client = SystemLynxClient();
    const Service = SystemLynxService();
    const route = "rest-tester";
    const port = "8492";
    const url = `http://localhost:${port}/${route}`;
    const useREST = true;
    Service.module("restTester", function () {
      this.get = (data) => ({ REST_TEST_PASSED: true, getResponse: true, ...data });
      this.put = () => ({ REST_TEST_PASSED: true, putResponse: true });
      this.post = () => ({ REST_TEST_PASSED: true, postResponse: true });
      this.delete = () => ({ REST_TEST_PASSED: true, deleteResponse: true });
    });

    await Service.startService({ route, port, useREST });
    const buAPI = await Client.loadService(url);
    const getResponse = await buAPI.restTester.get({ name: "GET TEST", id: 12 });
    const putResponse = await buAPI.restTester.put();
    const postResponse = await buAPI.restTester.post();
    const deleteResponse = await buAPI.restTester.delete();

    expect(getResponse).to.deep.equal({
      REST_TEST_PASSED: true,
      getResponse: true,
      name: "GET TEST",
      id: 12,
    });
    expect(putResponse).to.deep.equal({ REST_TEST_PASSED: true, putResponse: true });
    expect(postResponse).to.deep.equal({ REST_TEST_PASSED: true, postResponse: true });
    expect(deleteResponse).to.deep.equal({
      REST_TEST_PASSED: true,
      deleteResponse: true,
    });
  });

  it("should be able to use 'useReturnValue' configuration option to enable synchronous return values from Module methods", async () => {
    const service = SystemLynxService();
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
    const Client = SystemLynxClient();
    const { AsyncMath } = await Client.loadService(url);
    const results = await AsyncMath.max(10, 2);
    expect(results).to.equal(10);
    const results2 = await AsyncMath.min(10, 2);
    expect(results2).to.equal(2);
    const results3 = await AsyncMath.round(10.2);
    expect(results3).to.equal(10);
  });
});
