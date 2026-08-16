# clone-join hangs silently forever when the socket can't connect — no timeout, no error, no retry

**Dropped by buAPI, 2026-08-17**, while validating the ssl-symmetric LoadBalancer setup locally
with self-signed certs. Sibling of
[LOADSERVICE_HANGS_SILENTLY_OVER_SELF_SIGNED_HTTPS](LOADSERVICE_HANGS_SILENTLY_OVER_SELF_SIGNED_HTTPS.md) —
same socket-layer trigger (socket.io-client ignoring `NODE_TLS_REJECT_UNAUTHORIZED=0`, already
documented there), **different victim with a different blast radius**: not a service's own boot,
but its membership in the cluster.

## Symptom

Every service boots https cleanly and the LoadBalancer serves https correctly (discovery `GET`
200, engine.io handshake 200 at `/loadbalancer/socket.io`) — but no service ever appears in the
cluster: every `GET /<serviceId>` discovery route 404s, with **zero output anywhere**. Services
run, take traffic, and are simply not members.

## Root cause

`LoadBalancer/clone.js` (~line 93), inside the join flow:

```js
await new Promise((resolve) => lb.on("connect", resolve));
```

No timeout, no `connect_error` handler, no retry. The HTTP fetch of the LB's connection data
succeeds, then the socket connect never fires (here: cert rejection inside socket.io's transports;
in general: any transient socket failure) — and the join awaits forever. The `catch` around the
join never fires because nothing rejects. Contrast the prod EPROTO failure, which at least printed
a stack: this one is invisible.

**Repro proof:** against a live https LB, `createClient().createService(lbConnData)` +
`lb.on("connect")` times out with no event; the identical raw connect succeeds the moment
`rejectUnauthorized: false` is passed — so the join logic itself is what turns a connectable-in-
principle failure into permanent silent absence.

## Why this is worse than the loadService sibling

A service that fails `loadService` hangs its own boot — loud in effect, you notice the port never
binds. A service that fails the clone-join **boots fine and serves fine** while silently missing
from discovery — every peer that resolves it through the LB breaks instead, one hop away from the
actual failure.

## Fix shape

Timeout on the socket connect + loud error + retry, matching `loadService`'s `{ limit, wait }`
options. A clone-join must fail loud, never hang silent. (TLS options pass-through is the sibling
gap's fix and unblocks the self-signed local rehearsal of the prod https topology.)

## Verification (buAPI as the harness)

Self-signed certs live from `.envExample`, boot the stack: every `curl -sk
https://127.0.0.1:4200/<serviceId>` must answer 200 (today: all 404). Second leg: kill the LB, boot
one service — expect a loud join failure within the timeout instead of silence.
