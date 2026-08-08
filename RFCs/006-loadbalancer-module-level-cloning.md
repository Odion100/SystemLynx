# RFC 006 — Module-level attachment through the LoadBalancer (by `serviceId`)

**Status: designed.** Supersedes the earlier "early idea" draft.

## Thesis

Physical services that hold modules **previously grouped together** (in one monolith) can **attach**
into a single logical service, keyed by **`serviceId`**. A client makes **one** `loadService` call and
gets **one** service back, even when its modules physically live in several deployments. The
LoadBalancer composes the union; the client is none the wiser.

This is **additive and backwards compatible on the default path**: a plain service whose modules all
live at one location behaves byte-for-byte as today. The *only* contract that changes is the
**LoadBalancer's own** — and it owes no compatibility, because it has never been meaningfully adopted.
That freedom is what lets us do the right thing instead of bolting onto the old route-keyed model.

## Background — the assumption that changes

Today `Tentacle.services = [{ route, name, locations: [url], index }]`, and every `location` under a
service is assumed to be an **identical full copy**. On a load, `routeToClone` → `pickLocation` picks
**one** location and returns **its** `connectionData` verbatim — so the client gets every module at that
single location (`systemlynx/LoadBalancer/components/Tentacle.js`).

That "interchangeable full copies" assumption is the whole of what this RFC changes. Members sharing a
`serviceId` may host **different module subsets**, so the LB must stop returning one location's connData
and start **composing the union**.

`serviceId` is already a first-class value — not a new concept: `clone.js` registers a clone under
`name: serviceId` (`systemlynx/LoadBalancer/clone.js`), matching the SystemView plugin convention. The
attach key exists today; this RFC leans on it.

## Design

### 1. `serviceId` is the attach key **and** the LB route

The LB serves logical services at **`/{serviceId}`** (not the physical service's internal `route`). The
registry keys on `serviceId`. Members declare the same `serviceId` to attach; being a partial
deployment, a member simply exposes fewer modules. A client loads `${LB}/{serviceId}`.

This unifies identity across the family: SystemView already keys everything by `(projectCode,
serviceId)`, so the LB's address and SystemView's identity key become **the same value** — zero
translation.

### 2. Registry becomes `serviceId → per-module → locations`

`register({ url, serviceId })` already fetches the member's `connectionData` (module list + location).
The Tentacle records, per member location, **which modules it hosts**. Conceptually:

```
services: [{
  serviceId,                       // the logical service (was `name`)
  route: `/${serviceId}`,          // the LB-served discovery route
  modules: {                       // module name -> the locations that host it
    Orders:    [locA, locB],
    reprice:   [locC],             // the extracted, separately-scaled module
  },
  index,                           // per-module round-robin cursors
}]
```

Members hosting the full set (today's whole-service cloning) land every module at every location — the
union degenerates to the current behavior.

### 3. Load-time composition (the core change)

On `GET /{serviceId}`, the Tentacle **composes** a connectionData whose `modules[]` is the **union**
across members, and **each module entry carries its own resolved location** (a per-policy pick among the
locations that host *that* module). `serviceUrl` points back at `${LB}/{serviceId}` so failover
re-fetches the composed view.

Per-module routing extends the existing `pickLocation` from per-service to per-`(serviceId, module)` —
same round-robin / least-load / stale-eviction logic, applied to each module's location set.

### 4. Self-describing connData (so consumers can *see* the topology)

The composed response already must carry `serviceId` + the per-module location map to route. We also
stamp a **discovery marker** (e.g. `discovery: true`, plus `lbBase`). Consequences:

- **Correctness needs none of it.** The client behaves identically whether the URL resolved directly or
  via discovery — transparency holds. That is *required*: routing the local monolith through the LB
  must not change behavior.
- **Observability gets it for free.** Any consumer (SystemView) that receives the connData can *see*
  "logical service `orders`, served across these physical locations, via the LB" — with **no special API
  and no 'am I behind an LB?' query.** It renders logical→physical topology straight from the payload.
- **Backwards compatible.** A plain direct service's connData lacks `serviceId`/`discovery` → falsy →
  direct. No marker, no union, no change.

### 5. Client — no behavioral change

The client already: makes one `loadService` call and gets one service; resolves each module's location
independently via `__connectionData()`; and even destructures a per-module `connectionData` slot it does
not yet use (`systemlynx/Client/components/ClientModule.js`). So when the composed connData hands modules
at different locations, the client just does what it already does. Enabling it is **honoring** the
per-module location the shape already anticipates — not new routing.

Two touches, both additive (absent data ⇒ today's behavior):

1. **Apply** per-module location: feed each `ClientModule.__setConnection` its own `host/port` from the
   composed connData instead of the shared service-level one.
2. **Failover per module:** today `Service.resetConnection` re-fetches the whole service and clobbers
   **every** module to one `host/port` (`systemlynx/Client/Client.js`). It must re-resolve **per
   module** from the composed view, so one module's dead location doesn't drag its siblings. The retry
   path in `ServiceRequestHandler` (`ErrorHandler` → `resetConnection`) inherits this.

The per-call URL building is already per-module and needs nothing.

### 6. Service / ServerManager — minimal

A member declares its `serviceId` (already flows through `clone.js`) and exposes whichever module subset
it hosts (already in its own `connectionData`). No new per-module wire format on the service side; the
composition happens in the LB from what members already report.

## Failover semantics

A module call fails → `ServiceRequestHandler` reconnects via `resetConnection` → re-fetches
`${LB}/{serviceId}` → the Tentacle re-composes with a **live** location for that module → the client
re-points **just that module**. Siblings, served from healthy locations, are untouched. Dead locations
are evicted from the module's location set by the existing stale/`location_removed` machinery.

## Backwards compatibility

- **Default client path: identical.** One full service (or whole-service clones) ⇒ union = full set ⇒
  every module at every location ⇒ today's behavior exactly.
- **LB own contract: changed, unowed.** Route-by-`serviceId` and composed-union replace route-by-`route`
  and verbatim-connData. Acceptable precisely because the LB has no real adopters yet.
- **`systemlynx-client`:** the per-module apply + per-module failover mirror into the ESM client (its
  `createService`/`ClientModule` share the same shape). Verify during implementation.

## SystemView adoption (their call, needs nothing extra from us)

SystemView plans to route even the local monolith **through the LB** so future relocations are
invisible. That is a SystemView-side decision — point at `${LB}/{serviceId}` instead of a direct URL.
The framework enables it with exactly the self-describing connData above; no additional API. SystemView
loaded *inside* the LB still reads `getClusterState()` for the in-process cluster view (RFC-shipped);
a SystemView connecting *through* the LB as a consumer learns the topology from the composed connData.

## Non-goals

- **LB as a data-path proxy.** It stays **discovery-only** — the client talks directly to each module's
  location. No per-call hop through the LB.
- **Deploy tooling** for "a module + its dependencies as a standalone service." Convention for now.

Note: per-module **routing** (picking a location per module) is **in scope** and is the core of the
composition (§3). The only thing not addressed is a per-module *balancing policy* knob (module X on
`least-load` while module Y is `round-robin`) — the composition uses the service-wide policy; that knob
is simply out of scope, not a shelved part of this feature.

## Testing (usage-shaped)

1. **Attachment:** two member services with **disjoint** module subsets register under one `serviceId`;
   `loadService(${LB}/{serviceId})` returns the **union**; calling a module on member A and a module on
   member B each hits the correct physical location.
2. **Backwards compatible:** a single full service (or whole-service clones) yields identical connData
   behavior — every module resolvable at the one/any location.
3. **Per-module failover:** kill the location hosting module X; a call to X reconnects and re-resolves X
   to another member hosting X, while a sibling module served elsewhere keeps working uninterrupted.
4. **Self-describing:** composed connData carries `serviceId` + `discovery` + per-module locations; a
   plain direct service's connData carries none of them.

## Relationship

The finer-grained sibling of `SCALING.md`'s "extract a hot service and clone it": **extract a hot
*module* and clone it**, with the LB hiding the seam. Pairs with the coupling observability (RFC 007
call edges + RFC 008 event edges) — the coupling graph tells you *which* module is safe to extract;
this RFC is *how* the extracted module is served seamlessly.
