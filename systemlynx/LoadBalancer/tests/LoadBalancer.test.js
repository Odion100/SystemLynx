const { expect } = require("chai");
const LoadBalancer = require("../LoadBalancer")();
const SystemLynxService = require("../../Service/Service");
const HttpClient = require("../../HttpClient/HttpClient")();
const lbPort = 5030;
const route = "loadbalancer";

describe("LoadBalancer()", () => {
  it("should return a SystemLynx LoadBalancer", () => {
    expect(LoadBalancer)
      .to.be.an("object")
      .that.has.all.keys("startService", "Server", "WebSocket", "module", "clones")
      .that.respondsTo("startService")
      .that.respondsTo("Server")
      .that.respondsTo("WebSocket")
      .that.respondsTo("module");
    expect(LoadBalancer.clones)
      .to.be.an("object")
      .that.has.all.keys("on", "emit", "clones", "register", "dispatch", "assignDispatch")
      .that.respondsTo("emit")
      .that.respondsTo("on")
      .that.respondsTo("register")
      .that.respondsTo("dispatch")
      .that.respondsTo("assignDispatch")
      .that.has.property("clones")
      .that.is.an("array");
  });
});
describe("LoadBalancer", () => {
  it("should return an object with properties: startService (fn), clones (Service)", () => {
    expect(LoadBalancer).to.be.an("object");
    expect(typeof LoadBalancer.startService).to.equal("function");
  });

  it("should be able to start the LoadBalancer Service using the LoadBalancer.startService method", async () => {
    await LoadBalancer.startService({ port: lbPort, route });
    const url = `http://localhost:${lbPort}/${route}`;
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
      .that.is.an("array")
      .to.has.a.lengthOf(1);
  });
});
describe("LoadBalancer.clones (Module)", () => {
  const test_service1 = {
    route: "test-service1",
    port: 5393,
    host: "localhost",
  };

  const test_service2 = {
    route: "test-service2",
    port1: 5391,
    port2: 5392,
    host: "localhost",
  };
  it("should be a Service object with additional methods for LoadBalancing", () => {
    expect(LoadBalancer.clones)
      .to.be.an("Object")
      .that.has.all.keys(
        "on",
        "emit",
        "$emit",
        "register",
        "dispatch",
        "assignDispatch",
        "clones"
      )
      .that.respondsTo("on")
      .that.respondsTo("emit")
      .that.respondsTo("$emit")
      .that.respondsTo("register")
      .that.respondsTo("dispatch")
      .that.respondsTo("assignDispatch")
      .that.has.property("clones")
      .that.is.an("array");
  });

  it("should be able to use clones.register(connData, callback) method to host connection", async () => {
    const Service = SystemLynxService();
    const { route, port, host } = test_service1;
    await Service.startService({ route, port, host });
    LoadBalancer.clones.register({ route, port, host }, () => {});
    const url = `http://localhost:${lbPort}/${route}`;
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
      .that.is.an("array")
      .to.has.a.lengthOf(0);
    expect(connData.serviceUrl).to.equal(`http://localhost:${port}/${route}`);
  });

  it("should be able to manager the routing to multiple clones of the same Service", async () => {
    const { route, port1, port2, host } = test_service2;
    const Clone1 = SystemLynxService();
    const Clone2 = SystemLynxService();
    await Clone1.startService({ route, port: port1, host });
    await Clone2.startService({ route, port: port2, host });
    LoadBalancer.clones.register({ route, port: port1, host }, () => {});
    LoadBalancer.clones.register({ route, port: port2, host }, () => {});

    const url = `http://localhost:${lbPort}/${route}`;

    const connData1 = await HttpClient.request({ url });
    expect(connData1.serviceUrl).to.equal(`http://localhost:${port1}/${route}`);
    const connData2 = await HttpClient.request({ url });
    expect(connData2.serviceUrl).to.equal(`http://localhost:${port2}/${route}`);
  });

  it("should be able to manage the route of multiple clones of multiple Services. aka Service Discovery", async () => {
    const route1 = test_service1.route;
    const route2 = test_service2.route;
    const url1 = `http://localhost:${lbPort}/${route1}`;
    const url2 = `http://localhost:${lbPort}/${route2}`;

    const connData1 = await HttpClient.request({ url: url1 });
    expect(connData1.route).to.equal(`/${route1}`);
    const connData2 = await HttpClient.request({ url: url2 });
    expect(connData2.route).to.equal(`/${route2}`);
  });
});
