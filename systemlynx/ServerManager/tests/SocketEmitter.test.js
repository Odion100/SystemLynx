const { expect } = require("chai");
const SocketEmiiter = require("../components/SocketEmitter");
const { WebSocket, SocketServer } = require("../components/WebSocketServer")();
const io = require("socket.io-client");

describe("SocketEmiiter", () => {
  it("should be able to use emmiter.emit(name, data) to dispatch events to a websockt client", done => {
    const namespace = "test-namespace";
    const port = 5556;
    const eventName = "test-event";
    SocketServer.listen(port);
    const emmiter = SocketEmiiter(namespace, WebSocket);

    const socket = io.connect(`http://localhost:${port}/${namespace}`);
    socket.on("connect", () => {
      console.log(`socket connected to namespace: ${namespace}`);
      socket.emit("subscribe", eventName);
    });
    socket.on(eventName, (payload) => {
      expect(payload)
        .to.be.an("object")
        .that.has.all.keys("id", "data", "type");
      expect(payload.data).to.deep.equal({ testPassed: true });
      done();
    });
    socket.on("disconnect", () => console.log("---------> disconnect"));

    setTimeout(() => {
      emmiter.emit(eventName, { testPassed: true });
    }, 500);
  });
});
