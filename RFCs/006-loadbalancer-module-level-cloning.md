# RFC 006 — Module-level cloning through the LoadBalancer

**Status: early idea, not yet designed.** Captured so it isn't lost; to be fleshed out before any code.

## The idea

Today you scale by cloning a whole **service** (see `SCALING.md`): deploy another instance of the
monolith, register it, the LoadBalancer round-robins across the clones. The finer-grained move is to
scale a single **module**: because the codebase is cleanly separated, you can copy one hot module *and
its dependencies* into a **standalone service** and deploy that alone.

The catch is seamlessness. The client experience must stay identical: **the client still just hits the
LoadBalancer and gets back clones** — it shouldn't know that the extra capacity for `Orders.reprice`
now lives in a *different* service than the rest of `Orders`. But physically, that module now lives in
another service at another location. So to reach it, the client would otherwise have to load *another*
service.

## The question

Can modules be **injected through the LoadBalancer in an abstract way** — presented as part of their
original service even when a clone of a module physically lives in a *different* service/location?

Concretely, the LB (Tentacle) would compose a **logical service view** whose modules map to
**different physical locations**:

- A service's `connectionData` today is service-level: a single `serviceUrl` + a `modules[]` list, all
  assumed to live at that one location.
- Module-level cloning needs the module to carry (or the directory to attach) its **own location** — so
  a single logical service can have most modules served from location A and a hot one served from the
  module-clone at location B.

## What has to reconcile on the client (RPC side)

The client's `createService` / `ClientModule` build one proxy per module off the service's
`connectionData`, all pointed at the same `serviceUrl`. For module-level cloning, the client RPC must
reconcile a service whose modules point at **more than one location** — build some module proxies
against location A and the cloned module's proxy against location B, transparently, with the LB's
routing/failover applying per module.

## The seed that already exists

There was an early, intentionally-unused function for **connecting a single module alone** (as opposed
to loading a whole service). It was a placeholder for exactly this idea — never wired up, and it
surfaced as an error because it wasn't fully wrapped. It's the starting point: "load/connect a module
independently of its parent service" is the primitive this feature needs.

## Open questions (for when we design it)

- Does `connectionData` gain **per-module location** (each module entry can override `serviceUrl`), and
  the LB directory stitches the logical view?
- Does the Tentacle register **modules**, not just services — i.e. a clone announces "I serve module X
  of service Y" and the LB folds it into Y's directory entry?
- How does per-module routing / least-load / failover compose with the existing per-service routing?
- What's the deploy story for "a module + its dependencies as a standalone service" — tooling, or just
  convention?

## Relationship

The natural extension of `SCALING.md`'s "extract a hot service and clone it," one level finer: **extract
a hot *module* and clone it**, with the LoadBalancer hiding the seam so the client never sees that a
service's modules are physically split. Loosely pairs with `RFCs/005` (the client hook/plugin surface);
this one is about the client RPC reconciling a multi-location service.
