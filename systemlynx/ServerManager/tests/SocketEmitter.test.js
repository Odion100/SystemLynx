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

  it("contains a bad (circular) payload — logs it, surfaces a local error, never crashes", () => {
    const emitter = SocketEmiiter("circular-ns", WebSocket);
    const circular = { a: 1 };
    circular.self = circular; // circular reference → socket.io's synchronous encode throws

    let localReceived = false;
    let surfacedError = null;
    emitter.on("boom", () => (localReceived = true));
    emitter.on("error", (info) => (surfacedError = info));

    // capture the stderr line so the suite stays clean while we assert it actually happened
    const realError = console.error;
    let logged = null;
    console.error = (msg) => (logged = msg);
    try {
      // the guard must contain the throw — emit never unwinds out to the caller/process
      expect(() => emitter.emit("boom", circular)).to.not.throw();
    } finally {
      console.error = realError;
    }

    // a human sees it by default — the log is the baseline signal, not the local event
    expect(logged).to.be.a("string").that.includes("boom");
    // local listeners still fire regardless of the wire-encode failure
    expect(localReceived).to.equal(true);
    // and a programmatic observer is also notified
    expect(surfacedError).to.be.an("object").that.has.property("event", "boom");
  });
});
