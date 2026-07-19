// Integration test for the systemlynx-client (ESM) package.
//
// The client's Client / HttpClient / Dispatcher only mean anything against a real service, so
// this boots an actual `systemlynx` service (the CJS parent) and drives it entirely through the
// shipped `.mjs` client over the wire — the only way to exercise the published client for real.
//
// Not a jest test on purpose: the client is pure ESM and this repo's jest (v24) doesn't run ESM
// cleanly. It's a self-contained script — launch a service, test the client against it, exit.
//
//   node systemlynx-client/systemlynx/Client/test/integration.test.mjs
//   (or, from inside systemlynx-client/:  npm test  — once wired)

import assert from "node:assert/strict";
import systemlynx from "../../../../index.js"; // the CJS parent — spins up a real service
import { createClient, createHttpClient } from "../../../index.mjs"; // the ESM client under test

const { createService } = systemlynx;

const PORT = 8730; // free port, not used by the jest suite
const ROUTE = "client-it";
const URL = `http://localhost:${PORT}/${ROUTE}`;
const EVENT = "pinged";

const results = [];
const test = async (name, fn) => {
  try {
    await fn();
    results.push(true);
    console.log(`  ✅ ${name}`);
  } catch (e) {
    results.push(false);
    console.log(`  ❌ ${name}\n     ${e && e.message}`);
  }
};

async function main() {
  // --- a real service (the parent), one module with a value method, an error, and an emit ---
  const Service = createService();
  const Api = Service.module("Api", function () {
    this.echo = (data) => ({ ok: true, ...data });
    this.boom = () => {
      throw Error("kaboom");
    };
  });
  await Service.startService({ route: ROUTE, port: PORT });

  console.log(`\nsystemlynx-client integration → service @ ${URL}\n`);

  // --- Client + HttpClient: bootstrap the service and call a method over the wire ---
  const Client = createClient();
  const service = await Client.loadService(URL);

  await test("Client.loadService connects and exposes the module", async () => {
    assert.ok(service.Api, "service.Api should exist");
    assert.equal(typeof service.Api.echo, "function");
  });

  await test("Client → module method returns its value (HttpClient path)", async () => {
    const res = await service.Api.echo({ n: 7 });
    assert.deepEqual(res, { ok: true, n: 7 });
  });

  // the 3.0.0 contract: every response is marked, so the client can trust/reconnect correctly
  await test("errors come back marked SystemLynxService (reconnect contract)", async () => {
    try {
      await service.Api.boom();
      assert.fail("boom() should have thrown");
    } catch (err) {
      assert.equal(err.SystemLynxService, true);
      assert.equal(err.message, "kaboom");
      assert.equal(err.module_name, "Api");
    }
  });

  // --- Dispatcher / SocketDispatcher: server emits, client receives over the websocket ---
  await test("Dispatcher: client receives a server-emitted event", async () => {
    const received = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("event not received in time")), 3000);
      service.Api.on(EVENT, (data, event) => {
        clearTimeout(timer);
        try {
          assert.deepEqual(data, { pinged: true });
          assert.equal(event.name, EVENT);
          assert.equal(event.type, "WebSocket");
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
    setTimeout(() => Api.emit(EVENT, { pinged: true }), 300); // fire from the server side
    await received;
  });

  // --- HttpClient directly: the raw connectionData fetch the bootstrap is built on ---
  await test("HttpClient.request fetches raw connectionData", async () => {
    const HttpClient = createHttpClient();
    const connData = await HttpClient.request({ url: URL });
    assert.equal(connData.SystemLynxService, true);
    assert.ok(Array.isArray(connData.modules));
  });

  // --- teardown so the script exits cleanly ---
  if (service.disconnect) service.disconnect();
  await new Promise((resolve) => Service.close(resolve));

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed\n`);
  process.exit(results.every(Boolean) ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
