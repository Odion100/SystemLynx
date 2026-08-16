# RFC 010 — Client socket teardown on reconnect

*Status: approved. Reported by BUApp; verified against source before agreeing.*

## The problem

A long-lived client leaks one socket per module per reconnect, forever. BUApp measured 34,418
ESTABLISHED connections against a 16,384-port ephemeral range — the machine ran out of ports and
`ssh` failed with `EADDRNOTAVAIL`.

Three mechanisms, all confirmed in source:

1. `SocketDispatcher` calls `io.connect()` on **every** application — nothing closes the previous one.
2. `Service.resetConnection` re-applies `SocketDispatcher` onto the same Service. The only handle to
   the old socket was `dispatcher.disconnect`, and the new application **overwrites it**, so the old
   socket becomes unreachable.
3. `Service.on("disconnect", Service.resetConnection)` — every disconnect runs it.

Two amplifiers BUApp's report missed:

4. **It leaks per module.** `ClientModule.__setConnection` also applies `SocketDispatcher`, and
   `resetConnection` calls it for every module — so one reconnect leaks **1 + M** sockets.
5. **The event-wrapper chain nests.** Each application re-wraps `on`/`once`/`$clearEvent`/`destroy`
   around the already-wrapped versions. Measured: three applications → three wrapper layers per
   single `.on()`, each emitting `subscribe` on its own socket. Teardown alone does not fix this.

One correction to the reported mechanism: the *transient disconnect* path partly self-heals, because
`socket.on("disconnect")` calls `socket.disconnect()`, which sets socket.io's `skipReconnect`. The
unbounded path is `resetConnection` **without** a preceding socket disconnect — per-module failover
(RFC 006), an HTTP-failure reconnect, or an explicit call.

## Design

### 1. Teardown before rebuild

`SocketDispatcher` exposes `dispatcher.disconnect`. Before re-applying it, call the existing one.
Applies at both levels — `Service.resetConnection` and `ClientModule.__setConnection`.

### 2. Re-application must be idempotent

Wrapping is done once per target. A re-application reuses the existing wrappers and only re-points
the socket, so the chain cannot grow. Keeping `subscriptionCounts` across the swap also means live
subscriptions are re-sent on the new socket, which is the behaviour that already existed.

### 3. Single-flight on reconnect

`disconnect → resetConnection` runs one reconnect at a time. A second disconnect while one is in
flight joins the existing attempt rather than starting another.

## Testing

Written **first**, and must fail before the fix:

- Load a service, bounce the server N times, assert the client holds **one** live socket
  (today: N × (1 + M) + 1). Asserted server-side via connection count — no `lsof` in CI.
- Assert one `.on()` produces exactly one `subscribe` after N reconnects (leak ⑤).
- Existing failover tests must stay green — teardown changes reconnect semantics, and RFC 006
  per-module failover is the delicate path.

## Risk

Every consumer reconnects: buAPI, BUApp, and SystemView's own hub client. BUApp holds an
`lsof`/`netstat` baseline and re-verifies at real scale after the fix.
