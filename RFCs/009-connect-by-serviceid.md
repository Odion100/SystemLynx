# RFC 009 — Connect by serviceId (first-class client discovery)

*Status: **WITHDRAWN**. This proposed a framework change that isn't needed. Kept for the record with the correction below.*

## Why withdrawn

`Client.loadService(url)` takes a URL and fetches a service descriptor from it (`loadConnectionData` → `httpClient.request({ url })`). The LoadBalancer's discovery route `GET /<serviceId>` (RFC 006) already returns a valid, self-describing, failover-aware descriptor. So:

```js
// This already works today, unchanged. No new API.
const Profiles = await Client.loadService("http://host:PORT/Profiles");
```

`loadService` neither knows nor cares that the URL points at a LoadBalancer — it's just a service URL. The proposed `loadService(serviceId, { loadbalancer: LB_URL })` object form was **unnecessary invention** (ergonomic sugar dressed up as a requirement). There is **no framework prerequisite** for LB adoption — RFC 006 already ships everything.

## What adoption actually is

Client side: point the existing `loadService` call at the LB's discovery URL (`http://host:PORT/<serviceId>`) instead of the direct service URL. That's the whole change.

Server side: `App.use(LoadBalancer.clone({ url, serviceId }))` per service (already exists).

The only real prerequisite is operational: **the LB must be running at a decided port** before a client points at it (pointing at a LB that isn't up breaks boot).

## If a genuine need surfaces later

The one thing RFC 006 puts in the connData but doesn't expose on the loaded handle is the `discovery` / `serviceId` provenance flag (so a consumer/SystemView could tell a handle came through discovery vs a direct URL). That is a *small, separate* nicety — not a prerequisite, not a reason to change `loadService`'s signature. Raise it on its own merits if it's ever actually wanted.
