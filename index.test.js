const { expect } = require("chai");
const {
  App,
  HttpClient,
  LoadBalancer,
  Client,
  Service,
  ServerManager,
  SystemLynxApp,
  SystemLynxLoadBalancer,
  SystemLynxService,
  SystemLynxClient,
  SystemLynxHttpClient,
  SystemLynxServerManager,
} = require("./index");

describe("SystemLynxSystemLynx  functions", () => {
  it("should return aSystemLynx  functions for each SystemLynx abstraction", () => {
    expect(SystemLynxApp).to.be.a("function");
    expect(SystemLynxLoadBalancer).to.be.a("function");
    expect(SystemLynxService).to.be.a("function");
    expect(SystemLynxClient).to.be.a("function");
    expect(SystemLynxHttpClient).to.be.a("function");
    expect(SystemLynxServerManager).to.be.a("function");
  });

  it("should return an instance of each SystemLynx abstraction", () => {});
});

describe("SystemLynx Objects", () => {
  it("should return a SystemLynx App", () => {
    expect(App)
      .to.be.an("object")
      .that.has.all.keys(
        "module",
        "on",
        "emit",
        "startService",
        "loadService",
        "onLoad",
        "config"
      )
      .that.respondsTo("module")
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
        "clones",
        "module"
      )
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
      .that.respondsTo("startService")
      .that.respondsTo("Server")
      .that.respondsTo("WebSocket");
  });
});
