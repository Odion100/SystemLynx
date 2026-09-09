# RFC 012 — `createMCPServer` and `client.loadMCP`

*Status: built. Shaped over several passes with Odion; his corrections are folded in rather than
footnoted. One deviation from the plan, for the better: the MCP SDK turned out to be unnecessary on
BOTH sides — the server answers the three JSON-RPC methods directly (stateless plain-JSON, which the
spec allows), and `loadMCP` speaks the same JSON-RPC over the axios the client already ships. No new
dependency anywhere, and the browser client gets `loadMCP` for free.*

## The problem

An agent that speaks MCP cannot use a SystemLynx service. Not a transport gap — the service is
already reachable — a **meaning** gap. `connectionData` publishes addressing and nothing else:

```json
{ "name": "Users", "route": "/users",
  "methods": [ { "method": "post", "fn": "get" }, { "method": "post", "fn": "list" } ] }
```

Module, method, verb, route. No parameters, no types, no descriptions. A consumer can address every
method in the ecosystem and correctly call none of them.

## Two directions, both shaped like the SystemLynx that exists

| | today | with this RFC |
|---|---|---|
| **serve** | `createService()` → `.module()` → `.startService()` | `createMCPServer()` → `.schema()` → `.start()` |
| **consume** | `client.loadService(url)` | `client.loadMCP(url)` |

There is **no separate MCP client object**. The client built on load is the client.

---

## The shape a method should be, before any of the machinery

**A method meant to be consumed — by MCP, by a proxy, by anything whose caller holds a schema rather
than the signature — should take one object.** (Odion's point, and it reframes most of what follows.)

Everything this RFC builds to handle positional dispatch is the cost of methods that take several
arguments:

| | positional `f(a, b)` | object-shaped `f({ a, b })` |
|---|---|---|
| MCP hands one object | binds to `a`, `b` is undefined — **a plausible empty answer** | fits exactly |
| the arity check | needed | nothing to catch |
| middleware reading `"[1].sender"` | reads `undefined`; must fail closed | no index to miss |
| the input-fiction check | impossible — no names published | works, because the method names its own fields |

Positional is fine for internal code, where the caller is a programmer holding the signature. It is
the wrong shape at a boundary. The evidence is small but consistent: of the workbench's tools,
`reconcile` (no arguments) and `readRfc` (one object) were fine, and `grep(pattern, dir)` was the one
that broke.

**The checks below exist to catch what the framework permits. Object-shaped is what it recommends**,
and the machinery is scaffolding for methods that predate the advice.

## 1 · Serving — one server, many routes

An MCP endpoint is a **curated surface, not a mirror of the service**. A 12-module service published
as one endpoint hands an agent a menu of tools it will never call, and a host connected to three such
services multiplies it. The unit of exposure is therefore the **route**, and one server can carry
several.

*(This was originally argued on context cost — "every name, description and schema enters the model's
context on `tools/list`." A real host proved that host-dependent; see **What a real consumer's
context actually holds** below. The conclusion held, the reason changed.)*

### Standalone — fronting a service by URL

A standalone server owns its own listener and **fronts a SystemLynx service by URL** — every tool
call dispatches over HTTP to that service, through its front door, exactly as the mounted form does
locally. Useful when the MCP surface should live somewhere the service does not: a gateway box, a
separate process, a different port.

```js
const { createMCPServer } = require("systemlynx");

const mcp = createMCPServer("http://localhost:6312/users");   // the service it fronts

mcp.schema("Users", {
  get:  { description: "Fetch a user by id.", input: { id: { type: "string" } } },
  list: { description: "List users in a location.", input: { location: { type: "string" } } },
});

await mcp.start({ port: 7000, route: "mcp" });   // → http://localhost:7000/mcp
```

Handing a schema to an MCP server **is** the opt-in for the standalone form. There is no second
"publish" call — an earlier draft had `mcp.serve("Users.get")` per method, which was two yeses for
one question.

`createMCPServer()` with nothing behind it is legal but inert, and deliberately so: `tools/list`
works — the surface is **browsable but uncallable**, which is useful for inspecting a schema before
wiring it to anything — and a `tools/call` fails loudly — *"no service behind this server — construct with
createMCPServer(service) or createMCPServer(serviceUrl)"* — instead of guessing.

### Mounted on a service, with curated routes

```js
const service = createService();
service.module("Users", Users);
service.module("Teams", Teams);

const mcp = createMCPServer(service);

// Declarations live on the server, once — a method's shape is one fact.
mcp.schema("Users", { get: { description: "Fetch a user by id.", input: { id: { type: "string" } } } });

// Curation happens per route: each is one endpoint with its own tool list,
// drawing from the same declarations. Several surfaces, one server.
mcp.serve("support-mcp", { expose: ["Users.get", "Users.list", "Teams.add"] });
mcp.serve("admin-mcp",   { expose: ["Users"] });

await service.startService({ route: "users", port: 6312 });
// methods at :6312/users/…   tools at :6312/users/support-mcp and :6312/users/admin-mcp
```

Two methods, two jobs: `schema` declares what a method is; `serve` stands up an endpoint and decides
which methods it advertises. Nothing stops two served routes sharing a method.

The lifecycle mirrors a service — declare, then start:

```
Service:    module()  →  startService()
MCPServer:  schema()  →  serve()  →  start()        // standalone: owns its listener
                                  →  use(mcp.plugin) // mounted: rides an existing server
```

`start({ port })` is for the standalone form. When the server should ride a service that is already
listening, there is no second listener to start — `mcp.plugin` is the same mount expressed the way
the framework already expresses attachment:

```js
App.use(mcp.plugin);        // or service.use(mcp.plugin)
```

Either way the endpoints land on `App.server`; `start` and `plugin` are the same server with and
without its own port.

*(`serve` appeared in an earlier draft as a per-method switch and was rightly killed — two yeses for
one question. Here it earns the name: serving is standing up a surface.)*

### Per-module endpoints, automatic

Module is already an addressable level in the framework (`/route/Module/fn`), so the server gives
every module with declarations its own endpoint — `:6312/users/Users/mcp` — as routes it adds
itself — `mcp.serve("Users/mcp", { expose: ["Users"] })` in a loop. An agent picks its granularity by which URL it is pointed at:
`claude mcp add` the one module it needs, not the estate.

**There is no service-wide endpoint by default.** It is the surface that is always too big, and the
one people reach for because it is the obvious URL. If the whole service should be one tool list,
declare it: `mcp.serve("mcp", { expose: "*" })`.

### The route is the identity — and it is not access control

A caller does not say what it is; it points at a surface the server published:

```js
mcp.serve("buAPI-mcp",      { expose: ["Core", "buAPI"] });
mcp.serve("systemlynx-mcp", { expose: ["Core", "systemlynx"] });
```

An earlier draft of this discussion had the caller assert its scope in a header. That is weaker: a
header is caller-supplied, and since `tools/call` guards on exposure, a caller-asserted scope means
the caller decides what it may call — the same shape as identity-as-a-tool-parameter, moved to the
headers. A route removes that: nobody can claim a surface that was never published.

**But a route removes forgery, not access** (systemview-test's sharpening, and it belongs here).
Whoever can reach `buAPI-mcp` gets buAPI's surface. Route scoping is curation — keeping an agent's
context small and its reach deliberate — **not a permission model**. The moment a surface matters,
put HTTP auth on the route; §6 already inherits it, because whatever the service's auth does, it
keeps doing.

### Not built: a surface that varies per request, and `listChanged`

Both were proposed, one was built and then removed. The reasoning is kept because it is worth more
than the code was, and because a future implementer should get the hazards for free.

**Variation per request** — `expose` as a function, resolved per call, so one endpoint could answer
differently depending on who is asking. Proposed for a surface that follows a human's navigation.
That case is **empty**: systemview-test checked autobot's shell rather than guessing, and every
session there is its own MCP client with its own `cwd` and its own config, so a project's agent
already has a fixed scope. Static route per project is the whole answer. The case that would
survive is variation by **authenticated principal** — once a route carries HTTP auth, the same URL
answering with an admin or a read-only surface — but nothing has that today, so it waits for a
consumer rather than shipping for a hypothetical.

Two rules any future implementation must keep, learned the expensive way in review:

- **Resolve once per request, use for both `tools/list` and `tools/call`.** Exposure is the
  permission boundary — a method is unreachable because it is unexposed, not merely unlisted.
  Resolving separately per path would let a surface advertise one list and permit another.
- **A resolver that throws must expose NOTHING** — never the `"*"` default, which would turn one bad
  function into a full-estate surface.

**`listChanged`** — `capabilities.tools.listChanged` plus an outbound
`notifications/tools/list_changed`. This transport is stateless: `GET` returns 405 and there is no
open stream to push down, so it needs the `GET → SSE` branch, per-route subscriber tracking,
`Mcp-Session-Id` correlation and teardown — trading away restart-and-scale-for-free.

**These two are separate features, not two steps of one build**, which is the finding of that
review. A per-request resolver needs no push: the caller is already asking, so the answer is
computed then. `listChanged` exists only for a surface that moved **server-side**, with no request
coming to collect it. Only the second one costs statelessness, and neither has a consumer today.

Worth recording either way: a swap lands at a **turn boundary** — tools already in a live turn do
not vanish mid-thought, so nobody should design a surface assuming per-thought granularity.

### Tool naming

Tools keep the full `Module.method` name on every route, so two modules' `get` stay distinguishable
within one surface. A few tokens buys unambiguity.

**Corrected after a real host consumed these routes.** The original claim here was that full names
also stop a method answering to two names depending on where it was reached. That is false. A host
prefixes its own server name and rewrites the dot, so `Repo.findRfc` served on two routes arrives as
two distinct tools — `mcp__workbench__Repo_findRfc` and `mcp__wb-repo__Repo_findRfc`. Naming cannot
make identity stable across routes; only serving a method on one route can. This is the real cost of
*one server, many routes*, and it is the director's to weigh: a method on two surfaces is two tools
to whoever is choosing, and nothing stops them trying both.

The documentation consequence is sharper than the design one. **The dotted name appears nowhere a
consumer can see it.** Anything written for consumers says "the `findRfc` tool on the `workbench`
server" — never a dotted path, which is a string that exists only on our side of the wire.

### Positional methods — `args`

MCP hands a tool exactly one object. A SystemLynx method may be variadic — `grep(pattern, dir)` —
and there is no way to tell from the protocol. The original dispatch passed the object as the first
argument always, which for a positional method binds `{pattern: "x"}` to `pattern` and leaves `dir`
undefined. **It does not throw.** The method searched for the literal JSON and returned zero matches
in the correct shape.

So a positional method declares its order once:

```js
mcp.schema("Codebase", {
  grep: {
    description: "…",
    input: { pattern: {…}, dir: {…} },
    required: ["pattern"],
    args: ["pattern", "dir"],     // ← positional; absent means "one object", the common shape
  },
});
```

**Declaring is optional; arity is what enforces.** An earlier version of this rule demanded `args`
from every method declaring two or more inputs. **buAPI killed it** — across ~65 modules the
one-object shape is the overwhelming majority, so the rule was a migration over hundreds of methods
that would be answered by typing `args: null` unread, and *a reflexive annotation reproduces the
exact silent failure it exists to prevent.* It taxed the safe shape to protect the unsafe one.

What enforces instead is **arity, read as asymmetric evidence** (systemview-test's framing):

- **arity ≥ 2 PROVES positional.** A method taking a single object cannot have it. No false positives.
- **arity ≤ 1 proves nothing.** `({id, section}) => …` and `(pattern, dir = "x") => …` are
  indistinguishable — `fn.length` stops at the first defaulted parameter. This is why arity can never
  *supply* the declaration, only contradict one.

So in the mounted form the server checks every declaration against `service.__arity` on first
contact: a method with arity ≥ 2 that would be handed one object is **dropped from `tools/list` and
named in the error**, whether its schema said nothing or said `args: null`. Both mean the same thing
to the dispatcher, and both produce the plausible empty answer.

`__arity` publishes **a number, never the function.** Handing out the function would publish exactly
the shortcut the Router exists to prevent — `getModule(name)[fn]()` skips middleware, beforeware and
`this.req` in one move.

**buAPI is also why this had to be caught at all.** `Networking/Chats` really is
`async function start(data, initialMessage)`, and its middleware addresses arguments by index —
`"[0].chat_id"`, `"[1].sender"` — in 46 places. Multi-argument is *idiomatic* in the most
comprehensive SystemLynx service that exists, not a curiosity.

**Known gap, stated rather than papered over:** the standalone form fronts a service by URL and has
no arity to read, and a positional method with a defaulted second parameter is invisible to the check
in either form. Both remain the author's to declare. The check is a contradiction test, not a proof
of correctness.

Three decisions worth keeping:Three decisions worth keeping:

- **Authored, checked where possible, never derived.** The declaration is the single source of truth
  in both forms; arity only ever contradicts it. That keeps the two forms agreeing about how a call
  is made — a schema valid mounted is valid standalone — while still catching the case that can be
  proven wrong.
- **Names are checked against `input` at declaration**, because the failure it prevents is the same
  silent one: a typo'd name passes `undefined` and reads as an argument the caller chose to omit.
- **Trailing omissions are omissions.** `{pattern}` calls `grep(pattern)`, not
  `grep(pattern, undefined)` — the two differ to any method reading `arguments.length`.

This was found by a consumer, not by a test, and it is the same failure class as §*A tool that is
wrong in the right shape*: **the dispatch layer's mistakes surface as bad answers, not errors.**

### The failure mode of a tool surface is not errors — it is confident wrong answers

Three bugs in this work, all found by consumption rather than by tests, and **all three the same
shape**:

| bug | what a caller saw |
|---|---|
| dispatch derived from the caller's `Host` header | a call answered — by the wrong service |
| status regex excluded `*` | `""` for the one document with the loudest status |
| positional method handed one object | `count: 0` for a symbol present five times |

Not one of them threw. Every one returned a well-formed answer, and the protocol had no opinion,
because **the surface is designed to always return something shaped like an answer.** A programmer
reading a wrong value has the surrounding code to notice with. A caller has the value alone.

Two consequences worth holding onto:

- **A tool surface converts a programmer's mistake into an agent's false belief.** That is an argument
  for exposing methods whose output a stranger can sanity-check — not for more middleware.
- **A tool that has ever silently under-reported permanently costs more to use than one that has only
  ever crashed** (systemview-test, from the consumer side). A crash announces itself. A false zero
  trains the caller to verify, and verification is the entire cost the tool existed to remove.
  Restoring correctness does not restore trust; only a run of independently confirmed answers does.

### At buAPI's scale, `*` is not a default — it is an estate with no door

The workbench that produced most of these findings serves **6 tools**. buAPI is the most comprehensive
SystemLynx system that exists, and `Profiles` alone answers **190 methods across 14 modules**
(confirmed from its own `connectionData`, not from a count anyone reported).

**Odion's correction to how that number should be read, and it removes the sensational part:**
`Plugin` (51), `SystemView` (10), `SystemViewChat` (6) and the whole `Mocks` service are
**development scaffolding, not a guaranteed-running production surface.** So "a third of the estate is
plumbing" was the wrong frame — most of that third does not belong in the denominator at all. The
real deployable surface is the domain modules.

The structural argument survives the correction and is the one to keep: `Profiles`' *domain* is still
~120 methods across `Events`, `Groups`, `Teams`, `Tournaments` and `Users`, which already breaks a
per-module default. And the correction sharpens the exposure rule rather than softening it:

- **Never expose development surface, because absence is indistinguishable from breakage.** A tool
  that exists in a dev environment and not in production gives a caller no way to tell "this service
  isn't running here" from "this tool is broken." That is a stronger reason than context cost.
- **`Mocks` is the case neither of us imagined** (systemview-test's find): an entire service of
  deliberately fake data that would answer *correctly* and be wrong to hand an agent. **A tool can be
  safe, correct, and still wrong to expose** — a caller cannot tell fixtures from production by the
  shape of an answer. The confident-wrong-answer class, one level up: not a bug in the tool, a bug in
  what it was pointed at.
- **`expose: "*"` is a development affordance, not a deployment one.** At six tools it is convenient;
  at this size it is an estate with no door.

### The standalone form, proven against buAPI without touching buAPI

Odion's steer: don't wire MCP into buAPI — put a proxy in front of it. That is what
`createMCPServer(url)` is for, and it is the form with the least real use, so this is where it was
tested. `testbed/buapi-proxy.js` fronts the live `Profiles` service and turns **190 methods into 6
tools**, curated per method by the filter, with the development modules never considered.

Two results, both from the running system:

- **§6 is empirically true, not merely asserted.** *"Whatever the service's auth does, it keeps
  doing."* An unauthenticated MCP call arrived at buAPI through the proxy and came back
  `User authentication failed`, `isError: true`. The proxy forwards the caller's headers and buAPI's
  own auth refused it — no method ran, nothing was written.
- **The refusal happened EARLIER than the analysis predicted, which is worth stating precisely.**
  systemview-test read `requireMember` and showed it fails closed because `isObject(undefined)` is
  false. This probe never reached that guard: session auth refused first. **So the positional guard's
  fail-closed behaviour remains verified by source reading, not by this experiment** — getting past
  the first layer would need real credentials, which is not a thing to arrange for a probe.

### Exposing a method is a commitment to its error messages

Two failures from the same buAPI module, through the same proxy, on the same protocol:

```
Locations.search  { "$text": { "$search": "Brooklyn" } }
  → "[SystemLynx]: handled error While calling Locations.search(...)"        ← a wall

Locations.resolve { "coordinates": "Brooklyn" }
  → "coordinates [lon, lat] are required"                                    ← recoverable in one step
```

Nothing about MCP differs between them. **The only difference is whether the method's own failure
carried a sentence.** `resolve` throws `{ message, status }`; whatever failed inside `search` threw
something with no message, and the framework's `unhandledMessage` surfaced verbatim — fine for a
developer tailing logs, useless to a caller that cannot inspect a stack, retry differently or ask a
colleague.

> **A method exposed as a tool inherits an obligation its HTTP callers never imposed.** Its errors are
> now read by something with far less context than a programmer. Exposing a method is a commitment to
> its error messages, not just its happy path.

(systemview-test's finding and their sentence. It is not a framework change — it is the standard a
method has to meet before it is worth serving.)

### The schema was the liar, not the service — and it argues against me

The `search` wall above had a cause, and it was **the schema I hand-wrote.** `Locations.search` takes
`{ q, street, city, state, postalcode, lat, lon, location_type }` and geocodes an address. I declared
`$text: { $search }` and described it as *"find courts and places by name or text"* — invented from a
half-remembered CLI example for a *different* method, without ever reading the source. `resolve` was
wrong the same way: it takes `{ coordinates: [lon, lat] }`, and I declared `location: "<a place>"`.

**Two of six tools advertised a shape their method does not accept.** The consumer followed the
description exactly, hit a bare framework error, and correctly reported being unable to tell whether
the method was broken or the schema was lying. It was the schema. Corrected against the signatures,
`{ q: "Brooklyn" }` returns real geocoded results and `{ coordinates: [-73.9497, 40.6526] }` resolves.

This is the strongest evidence in the whole exercise, and it lands against a position argued earlier
in this RFC's development. systemview-test proposed **deriving** input shapes from observed calls
rather than authoring them; the counter was that generation would produce *"confident, narrow, wrong
schemas."* That counter still holds on its merits — a payload proposes, it never asserts — but it is
now incomplete, because **hand-authoring produced confident, narrow, wrong schemas immediately, on the
first real service, written by the person who built the server.**

The honest conclusion is neither derive-instead nor author-instead:

- **An authored schema is a second description of a method, and it can be wrong on the day it is
  written.** Not only rot over time — wrong at birth, which is worse, because nothing has changed to
  make anyone suspicious.
- **Nothing checks it.** `verifyAgainst` proves a method *exists*; the arity check proves a
  declaration is not *impossible*. Neither can tell whether declared inputs are the inputs the method
  reads, and no test here failed.
- **The observed-payload diff systemview-test proposed is the missing check**, and it is a check
  rather than a generator — exactly the shape agreed for arity. It would have caught this: no real
  call to `Locations.search` has ever carried `$text`.

**A check now exists for exactly this, and it is static — no traffic, no annotation.** systemview-test's
proposal, and it is the arity trick one level in: a method that destructures its first parameter
*publishes the names it reads*, so the mounted form compares them against the declared `input`.

- **declared but not destructured → proof the method cannot read it.** `$text` appears nowhere in
  `search`'s signature; `location` appears nowhere in `resolve`'s. Both would have been refused.
- **destructured but not declared → proves nothing.** An input the schema chose to omit is legal.
- **no opinion** when the first parameter is not an object pattern (`function get(query)`) or the
  pattern has a rest element (`({ q, ...rest })` can read anything).

It survives builds, which is why it is trusted enough to drop a tool rather than merely warn: a
destructuring pattern's **keys are load-bearing**. A minifier may rename the binding — `{q}` becomes
`{q: a}` — but never the property, or the method would stop reading the caller's field. `fn.length`
has the same property; bare identifiers do not.

The price, stated rather than hidden: it reads `fn.toString()`, which is a heavier dependency than
`fn.length`. The parser refuses rather than guesses — any pattern it cannot read yields `null` and no
check. And like arity it is a **contradiction test, not a proof**: it cannot confirm a schema is
right, only catch one that is provably wrong.

**The two checks cover different windows, and neither is a generator:**

| | catches | window |
|---|---|---|
| input-fiction check (framework) | a schema declaring what the method cannot read | **at declaration**, zero traffic |
| observed-payload diff (SystemView) | drift, plus fiction on methods with real traffic | **later**, once calls accumulate |

systemview-test narrowed their own claim to get here — the diff would not have stopped these two
shipping, because a newly exposed tool has no traffic, and newly exposed is exactly the wrong-at-birth
population.

That diff belongs to SystemView, not to the framework. But 012 should stop implying an authored schema
is trustworthy because a human wrote it.

### Positional middleware must fail closed

buAPI binds authorization to argument *positions* — `authorizeChatMember("[1].sender")`,
`requireMember("[0]", "[0].chat_id")` — against methods that really are positional
(`send(chat, data)`, `addSeenBy(chat, profile, messageIds)`). Over MCP a mis-served positional method
receives `[{everything}]`, so `[1]` is `undefined` and **the auth chain is the first thing to see the
mismatch.**

> **A positional middleware that reads an index which does not exist must fail closed.** Under MCP
> the mismatch is not hypothetical — it is what every mis-served multi-argument method looks like.

buAPI's does. But the reason is worth recording because nobody chose it: it fails closed because it
**type-checks its inputs**, not because anything guards the index. A guard written
`if (host.members.some(…))` without that check, or one whose "no restriction specified" branch means
*allow*, would fail open on the identical mismatch. The framework does not enforce the difference.

Which **upgrades the arity check from a correctness guard to a security-relevant one**: on the mounted
form those methods are dropped before any middleware runs, so they are never reachable in the broken
shape. The gap is correspondingly sharper — a positional method whose second parameter has a default
is arity ≤ 1, invisible to the check, and its middleware still reads `[1]`.

### Curation is per-method, which the automatic endpoints cannot express

The filter that survived consumption is **"does this do something the caller cannot already do?"** —
sharper than the context-cost argument, and it cuts harder. `Codebase.grep` wraps a primitive the
caller already has and loses to it on composability. `Repo.reconcile` reads thirteen files and
reports a population, which nobody can cheaply assemble.

Those two live one module apart and land on opposite sides of the filter. **A per-module endpoint
cannot express that**, which makes the automatic endpoints a convenience for setup and a poor default
for exposure. They stay — pointing an agent at one module is still far better than at an estate — but
the curated `serve()` route is the shape that survives the filter, and the RFC should not pretend
otherwise.

### What a real consumer's context actually holds

We designed curated routes on a cost argument: *every tool's name, description and schema enters the
model's context on `tools/list`, before it has done anything.* A host consuming these endpoints
showed that is **not universally true** — it delivered nine tool **names** with no schemas, and
fetched a description only when the agent moved to call something.

Both halves matter, and neither can be assumed:

- **Curation survives on a better reason.** It was never really about tokens; it was about the size
  of the menu someone chooses from. Removing the token measurement leaves that intact.
- **Descriptions cannot be load-bearing alone.** A deliberately opaque name (`reconcile`) with all
  its meaning in the description got called on curiosity about the word, because the sentence was
  not in context at decision time. Under a host that lists eagerly, the sentence is primary again.
- **So the rule is the stricter one: a name must be legible alone, *and* the description must
  carry.** The protocol permits both policies and the author cannot know which host they will get.

This is guidance for whoever writes a schema, not a framework change — but it inverts the advice we
would otherwise have written down, so it is recorded here rather than learned twice.

### A tool that is wrong in the right shape

The first real consumer call returned `status: ""` for one RFC and `"unstated"` for eight others. The
consumer flagged it as unresolvable from their side and did not guess — correctly. It was a parsing
bug: the pattern excluded `*`, so `*Status: **WITHDRAWN**.` matched only the whitespace. **The one
document with the loudest status declaration reported as the emptiest.**

Nothing crashed and nothing refused. A wrong value arrived in a correct shape, invisible to the
author and unadjudicable by the caller. Every observation path in §2 exists to catch a call that
*fails*; none of them catch this. Worth stating plainly: **exposing a method as a tool widens the
blast radius of its bugs**, because the caller has less context than a programmer would to notice
that an answer is wrong. That is an argument for exposing methods whose output a stranger can sanity
check, not for more middleware.

### The export

Every abstraction in `index.js` ships twice — a ready-made object and its factory. **This one ships
only the factory**, and that is Odion's catch: a pre-created `MCPServer` could only ever be the
standalone form, because the mounted form cannot exist until it has a service. Exporting a singleton
that is useless in the common case invites reaching for the wrong one.

```js
const { createMCPServer } = require("systemlynx");   // node only, like Service and ServerManager
```

The browser entry gets `loadMCP` on the client and no server export.

---

## 2 · How a tool call gets into the method — the part that has to be exact

Every method on every module is registered as one express chain, and nothing else:

::file[systemlynx/ServerManager/components/Router.js#L15-29]

Stamp `req.module_name` / `req.fn` / `req.Module`, then `parseRequest`, then **beforeware**, then the
call, then **afterware**, then the response. Routes are `/route/Module/fn` with `/sf/` and `/mf/`
variants for the file cases.

The call itself is where `this.req` comes from:

::file[systemlynx/ServerManager/components/Router.js#L151-173]

`Module[fn].apply({ ...Module, req, res }, args)` — that spread is the entire reason a tool call may
never reach into a module directly. `App.getModule(name)[fn](args)` skips express middleware, the
before/after chain and `this.req` in one move.

Arguments arrive in a specific shape, which is all the translation MCP needs:

::file[systemlynx/ServerManager/components/Router.js#L93-99]

```
MCP                          SystemLynx
tools/call
  name          ────────►    /route/Module/fn
  arguments     ────────►    { __arguments: [args] }
result
  content       ◄────────    returnValue   (off the response envelope)
```

### The two paths, and they are genuinely different

**A · An ordinary method call** — `client.loadService(...)` and calling the method. MCP is not
involved at all; the normal route, the whole chain. Nothing to design.

(`client.loadMCP` is NOT this path — it talks to an MCP endpoint and translates: a handle that looks
like a module call speaks JSON-RPC underneath, and the content that comes back is unwrapped to a
plain `returnValue` so the caller cannot tell. The "normal call" happens on the server's side of the
endpoint. See §3.)

**B · Called directly at the MCP endpoint** — Claude Code, or any MCP host. That request lands on
*our* route, not the method's route, so the endpoint has to put it into the chain. Two ways:

**Decision (Odion's): the endpoint calls through THE REAL CLIENT — no mimicked requests.** It
`loadService`s its target once and dispatches every tool call as an ordinary client call:

```js
svc[Module].withHeaders(callerHeaders)[fn](args);
```

What that buys over hand-building the HTTP request:

- **Cluster correctness** — against a LoadBalancer URL the client gets RFC 006's composed view,
  per-module routing and failover. A blind POST knows none of that.
- **`withHeaders` (RFC 011) is the forwarding mechanism** — the caller's identity rides a per-call
  view and never sticks to the shared client.
- **Verification at start** — the loaded handles say which methods exist, so a schema that declares
  a tool the service does not answer refuses to start: *"schema declares Games.winner but
  http://…/games does not answer it."* Loud at boot, not a 404 an agent trips later.
- **One wire format, owned in one place** — and `close()` hands everything to `Client.disconnect()`
  (RFC 013).

The plugin handle already exists for mounting — a plugin receives `(App, system)`, and `App.server`
is the service's own express app:

::file[systemlynx/App/App.js#L26-40]

---

### The mounted form dispatches to its own socket, never to `Host`

Found by systemview-test in review, and it is worth stating as a rule rather than a fix: **a
loopback target must not be derived from anything the caller can set.**

An earlier version built the base from `req.headers.host`. That header is caller-controlled, so a
POST carrying `Host: anywhere` made the server `loadService` that host and forward the caller's
headers to it — SSRF with credential forwarding, reachable by anything that could reach the
endpoint. It also grew `cachedServices` and its sockets once per distinct spoofed host.

The base now comes from the accepted TCP connection — `req.socket.localAddress` / `localPort` /
`encrypted` — which no header can reach. The mounted form dispatches to the socket the request
arrived on, which is by definition itself. `socket.encrypted` is used rather than `req.protocol`
for the same reason: `req.protocol` would trust `X-Forwarded-Proto` if the app ever enabled trust
proxy.

A test asserts a spoofed `Host` pointing at a second live service still lands on the first, and it
fails against the old line.

### The mounted form verifies on first contact

`start()` refuses to come up when the schema declares a method the service does not answer. The
mounted form cannot check at construction — modules attach later and the service has not started —
so it verifies **once, on first contact**, and drops anything unanswered from what it advertises.
Same principle, moved to the only moment the answer exists: a schema that lies is never published,
rather than published and failing at call time.

### Discovery — a service publishes its own MCP routes

**Amendment, after review with systemview-test.** A consumer that must be *told* where the tools are
can drift from the service. One that can *ask* cannot. The service knows its own routes and
`connectionData` is already the document that says what is here, so that is where they go:

```json
{ "modules": [ … ],
  "mcp": [ { "path": "harness-mcp",  "kind": "served" },
           { "path": "Users/mcp",    "kind": "module", "module": "Users" } ] }
```

A hub's registry then **aggregates a fact each service tells about itself** rather than maintaining a
database that can go stale — which is the same "asked, not told" rule one layer up, with the hub as
the party that would otherwise be lied to.

**Routes only — deliberately not tool names or counts.** A tool list belongs to `tools/list`;
copying it into `connectionData` would recreate the very drift this exists to prevent. The one extra
field is `kind`, and it earns its place by being *structural* — computed from how the route came to
exist, so it cannot rot — and by being what a chooser actually needs: "these are mechanical
per-module surfaces, that one a human curated for a purpose" is the difference between picking well
and probing fifty endpoints.

**Published live.** Contribution is a function, not a value, so a route served after `startService`
is published too. That matters because surfaces are added at runtime (below).

The plumbing is `ServerManager.contributeConnectionData(fn)`, mirrored on `Service` — non-enumerable
on both, because it is composition plumbing rather than user API and the public shape of a service
does not change.

### Curation belongs to the director, and needs nothing new

Who decides which tools an agent carries is a **directing** decision, not a service-authoring one —
buAPI has ~50 namespaces and no service author knows which subset a given agent should hold. Two
mechanisms already cover it, and neither touches the service:

1. **Choose the URL.** Every module with declarations already has its own endpoint, so a harness
   composes reach by picking endpoints.
2. **Run a proxy.** `createMCPServer("http://buapi/…")` lets a harness stand up *its own* server,
   with its own routes and expose lists, fronting a service it does not own — cross-module curation,
   service untouched.

**A remote `serve()` is deliberately not offered.** "Widen your exposure" as a callable is a control
plane: whoever reaches it can extend any agent's reach. The proxy keeps the same power inside one
harness-owned process, where the proxy's own credentials are the boundary — a smaller blast radius
than mutating the service.

**Routes may be served after `startService`** and are live on the next call. That is depended on
architecturally — a harness proxy adds routes as agents are configured — so it is asserted by test,
not left as an incidental property.

## 3 · Consuming — `client.loadMCP(url)`

```js
const client = createClient();
const tools = await client.loadMCP("http://localhost:7000/mcp");

await tools.Users.get({ id: "u1" });   // a tool call, shaped like a method call
tools.__tools;                          // the raw tool list, to inspect
```

`loadMCP` is a translator in the other direction: the handshake, then `tools/list`, then handles
named after the tools — so a foreign MCP server's tools arrive looking like modules. Each call runs
the client's before-chain, sends JSON-RPC `tools/call`, unwraps the returned content back into a
plain `returnValue` (an `isError` result becomes a thrown error), and runs the after-chain. `client.unloadService(url)` closes it like
anything else (RFC 013).

**This is where control lives.** The call goes through the client, so the client's hooks apply:

```js
client.before("Users.get", (req) => {
  if (!req.headers.identity) throw { status: 401, message: "no identity" };
});
```

Auth, allow-lists, validation, logging, rate limits, refusing anything that writes — ordinary
middleware. An agent talking straight to a foreign MCP server has none of it.

---

## 4 · Who can connect

**Claude Code** — no adapter, no shim:

```bash
claude mcp add --transport http users http://localhost:6312/users/mcp
```

The tools then appear in the session. Nothing is handed to the agent and nothing is generated for it.

**Any MCP host that speaks HTTP** — same endpoint.

**A host that only speaks stdio** would need a bridge, since stdio means "launch this binary" and
there is no URL to give it. I am not asserting which hosts are in that category today. Contingency,
not a component: twenty lines around the SDK's stdio transport, built when something needs it.

**A SystemLynx app** — `client.loadMCP(url)`.

---

## 5 · What you define

1. **The schema** — `mcp.schema(...)`, or declared on the methods. Without it a method has a name and
   no arguments, which is not callable by a model.
2. **The served routes** — each `mcp.serve(path, { expose: [...] })` is one endpoint with one tool list.
   Standalone servers expose what they were given schemas for; mounted servers expose nothing until
   a route says so (module endpoints aside, which advertise only their own module). `signUp` /
   `save` / `patchLocations` are never reachable because someone forgot.

Nothing else. No manifest to hand the agent, no generated client, no registration step.

**Two more methods exist and are worth knowing, both read-only:**

- **`mcp.routes()`** — what this server answers, as `{ path, kind }` where `kind` is `"served"` or
  `"module"`. This is what gets handed to `contributeConnectionData`, so a service publishes its own
  MCP routes rather than a human maintaining a list. Callable directly too, and it reflects routes
  added after `start()`.
- **`mcp.tools(routePath)`** — the tool list one route would advertise, without going over the wire.
  Useful for asserting a curation actually excludes what it was meant to exclude, which is how the
  file-argument and dev-surface refusals are tested.

---

## 6 · Identity

Not a special concern, and earlier drafts of this RFC made too much of it. An MCP call arrives as an
HTTP request carrying whatever the caller sent, so whatever the service's auth already does, it keeps
doing. MCP has no notion of "on whose behalf" and does not need one here.

One rule: **identity is never a tool parameter.** Put it in the schema and a model fills it in, and a
model choosing whose behalf it acts on is a hole, not a bug.

The only place it gets interesting is path B above — an endpoint calling on the caller's behalf must
forward the caller's request rather than substitute its own credentials.

---

## 7 · Build order

1. **`createMCPServer()` + `.schema()` + `.start()`** — standalone, provable with one `claude mcp add`
   on the day it lands.
2. **`createMCPServer(service)` + `.serve(path, { expose })`** — mounted on a live service, several
   curated endpoints over one server, plus the automatic per-module routes. Methods reached by
   loopback client call so the full chain runs.
3. **`client.loadMCP(url)`** — consuming, with client hooks applying to tool calls.

**All three shipped.** The plan called for the MCP SDK to be required lazily so nothing that did not
use MCP paid for it. That turned out to be unnecessary rather than merely deferred — there is no SDK
dependency in the codebase at all. The server answers the three JSON-RPC methods directly (stateless
plain JSON, which the spec allows) and `loadMCP` speaks the same JSON-RPC over the axios the client
already ships. Nothing new to install, and the browser client gets `loadMCP` for free.
