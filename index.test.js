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
        "emit",
        "before",
        "use",
        "startService",
        "loadService",
        "onLoad",
        "config",
        "server",
        "WebSocket"
      )
      .that.respondsTo("module")
      .that.respondsTo("on")
      .that.respondsTo("emit")
      .that.respondsTo("before")
      .that.respondsTo("use")
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
        "server",
        "WebSocket",
        "clones",
        "module",
        "before"
      )
      .that.respondsTo("startService")
      .that.respondsTo("module")
      .that.respondsTo("before");
    expect(LoadBalancer.clones)
      .to.be.an("object")
      .that.has.all.keys(
        "before",
        "on",
        "emit",
        "clones",
        "register",
        "dispatch",
        "assignDispatch"
      )
      .that.respondsTo("emit")
      .that.respondsTo("on")
      .that.respondsTo("before")
      .that.respondsTo("register")
      .that.respondsTo("dispatch")
      .that.respondsTo("assignDispatch")
      .that.has.property("clones")
      .that.is.an("array");
  });

  it("should return a SystemLynx ServerManager instance", () => {
    expect(ServerManager)
      .to.be.an("Object")
      .that.has.all.keys([
        "startService",
        "addModule",
        "addRouteHandler",
        "server",
        "WebSocket",
      ])
      .that.respondsTo("startService")
      .that.respondsTo("addModule")
      .that.respondsTo("addRouteHandler");
  });

  it("should return a new instance of a Service", () => {
    expect(Service).to.be.an("object").that.respondsTo("startService");
  });
});
