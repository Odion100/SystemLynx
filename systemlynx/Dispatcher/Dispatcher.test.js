const { expect } = require("chai");
const Dispatcher = require("./Dispatcher");

describe("createDispatcher", () => {
  const dispatcher = new Dispatcher();

  it("should return an EventDispatcher object with on, emit, $clearEvent, once, and destroy", () => {
    expect(dispatcher)
      .to.be.an("object")
      .that.respondsTo("on")
      .that.respondsTo("emit")
      .that.respondsTo("$clearEvent")
      .that.respondsTo("once")
      .that.respondsTo("destroy");
  });

  it("should emit and handle events", (done) => {
    dispatcher.on("test", (data) => {
      expect(data).to.deep.equal({ testPassed: true });
      done();
    });

    dispatcher.emit("test", { testPassed: true });
  });

  it("on() should return an unsubscribe function that removes the listener", (done) => {
    const d = new Dispatcher();
    let callCount = 0;

    const unsubscribe = d.on("ping", () => callCount++);
    expect(unsubscribe).to.be.a("function");

    d.emit("ping");
    unsubscribe();
    d.emit("ping");

    setTimeout(() => {
      expect(callCount).to.equal(1);
      done();
    }, 0);
  });

  it("eventId should replace the existing listener on re-register", (done) => {
    const d = new Dispatcher();
    let callCount = 0;

    d.on("ping", () => callCount++, { eventId: "my-listener" });
    d.on("ping", () => callCount++, { eventId: "my-listener" });

    d.emit("ping");

    setTimeout(() => {
      expect(callCount).to.equal(1);
      done();
    }, 0);
  });

  it("once() should fire the callback only once", (done) => {
    const d = new Dispatcher();
    let callCount = 0;

    d.once("ping", () => callCount++);
    d.emit("ping");
    d.emit("ping");
    d.emit("ping");

    setTimeout(() => {
      expect(callCount).to.equal(1);
      done();
    }, 0);
  });

  it("destroy() should remove all listeners", (done) => {
    const d = new Dispatcher();
    let callCount = 0;

    d.on("a", () => callCount++);
    d.on("b", () => callCount++);
    d.destroy();
    d.emit("a");
    d.emit("b");

    setTimeout(() => {
      expect(callCount).to.equal(0);
      done();
    }, 0);
  });

  it("$clearEvent should still work with a named function (backward compat)", (done) => {
    const d = new Dispatcher();
    let callCount = 0;

    function myHandler() { callCount++; }

    d.on("ping", myHandler);
    d.emit("ping");
    d.$clearEvent("ping", myHandler);
    d.emit("ping");

    setTimeout(() => {
      expect(callCount).to.equal(1);
      done();
    }, 0);
  });
});
