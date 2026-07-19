const { expect } = require("chai");
const {
  App,
  HttpClient,
  LoadBalancer,
  Client,
  Service,
  ServerManager,
  createApp,
  createLoadBalancer,
  createService,
  createClient,
  createHttpClient,
  createServerManager,
} = require("./index");

describe("SystemLynxSystemLynx  functions", () => {
  it("should return aSystemLynx  functions for each SystemLynx abstraction", () => {
    expect(createApp).to.be.a("function");
    expect(createLoadBalancer).to.be.a("function");
    expect(createService).to.be.a("function");
    expect(createClient).to.be.a("function");
    expect(createHttpClient).to.be.a("function");
    expect(createServerManager).to.be.a("function");
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
        "once",
        "emit",
        "$clearEvent",
        "destroy",
        "before",
        "after",
        "use",
        "startService",
        "loadService",
        "onLoad",
        "config",
        "server",
        "WebSocket",
        "getModule",
        "getModules",
        "Modules",
        "close"
      )
      .that.respondsTo("module")
      .that.respondsTo("on")
      .that.respondsTo("emit")
      .that.respondsTo("$clearEvent")
      .that.respondsTo("before")
      .that.respondsTo("after")
      .that.respondsTo("use")
      .that.respondsTo("startService")
      .that.respondsTo("loadService")
      .that.respondsTo("onLoad")
      .that.respondsTo("config")
      .that.respondsTo("getModule")
      .that.respondsTo("getModules")
      .that.respondsTo("Modules");
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
        "server",
        "WebSocket",
        "Tentacle",
        "clone",
        "module",
        "before",
        "after",
        "close"
      )
      .that.respondsTo("startService")
      .that.respondsTo("module")
      .that.respondsTo("before")
      .that.respondsTo("after");
    expect(LoadBalancer.clone).to.be.a("function");
    expect(LoadBalancer.Tentacle)
      .to.be.an("object")
      .that.respondsTo("emit")
      .that.respondsTo("$clearEvent")
      .that.respondsTo("on")
      .that.respondsTo("before")
      .that.respondsTo("after")
      .that.respondsTo("register")
      .that.respondsTo("directory")
      .that.respondsTo("delegate")
      .that.respondsTo("broadcast")
      .that.respondsTo("elect")
      .that.has.property("services")
      .that.is.an("array");
  });

  it("should return a SystemLynx ServerManager instance", () => {
    expect(ServerManager)
      .to.be.an("Object")
      .that.has.all.keys([
        "startService",
        "addModule",
        "addBeforware",
        "addAfterware",
        "server",
        "close",
      ])
      .that.respondsTo("startService")
      .that.respondsTo("addModule")
      .that.respondsTo("addBeforware");
  });

  it("should return a new instance of a Service", () => {
    expect(Service).to.be.an("object").that.respondsTo("startService");
  });
});
