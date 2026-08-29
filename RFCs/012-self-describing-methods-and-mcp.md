# RFC 012 — self-describing methods, and SystemLynx services as MCP tools

*Status: planned, not built.*

## The problem

An agent that speaks MCP cannot use a SystemLynx service. It is not a transport gap — the service
is already reachable, and `Client.loadService(url)` proves it — it is a **meaning** gap.

`connectionData` is addressing only. Straight off a live service:

```json
{ "name": "Users", "route": "/users",
  "methods": [ { "method": "post", "fn": "get" }, { "method": "post", "fn": "list" } ] }
```

Modules, method names, verbs, routes. No parameter names, no types, no return shapes, no
descriptions. So a consumer can address every method in the ecosystem and correctly call none of
them. `name` falls out of the manifest; `description` and `inputSchema` do not, and that gap is
this RFC.

## The decision

**A method describes itself, in the service, in code.** The description rides `connectionData` the
same way addressing does, so any consumer that can reach the service can read it — no second
system, no side channel, no service to be running besides the one you are calling.

Three consequences, all of them deliberate:

- **MCP is a consumer, not an architecture.** The framework grows *definitions*; a separate adapter
  translates them to MCP. Nothing about the protocol reaches into the service.
- **Nothing executes on anyone's behalf.** A tool call is an ordinary client call from the agent's
  own client, so express middleware, before/after hooks and `this.req` run because it is a genuine
  request. There is no loopback, no proxy, no forwarded credential.
- **Meaning is not observability.** SystemView is not in this path. It facilitates authorship
  (below) and nothing else.

## The API

Two calls with two different jobs.

```js
Service.module("Users", Users);

// what the method is — protocol-neutral, rides connectionData
Service.describe("Users", {
  get:  { description: "Fetch a user by id.",       input: { id: { type: "string" } } },
  list: { description: "List users in a location.", input: { location: { type: "string" } } },
});

// whether it is exposed as a tool — MCP policy, off by default
Service.MCP.serve("Users.get");
```

`describe` is neutral on purpose: what it carries is what a typed client generator, an OpenAPI
export or autobot's own runtime would want. Naming it after one protocol would guarantee a second
one gets written later to avoid the odd import.

`MCP.serve` is where the protocol's name belongs, because exposure *is* protocol policy. It is
**off by default**: a method that nobody served is not a tool, so acting methods (`signUp`, `save`,
`patchLocations`) cannot be reached by an agent because someone forgot, only because someone chose.

`App` composes services and must carry both, or the framework is two-tier — a module registered
through `App.module` has to be describable exactly like one registered through `Service.module`.

## What lands in `connectionData`

Additive, optional, and ignorable. A method entry grows two fields:

```json
{ "method": "post", "fn": "get",
  "description": "Fetch a user by id.",
  "input": { "id": { "type": "string" } },
  "mcp": true }
```

Nothing breaks by not adopting it: a service that never calls `describe` publishes exactly what it
publishes today, and every existing client keeps working. A method with no description is not a
gap in the manifest, it is a method that is not a tool.

**Descriptions are short — a sentence.** Every tool description enters a model's context on
`tools/list` before it has done anything, so long-form prose there costs the window and a client
pulling several services multiplies it. Documentation stays documentation; this is API surface.

## The adapter

Something has to speak MCP to an agent that does not know SystemLynx. That is a small package the
agent runs — its own, not part of `systemlynx-client`, because a browser client should not carry an
MCP SDK it will never load.

It does three things:

1. reads `connectionData` from a service URL,
2. presents every served method as a tool, `Service.Module.method` verbatim (the SDK's tool name is
   `z.string()` — no charset rule, checked against `@modelcontextprotocol/sdk@1.30.0`),
3. dispatches `tools/call` through `systemlynx-client`.

**Identity is the caller's.** The call carries whatever the agent's client set, exactly like any
other consumer, and SystemLynx keeps having no opinion about the scheme — a module reads `this.req`
and takes what it wants. Two rules survive: identity is **never a tool parameter** (a model
inventing whose behalf it acts on is a hole, not a bug), and a method that requires identity and got
none **fails loudly** rather than proceeding as nobody.

## Where SystemView fits

Outside. It writes schema **files** into the repo — ordinary code that a service imports and passes
to `describe`, exactly as a developer would have typed it. It can generate a candidate from saved
test payloads and flag drift when a declared schema and the last successful call disagree.

That is the whole relationship: authorship help before the fact, verification after it, no coupling
at run time and no requirement that SystemView exists at all.

Which also settles the question a test payload can never answer — whether a field is **required**.
A payload proves a field *can* be sent; only the declaration asserts. Inference proposes, the code
decides, and the code is the thing that ships.

## Build order

1. **`describe` + the `connectionData` fields.** The framework change, additive, provable with one
   service and a `GET`.
2. **The adapter, list-only.** Point an MCP client at a service and see its tools. Nothing callable.
3. **`tools/call` through the client.** A working MCP server for any agent.
4. **`MCP.serve` as a real switch**, with acting methods turned on deliberately, one at a time.

Steps 1–2 are provable the day they land. 3–4 are what make it safe to expose anything that writes.

## Open

- **One roof or two.** `Service.describe` + `Service.MCP.serve` as written here, or everything under
  `Service.MCP.*`. Smaller surface to teach, at the cost of naming neutral data after one protocol.
- **Schema shorthand.** `input` above is JSON Schema, because MCP requires it. A shorthand
  (`{ id: "string" }`) that compiles to JSON Schema would be friendlier to write and is a separate,
  additive question.
