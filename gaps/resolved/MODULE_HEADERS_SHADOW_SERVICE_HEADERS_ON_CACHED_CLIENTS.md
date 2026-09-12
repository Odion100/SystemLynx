# Module-level headers permanently shadow service-level headers on cached clients

> **RESOLVED 2026-08-08 — fixed in `systemlynx@3.3.2`** (registry, 12:23Z): headers now layer —
> `{ ...Service.headers(), ...self.headers() }`. Verified live: the buAPI `Games.add` repro below
> passes on 3.3.2 (game created 12:36Z, nested `Teams` hop authenticates). History below kept for
> context — including the earlier 3.3.1 publish that was believed to carry this fix but didn't.
>
> ~~**STATUS 2026-08-08 — a fix for this gap was believed published; follow-up verification shows it
> was NOT.**~~ The 3.3.1 publish (registry, 2026-08-08 10:27Z) was expected to carry the fix — buAPI
> was told to pull it in to unblock the `Games.add` repro below. Pulling the actual registry
> tarball shows it contains the RFC 006 module-connection cloning but NO change to this gap:
> `ServiceRequestHandler.js` still reads
> `headers = !isEmpty(defaultHeaders) ? defaultHeaders : Service.headers()`. The header fix has not
> been written in the SystemLynx working tree either (checked same day) — this gap is unfixed
> everywhere, not merely un-shipped. The line exists in
> BOTH clients and both need the change: `systemlynx/Client/components/ServiceRequestHandler.js:67`
> and `systemlynx-client/systemlynx/Client/components/ServiceRequestHandler.mjs:64`.
>
> Consumer trap that muddied tracking this: buAPI's `package.json` pins
> `"systemlynx": "file:...scratchpad/systemlynx-3.3.1.tgz"` — a stale pre-publish local pack with
> the SAME version number as the registry artifact. A registry publish under 3.3.1 can never reach
> it; two different artifacts share one version string. Next publish should bump (3.3.2) and buAPI
> should switch to the registry spec, so artifact = version again.
>
> Live repro stands ready in buAPI: `systemview probe Mocks.Games.createGames ...` → nested
> `Profiles.Users.get` passes, nested `Profiles.Teams` hop 401s (`user authentication failed`) —
> reproduced identically 2026-08-07 12:48Z and 2026-08-08 10:29Z.

A client call sends **either** the module's headers **or** the service's — never both.
`ServiceRequestHandler` picks at request time:

```js
const defaultHeaders = self.headers();   // module-level
const headers = !isEmpty(defaultHeaders) ? defaultHeaders : Service.headers();
```

The instant anything calls `Service.SomeModule.setHeaders(...)`, that module stops seeing
service-level headers — and since `HeaderSetter` only ever `Object.assign`s into the same headers
object (there is no clear/reset), the module can never fall back again for the life of the process.
Combined with `Client.cachedServices` (one shared service instance per URL per process), one
`setHeaders` on a module handle inside ONE request pins those headers onto every later request's
calls through that module, process-wide.

## Observed in buAPI, systemlynx 2.1.0 → 3.3.1 upgrade (2026-08-07)

The same buAPI code behaved differently across the upgrade — no buAPI changes in between:

- Basketball's `Games.add` sets per-request auth at the **service** level
  (`validateTeamRosters.js`: `Profiles.setHeaders(internalAccessHeaders(req))`) and then makes
  nested `Users.get` and `Teams.get` calls.
- A separate flow (`Seasons/middleware/registerSeasonWithHost.js`) sets per-request auth on a
  **module** handle: `useService("Profiles")[profile_type].setHeaders(...)`.
- On 2.1.0 (through 07:25 that morning) `Games.add` worked end to end. First run after the 3.3.1
  upgrade + restart (08:32), it failed — and the failure is asymmetric in a way only header
  precedence explains. Basketball trace:

  ```
  12:48:55.520Z  trace start  Games.add  user: 6a3c81…            ← authenticated, running as the caller
  12:48:55.855Z  trace error  Games.add  {"message":"User authentication failed","status":401}
  ```

  Profiles trace, same second:

  ```
  12:48:55.591Z  trace start  Users.get   ← passes (module headers empty → service headers used)
  12:48:55.750Z  trace start  Users.get   ← passes
  12:48:55.854Z  debug authenticate Teams ← 401 thrown; request arrived without the service-level auth
  ```

  Same service handle, same request, seconds apart: the module whose handle had ever been
  `setHeaders`-ed loses the fresh service-level credentials; the untouched module keeps them.

## Why it's a trap

- The precedence is **replace, not merge**, so a module-level set silently drops everything at the
  service level (auth tokens included) rather than layering on top of it.
- It's **sticky**: headers objects are only ever assigned into, never cleared, and the client cache
  makes the service instance a process-global — so the shadowing is permanent and shows up far from
  the code that caused it, in whatever request happens to run later.
- It's **stateful per-request data in a process-shared object**: any per-request value (an identity
  header, a trace id) set at module level outlives its request and rides along on other callers'
  requests through that module.
