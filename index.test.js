const { expect } = require("chai");
const {
  App,
  HttpClient,
  LoadBalancer,
  Client,
  Service,
  ServerManager,
  AppFactory,
  LoadBalancerFactory,
  ServiceFactory,
  ClientFactory,
  HttpClientFactory,
  ServerManagerFactory,
} = require("./index");

describe("SystemLynx Factory functions", () => {
  it("should return a factory functions for each SystemLynx abstraction", () => {
    expect(AppFactory).to.be.a("function");
    expect(LoadBalancerFactory).to.be.a("function");
    expect(ServiceFactory).to.be.a("function");
    expect(ClientFactory).to.be.a("function");
    expect(HttpClientFactory).to.be.a("function");
    expect(ServerManagerFactory).to.be.a("function");
  });

  it("should return an instance of each SystemLynx abstraction", () => {});
});

describe("SystemLynx Objects", () => {
  it("should return a SystemLynx App", () => {
    expect(App)
      .to.be.an("object")
      .that.has.all.keys(
        "module",
        "ServerModule",
        "on",
        "emit",
        "startService",
        "loadService",
        "onLoad",
        "config"
      )
      .that.respondsTo("module")
      .that.respondsTo("ServerModule")
      .that.respondsTo("on")
      .that.respondsTo("emit")
      .that.respondsTo("startService")
      .that.respondsTo("loadService")
      .that.respondsTo("onLoad")
      .that.respondsTo("config");
  });

  it("should return a SystemLynx Client", () => {
    expect(Client)
      .to.be.an("object")
      .that.has.property("loadService")
      .that.is.a("function");
  });

  it("should return a HttpClient instance", () => {
    expect(HttpClient)
      .to.be.an("Object")
      .that.has.all.keys("request", "upload")
      .that.respondsTo("request")
      .that.respondsTo("upload");
  });

  it("should return a SystemLynx LoadBalancer", () => {
    expect(LoadBalancer)
      .to.be.an("object")
      .that.has.all.keys(
        "startService",
        "Server",
        "WebSocket",
        "defaultModule",
        "ServerModule",
        "clones"
      )
      .that.respondsTo("startService")
      .that.respondsTo("Server")
      .that.respondsTo("WebSocket")
      .that.respondsTo("ServerModule");
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

  it("should return a SystemLynx ServerManager instance", () => {
    expect(ServerManager)
      .to.be.an("Object")
      .that.has.all.keys(["startService", "addModule", "Server", "WebSocket"])
      .that.respondsTo("startService")
      .that.respondsTo("addModule")
      .that.respondsTo("Server")
      .that.respondsTo("WebSocket");
  });

  it("should return a new instance of a Service", () => {
    expect(Service)
      .to.be.an("object")
      .that.has.all.keys(
        "startService",
        "ServerModule",
        "Server",
        "WebSocket",
        "defaultModule"
      )
      .that.respondsTo("startService")
      .that.respondsTo("ServerModule")
      .that.respondsTo("Server")
      .that.respondsTo("WebSocket");
  });
});
