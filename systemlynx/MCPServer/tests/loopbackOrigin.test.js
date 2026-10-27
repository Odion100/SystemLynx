const loopbackOrigin = require("../components/loopbackOrigin");

// The origin the MOUNTED server dials when it calls itself. Two properties, and both were paid for:
// it comes from the CONNECTION (never a header — that was SSRF with credential forwarding), and it
// never emits a bracketed IPv6 loopback literal (that broke every mounted call on older axios,
// found by autobot's shell service as the first real consumer of this feature).
const req = (socket) => ({ socket, headers: { host: "attacker.example:1234" } });

describe("loopbackOrigin — what a mounted MCP server dials for itself", () => {
  it("is built from the accepted connection, so a hostile Host header cannot steer it", () => {
    expect(loopbackOrigin(req({ localAddress: "127.0.0.1", localPort: 4000 }))).toBe(
      "http://127.0.0.1:4000",
    );
  });

  it("dials IPv6 LOOPBACK as 127.0.0.1 — a dual-stack listener answers on both, and the bracketed literal did not resolve", () => {
    // `host: "localhost"` binds `*` on an IPv6 socket, so a real connection reports `::1`. The URL
    // `http://[::1]:4000` is legal and still failed: WHATWG `hostname` keeps the brackets and older
    // axios hands `[::1]` to getaddrinfo → ENOTFOUND. Tools listed, every call died.
    expect(loopbackOrigin(req({ localAddress: "::1", localPort: 4000 }))).toBe("http://127.0.0.1:4000");
    expect(loopbackOrigin(req({ localAddress: "::", localPort: 4000 }))).toBe("http://127.0.0.1:4000");
  });

  it("unwraps an IPv4-mapped address rather than treating it as IPv6", () => {
    expect(loopbackOrigin(req({ localAddress: "::ffff:127.0.0.1", localPort: 8080 }))).toBe(
      "http://127.0.0.1:8080",
    );
  });

  it("still brackets a GENUINE IPv6 address — that is correct in a URL, and only loopback is remapped", () => {
    expect(loopbackOrigin(req({ localAddress: "fd00::5", localPort: 9000 }))).toBe(
      "http://[fd00::5]:9000",
    );
  });

  it("follows the socket's own encryption, not a forwarded-proto header", () => {
    expect(loopbackOrigin(req({ localAddress: "10.0.0.7", localPort: 443, encrypted: true }))).toBe(
      "https://10.0.0.7:443",
    );
  });

  it("answers something usable when the socket says nothing — never an empty origin", () => {
    expect(loopbackOrigin({})).toBe("http://127.0.0.1");
    expect(loopbackOrigin(req({}))).toBe("http://127.0.0.1");
  });
});
