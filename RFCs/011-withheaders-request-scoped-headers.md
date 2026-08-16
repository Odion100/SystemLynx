# RFC 011 — `withHeaders`: per-call headers on a shared client

*Status: built. Reported by buAPI; shape decided by Odion.*

## The problem

`setHeaders` is configuration — it merges into an object that lives as long as the client, and
`Client.cachedServices` hands every caller the same client. So a per-request value written there is
ambient: the last writer owns every later call from every later request.

buAPI hit it in production. A stale `Internal-Identity` rode an internal `Profiles.Teams.add`, and
the wrong user was stamped `root_admin` of a new team. Their mitigation — blanking the header before
service-only calls — proved **racy**: an interleaved `signIn` → `hydrateSeasons` → Basketball call
re-stamped the shared client after the blank and before the send.

No call-site discipline fixes shared mutable state; the window between clearing and sending belongs
to every other request in the process.

## The design

`setHeaders` keeps its meaning: configuration that applies everywhere.

`withHeaders(extra)` returns a **view** of a module or service carrying extra headers for calls made
through it. It mutates nothing, so a concurrent request never sees them.

```js
await Teams.withHeaders({ "Internal-Identity": sid }).add(team);

const asAlice = Profiles.withHeaders({ "Internal-Identity": sid });
await asAlice.Teams.add(team);
await asAlice.Users.get(id);
```

The view is a normal handle — call as many methods on it as you like. It is not single-use and does
not throw on reuse; that would be a punishment, not a design.

Precedence is `service headers → module headers → view headers`, so a view narrows without
destroying configuration underneath it. Views chain, later keys winning.

## Why it is small

- `sendRequest` takes `self` from `this` at **call** time, so calling through a Proxy view is what
  `self.headers()` resolves against. No rebinding.
- Headers already compose in layers; the view is one more with highest precedence.
- RFC 007/008 already return caller-bound Proxy views this way — same pattern, not a new one.

Service-level scoping cannot work by overriding `Service.headers()`, because the handler holds the
service in a closure rather than reading `this`. It scopes each module view instead; module headers
layer above the service's, so the result is identical.

A view is read-only — assigning through it throws, so it can never become a way to write onto the
shared module.

## Testing

`systemlynx/Client/tests/withHeaders.test.js` — headers reach the call; several calls on one view all
carry them; nothing leaks onto the shared module afterwards; two views do not see each other;
`setHeaders` configuration survives underneath; service-level scoping reaches every module; views
chain.

## Not done here

`setHeaders` still accepts identity-shaped headers. Refusing them is what would make "identity is
never ambient" a guarantee rather than a convention — worth deciding separately, since it would
deliberately break buAPI's current mitigation.
