const { expect } = require("chai");
const SocketDispatcher = require("../components/SocketDispatcher");
const port = 4592;
const socketPath = "/test-namespace";
const route = `/events`;
const namespace = `http://localhost:${port}${route}`;
const { WebSocket, SocketServer } =
  require("../../ServerManager/components/WebSocketServer")(socketPath);

const socket = WebSocket.of(route);
socket.on("connect", ({ id }) => {
  console.log(`socket connected with id:${id}`);
});
socket.on("connection", (clientSocket) => {
  clientSocket.on("subscribe", (name) => clientSocket.join(name));
  clientSocket.on("unsubscribe", (name) => clientSocket.leave(name));
});
SocketServer.listen(port);

describe("SocketDispatcher", () => {
  const eventName = "test-event";
  const dispatcher = new SocketDispatcher({ namespace, socketPath });
  it("should return an EventDispatcher object with methods on and emit", async () => {
    expect(dispatcher)
      .to.be.an("object")
      .that.has.all.keys("on", "once", "emit", "$clearEvent", "destroy", "disconnect")
      .that.respondsTo("on")
      .that.respondsTo("emit")
      .that.respondsTo("$clearEvent")
      .that.respondsTo("disconnect");
  });
  it("Should be able to emit and handle events", (done) => {
    dispatcher.on(eventName, (data) => {
      expect(data).to.deep.equal({ testPassed: true });
      done();
    });
    dispatcher.on("connect", () => console.log(`I'm all the way connected!`));
    setTimeout(
      () => socket.to(eventName).emit(eventName, { id: "test-id", data: { testPassed: true }, type: "WebSocket" }),
      500
    );
  });
});

describe("SocketDispatcher.apply()", () => {
  const eventName = "testing-event";
  const dispatcher = SocketDispatcher.apply({}, [{ namespace, socketPath }]);
  it("should return an EventDispatcher object with methods on and emit", async () => {
    expect(dispatcher)
      .to.be.an("object")
      .that.has.all.keys("on", "once", "emit", "$clearEvent", "destroy", "disconnect")
      .that.respondsTo("on")
      .that.respondsTo("emit")
      .that.respondsTo("$clearEvent")
      .that.respondsTo("disconnect");
  });
  it("Should be able to emit and handle events", (done) => {
    dispatcher.on(eventName, (data, event) => {
      expect(data).to.deep.equal({ testPassed: true });
      expect(event).to.be.an("object").that.has.all.keys("id", "name", "data", "type");
      expect(event.name).to.equal(eventName);
      expect(event.data).to.deep.equal({ testPassed: true });
      expect(event.type).to.equal("WebSocket");
      console.log(`I'm all the way connected too!`);
      done();
    });

    setTimeout(
      () => socket.to(eventName).emit(eventName, { id: "test-id", data: { testPassed: true }, type: "WebSocket" }),
      500
    );
  });
});
