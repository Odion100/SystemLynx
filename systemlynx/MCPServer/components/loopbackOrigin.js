// WHICH ORIGIN THE MOUNTED MCP SERVER DIALS WHEN IT CALLS ITSELF.
//
// The mounted form (`createMCPServer(service)`) deliberately goes back through the service's own
// front door, so middleware, `this.req` and auth all run for an agent exactly as for any caller.
// That means it needs an origin for itself — and where that origin comes from is a security
// property, not a convenience.
//
// IT COMES FROM THE ACCEPTED CONNECTION, NEVER FROM A HEADER. An earlier version built it from
// `req.headers.host`, which is caller-controlled: a POST carrying `Host: anywhere` made the server
// `loadService` THAT host and forward the caller's headers to it — SSRF with credential forwarding,
// reachable by anything that could reach the endpoint, and it grew a cached service (and sockets)
// per spoofed host. `socket.localAddress`/`localPort` are properties of the TCP connection, so they
// cannot be forged; `socket.encrypted` likewise beats `req.protocol`, which would trust
// `X-Forwarded-Proto` if the app ever enabled trust proxy.
//
// AND IPv6 LOOPBACK IS DIALLED AS IPv4 LOOPBACK. On a dual-stack host, a service started with
// `host: "localhost"` binds `*` on an IPv6 socket, so an accepted connection reports `::1` — and
// the URL that produces, `http://[::1]:PORT`, is legal and broke every mounted MCP call: WHATWG
// `URL.hostname` keeps the brackets, and older axios (measured: 1.6.8 ENOTFOUND, 1.18.0 fine) hands
// `[::1]` straight to getaddrinfo. Tools listed; every call died. A library cannot choose which
// axios a consumer has hoisted, so it must not emit the shape that breaks on the old one.
//
// Safe because the dual-stack listener answers on both literals (verified with curl against one
// process), and applied ONLY to loopback: a genuine IPv6 peer still gets brackets, which is correct
// in a URL.
const LOOPBACK_V6 = /^(::1|::)$/;

/** The origin this server should call itself on, derived from the connection the request arrived on. */
function loopbackOrigin(req = {}) {
  const socket = req.socket || {};
  const raw = String(socket.localAddress || "127.0.0.1").replace(/^::ffff:/, "");
  const host = LOOPBACK_V6.test(raw) ? "127.0.0.1" : raw.includes(":") ? `[${raw}]` : raw;
  const port = socket.localPort;
  const protocol = socket.encrypted ? "https" : "http";
  return `${protocol}://${host}${port ? `:${port}` : ""}`;
}

module.exports = loopbackOrigin;
module.exports.loopbackOrigin = loopbackOrigin;
