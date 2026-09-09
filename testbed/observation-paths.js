// The five paths an argument-shape observer has to handle, in one disposable service.
//
// Built for systemview-test's schema-drift recorder, after a session where each of these was found
// by reading the call path rather than the description — and every one of them would have produced
// either missing evidence or false evidence:
//
//   1 · success            → afterware, returnValue.status < 400
//   2 · in-method refusal  → afterware, returnValue.status >= 400   ← looks like success
//   3 · thrown             → NEVER reaches afterware; only the module's local "error" event
//   4 · upload             → parseRequest swapped "__file__" for multer's object
//   5 · multi-arg          → req.arguments is an ARRAY; arity varies per call
//
//   + the edge: "__file__" sent to a method with no upload route becomes `undefined`, and
//     `JSON.stringify` DROPS that key entirely — evidence that erases itself.
//
// Run it: node testbed/observation-paths.js
// It stands up the service, subscribes the way a recorder would, drives all five, and prints what
// each subscription actually saw — so a real recorder can be diffed against known-good output.
const fs = require("fs");
const path = require("path");
const createService = require("../systemlynx/Service/Service");
const createClient = require("../systemlynx/Client/Client");

const PORT = Number(process.env.OBS_PORT || 6410);
const URL = `http://localhost:${PORT}/obs`;

// What a recorder would write: shape, never values. Keys and types only.
const signature = (arg) => {
  if (arg === undefined) return "undefined";
  if (arg === null) return "null";
  if (Array.isArray(arg)) return "array";
  if (typeof arg !== "object") return typeof arg;
  // Object.keys, NOT JSON — `{ file: undefined }` serializes to `{}` and the observation vanishes.
  return Object.keys(arg)
    .sort()
    .map((k) => `${k}:${arg[k] === undefined ? "undefined" : typeof arg[k]}`)
    .join(",");
};

// Positional: methods here are variadic, so arity is part of the shape.
const shapeOf = (args = []) => `[${args.map(signature).join(" | ")}]`;

const observations = [];
const record = (via, o) => {
  observations.push({ via, ...o });
  console.log(
    `  ${via.padEnd(12)} ${String(o.method).padEnd(22)} status=${String(o.status).padEnd(4)} ` +
      `path=${(o.path || "").padEnd(22)} ${o.shape}`
  );
};

(async () => {
  const service = createService();

  const Paths = service.module("Paths", {
    ok: ({ id }) => ({ id }), //                                    1 · success
    refuse: ({ id }) => (id ? { id } : { status: 400, message: "id is required" }), // 2 · refusal
    boom: () => {
      throw { status: 500, message: "thrown on purpose" }; //       3 · thrown
    },
    upload: function ({ file, note }) {
      //                                                            4 · upload
      return { got: !!file, note };
    },
    pair: (a, b) => ({ a, b }), //                                  5 · multi-arg
  });

  // ── the recorder, both subscriptions ────────────────────────────────────────────────────────
  // AFTERWARE sees everything that COMPLETED — including in-method refusals, which is why `ok`
  // must come off returnValue.status and never from which subscription fired.
  service.after((req, res, next) => {
    const status = (req.returnValue || {}).status;
    record("afterware", {
      method: `${req.module_name}.${req.fn}`,
      status: status === undefined ? 200 : status,
      path: req.path,
      shape: shapeOf(req.arguments),
    });
    next();
  });

  await service.startService({ route: "obs", port: PORT });

  // The local "error" event is the ONLY sighting of a thrown call. It now carries `path`, so this
  // subscription can interpret its arguments the same way afterware can (upload route or not).
  //
  // Subscribe on the LIVE module handle returned by service.module(). Calling service.module()
  // a second time to "fetch" it builds and registers a NEW module over the top — which is how the
  // first version of this file silently observed nothing.
  Paths.on("error", (payload) =>
    record("error-event", {
      method: `${payload.module_name}.${payload.fn}`,
      status: payload.status,
      path: payload.path,
      shape: shapeOf(payload.arguments),
    })
  );

  const client = createClient();
  const svc = await client.loadService(URL);

  console.log(`\n  observing ${URL}\n`);

  const tmp = path.join(__dirname, "obs-upload.txt");
  fs.writeFileSync(tmp, "payload");

  const drive = async (label, fn) => {
    console.log(`\n— ${label}`);
    try {
      await fn();
    } catch (e) {
      /* the client rejects on 4xx/5xx; the observation already happened server-side */
    }
  };

  await drive("1 · success", () => svc.Paths.ok({ id: "u1" }));
  await drive("2 · in-method refusal — reaches afterware, status 400", () => svc.Paths.refuse({}));
  await drive("3 · thrown — afterware never runs", () => svc.Paths.boom({ id: "u1" }));
  await drive("4 · upload — file placeholder swapped for multer's object", () =>
    svc.Paths.upload({ file: fs.createReadStream(tmp), note: "hi" })
  );
  await drive("5 · multi-arg — arity is part of the shape", () => svc.Paths.pair({ a: 1 }, "two"));
  // The edge case CANNOT be driven through the SystemLynx client: the client detects a `file` key
  // and routes to /sf/ itself, so it would never be a plain route. A raw POST is the honest way to
  // simulate a caller that sends the placeholder where no upload route exists.
  await drive("edge · '__file__' on a plain route becomes undefined", () =>
    require("../systemlynx/HttpClient/HttpClient")().request({
      method: "post",
      url: `${URL}/Paths/ok`,
      body: { __arguments: [{ id: "u2", file: "__file__" }] },
    })
  );

  await new Promise((r) => setTimeout(r, 300));

  console.log(`\n  ${observations.length} observations\n`);
  console.log(
    "  afterware-only would have missed:",
    observations.filter((o) => o.via === "error-event").length,
    "thrown call(s)"
  );
  console.log(
    "  labelling by subscription would mislabel:",
    observations.filter((o) => o.via === "afterware" && o.status >= 400).length,
    "refusal(s) as success\n"
  );

  fs.unlinkSync(tmp);
  client.disconnect();
  service.close(() => process.exit(0));
})();
