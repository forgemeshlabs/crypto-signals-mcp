"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { BASE_URL, TOOLS, clampInteger, requiredText, routeForTool } = require("../index.js");

test("uses the dedicated ForgeMesh Crypto origin", () => {
  assert.equal(BASE_URL, "https://crypto.forgemesh.io");
});

test("publishes ten unique snake_case tools with valid object schemas", () => {
  assert.equal(TOOLS.length, 10);
  assert.equal(new Set(TOOLS.map((tool) => tool.name)).size, TOOLS.length);
  for (const tool of TOOLS) {
    assert.match(tool.name, /^[a-z0-9_]{3,64}$/);
    assert.ok(tool.description.length >= 10);
    assert.equal(tool.inputSchema.type, "object");
    for (const required of tool.inputSchema.required || []) assert.ok(tool.inputSchema.properties[required]);
  }
});

test("maps every tool to the fixed upstream allowlist", () => {
  const cases = {
    get_crypto_signals: {}, get_crypto_risk: {}, get_crypto_signal_history: { hours: 24 },
    get_crypto_preflight: { symbol: "BTC" }, get_crypto_decision: { symbol: "ETH" },
    audit_crypto_decision: { decision_id: "abc", window: "4h" }, get_crypto_forecast: { symbol: "SOL" },
    get_single_crypto_signal: { symbol: "BTC/USD" }, get_crypto_whale_alerts: { chain: "base", hours: 4 },
    submit_crypto_feedback: { message: "hello" }
  };
  for (const [name, args] of Object.entries(cases)) assert.match(routeForTool(name, args).path, /^\/(api\/|signal\/)/);
});

test("bounds numeric inputs and rejects missing required text", () => {
  assert.equal(clampInteger(999, 4, 1, 168), 168);
  assert.equal(clampInteger("bad", 4, 1, 168), 4);
  assert.throws(() => requiredText("", "message"), /required/);
});

test("live API is healthy and paid tools remain challenge-first without spending", async () => {
  const health = await fetch(`${BASE_URL}/health`);
  assert.equal(health.status, 200);
  const response = await fetch(`${BASE_URL}/api/signals`);
  assert.equal(response.status, 402);
  assert.ok(response.headers.get("payment-required"));
});

test("forecast is crypto-only and signals accept a symbol filter", () => {
  assert.equal(routeForTool("get_crypto_signals", { symbol: "BTC,ETH" }).path, "/api/signals?symbol=BTC%2CETH");
  assert.equal(routeForTool("get_crypto_forecast", { symbol: "eth" }).path, "/api/kronos/forecast?symbol=ETH");
  assert.throws(() => routeForTool("get_crypto_forecast", { symbol: "AAPL" }), /one of/);
});

test("a service refusal keeps its HTTP status, charged flag and body", async () => {
  const { createGuard } = require("../x402-guard");
  const guard = createGuard({ baseUrl: BASE_URL, payTo: [] });
  const real = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ error: "window_open", available_at: "2026-11-13T12:00:00Z", charged: false }), { status: 425, headers: { "content-type": "application/json" } });
  try {
    await assert.rejects(guard.callPaid(null, "/api/kronos/audit?decision_id=x"), (e) => e.status === 425 && e.charged === false && e.upstream.available_at && /425/.test(e.message));
  } finally { global.fetch = real; }
});
