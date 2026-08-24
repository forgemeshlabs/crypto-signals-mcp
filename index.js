#!/usr/bin/env node
"use strict";

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const { x402Client, x402HTTPClient } = require("@x402/core/client");
const { ExactEvmScheme } = require("@x402/evm/exact/client");
const { toClientEvmSigner } = require("@x402/evm");
const { privateKeyToAccount } = require("viem/accounts");
const { createPublicClient, http } = require("viem");
const { base } = require("viem/chains");

const VERSION = "0.1.1";
const BASE_URL = "https://crypto.forgemesh.io";
const BASE_RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const REQUEST_TIMEOUT_MS = 30_000;

const symbolSchema = {
  type: "string",
  description: "Market symbol such as BTC, ETH, SOL, XRP, ADA, AAPL, SPY, or NVDA"
};

const TOOLS = [
  {
    name: "get_crypto_signals",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description: "Retrieve current BTC, ETH, SOL, XRP, and ADA market-intelligence signals, ranked context, regime, and freshness. Costs $0.05 USDC.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_crypto_risk",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description: "Retrieve the current market risk state, signal streaks, and cooldown context before deeper analysis. Costs $0.02 USDC.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_crypto_signal_history",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description: "Retrieve recent Kronos market context history for supported crypto symbols. Costs $0.05 USDC.",
    inputSchema: {
      type: "object",
      properties: { hours: { type: "integer", minimum: 1, maximum: 168, description: "History window in hours, from 1 to 168 (default 24)" } }
    }
  },
  {
    name: "get_crypto_preflight",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description: "Run the market-state, cooldown, freshness, and model-context preflight step before creating a decision journal. Costs $0.05 USDC.",
    inputSchema: { type: "object", properties: { symbol: symbolSchema }, required: ["symbol"] }
  },
  {
    name: "get_crypto_decision",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description: "Create an auditable market-intelligence journal containing calibrated context and a decision_id for later outcome review. Costs $0.15 USDC.",
    inputSchema: { type: "object", properties: { symbol: symbolSchema }, required: ["symbol"] }
  },
  {
    name: "audit_crypto_decision",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description: "Audit a prior decision_id against subsequent market prices over a 1h, 4h, or 24h evaluation window. Costs $0.07 USDC.",
    inputSchema: {
      type: "object",
      properties: {
        decision_id: { type: "string", minLength: 1, description: "Decision UUID returned by get_crypto_decision" },
        window: { type: "string", enum: ["1h", "4h", "24h"], description: "Evaluation window (default 4h)" }
      },
      required: ["decision_id"]
    }
  },
  {
    name: "get_crypto_forecast",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description: "Retrieve an empirically calibrated 80% price interval, current price, point return, and upside probability. Costs $0.05 USDC.",
    inputSchema: { type: "object", properties: { symbol: symbolSchema } }
  },
  {
    name: "get_single_crypto_signal",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description: "Retrieve the current signal context for one crypto symbol using the compatibility lookup route. Costs $0.05 USDC.",
    inputSchema: { type: "object", properties: { symbol: symbolSchema }, required: ["symbol"] }
  },
  {
    name: "get_crypto_whale_alerts",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description: "Retrieve whale-scale transfers, exchange flows, bridge flows, and stablecoin events for Ethereum, Base, or Arbitrum. Costs $0.02 USDC.",
    inputSchema: {
      type: "object",
      properties: {
        chain: { type: "string", enum: ["ethereum", "base", "arbitrum"], description: "Chain to inspect (default base)" },
        hours: { type: "integer", minimum: 1, maximum: 168, description: "Lookback in hours, from 1 to 168 (default 4)" }
      }
    }
  },
  {
    name: "submit_crypto_feedback",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description: "Submit paid feedback, a symbol request, bug report, or integration suggestion to ForgeMesh Crypto Signals. Costs $0.005 USDC.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["general", "symbol_request", "logic_suggestion", "bug", "integration", "hello"], description: "Feedback category (default general)" },
        message: { type: "string", minLength: 1, maxLength: 2000, description: "Feedback message, up to 2,000 characters" },
        symbol: { type: "string", description: "Optional related symbol" },
        endpoint: { type: "string", description: "Optional related ForgeMesh Crypto endpoint path" },
        contact: { type: "string", description: "Optional contact handle or email" }
      },
      required: ["message"]
    }
  }
];

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function requiredText(value, field, maxLength = 2000) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${field} is required`);
  if (text.length > maxLength) throw new Error(`${field} exceeds ${maxLength} characters`);
  return text;
}

function buildHttpClient() {
  const key = process.env.WALLET_PRIVATE_KEY;
  if (!key) throw new Error("WALLET_PRIVATE_KEY is required. Use a dedicated low-balance Base wallet funded only with the USDC you intend to spend.");
  const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);
  const coreClient = new x402Client().register("eip155:*", new ExactEvmScheme(toClientEvmSigner(account)));
  return new x402HTTPClient(coreClient);
}

async function createChainTimedPaymentPayload(httpClient, paymentRequired) {
  try {
    const publicClient = createPublicClient({ chain: base, transport: http(BASE_RPC_URL) });
    const block = await publicClient.getBlock();
    const chainNow = Number(block.timestamp);
    const originalNow = Date.now;
    const localNow = Math.floor(originalNow() / 1000);
    const timeout = Number(paymentRequired.accepts?.[0]?.maxTimeoutSeconds || 300);
    const signingNow = Math.min(Math.max(chainNow, localNow + 30 - timeout), chainNow + 600);
    Date.now = () => signingNow * 1000;
    try {
      return await httpClient.createPaymentPayload(paymentRequired);
    } finally {
      Date.now = originalNow;
    }
  } catch (_) {
    return httpClient.createPaymentPayload(paymentRequired);
  }
}

async function request(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch (_) { throw new Error(`Upstream returned invalid JSON (${response.status})`); }
}

async function callPaid(httpClient, path, options = {}) {
  if (!path.startsWith("/")) throw new Error("Invalid upstream path");
  const method = options.method || "GET";
  const body = options.body ? JSON.stringify(options.body) : undefined;
  const headers = body ? { "Content-Type": "application/json" } : {};
  const url = `${BASE_URL}${path}`;
  const first = await request(url, { method, headers, body });

  if (first.status !== 402) {
    const data = await readJson(first);
    if (!first.ok) throw new Error(`Upstream HTTP ${first.status}: ${JSON.stringify(data).slice(0, 500)}`);
    return data;
  }

  let challengeBody;
  try { challengeBody = await first.clone().json(); } catch (_) {}
  const paymentRequired = httpClient.getPaymentRequiredResponse((name) => first.headers.get(name), challengeBody);
  const payload = await createChainTimedPaymentPayload(httpClient, paymentRequired);
  const paid = await request(url, {
    method,
    body,
    headers: { ...headers, ...httpClient.encodePaymentSignatureHeader(payload) }
  });
  const data = await readJson(paid);
  if (!paid.ok) throw new Error(`Paid upstream HTTP ${paid.status}: ${JSON.stringify(data).slice(0, 500)}`);
  try {
    const settlement = httpClient.getPaymentSettleResponse((name) => paid.headers.get(name));
    if (settlement && data && typeof data === "object" && !Array.isArray(data)) return { ...data, _payment: settlement };
  } catch (_) {}
  return data;
}

function routeForTool(name, args = {}) {
  switch (name) {
    case "get_crypto_signals": return { path: "/api/signals" };
    case "get_crypto_risk": return { path: "/api/kronos/risk" };
    case "get_crypto_signal_history": return { path: `/api/kronos/history?hours=${clampInteger(args.hours, 24, 1, 168)}` };
    case "get_crypto_preflight": return { path: `/api/kronos/preflight?symbol=${encodeURIComponent(requiredText(args.symbol, "symbol", 32))}` };
    case "get_crypto_decision": return { path: `/api/kronos/decision?symbol=${encodeURIComponent(requiredText(args.symbol, "symbol", 32))}` };
    case "audit_crypto_decision": {
      const window = ["1h", "4h", "24h"].includes(args.window) ? args.window : "4h";
      return { path: `/api/kronos/audit?decision_id=${encodeURIComponent(requiredText(args.decision_id, "decision_id", 128))}&window=${window}` };
    }
    case "get_crypto_forecast": return { path: `/api/kronos/forecast?symbol=${encodeURIComponent(String(args.symbol || "BTC").slice(0, 32))}` };
    case "get_single_crypto_signal": return { path: `/signal/${encodeURIComponent(requiredText(args.symbol, "symbol", 32))}` };
    case "get_crypto_whale_alerts": {
      const chain = ["ethereum", "base", "arbitrum"].includes(args.chain) ? args.chain : "base";
      return { path: `/api/whale?chain=${chain}&hours=${clampInteger(args.hours, 4, 1, 168)}` };
    }
    case "submit_crypto_feedback": return {
      path: "/api/feedback",
      method: "POST",
      body: {
        type: ["general", "symbol_request", "logic_suggestion", "bug", "integration", "hello"].includes(args.type) ? args.type : "general",
        message: requiredText(args.message, "message", 2000),
        ...(args.symbol ? { symbol: String(args.symbol).slice(0, 32) } : {}),
        ...(args.endpoint ? { endpoint: String(args.endpoint).slice(0, 200) } : {}),
        ...(args.contact ? { contact: String(args.contact).slice(0, 200) } : {})
      }
    };
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

function createServer() {
  let httpClient;
  const getClient = () => (httpClient ||= buildHttpClient());
  const server = new Server({ name: "crypto-signals-mcp", version: VERSION }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (requestInfo) => {
    const { name, arguments: args = {} } = requestInfo.params;
    try {
      const route = routeForTool(name, args);
      const data = await callPaid(getClient(), route.path, route);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: JSON.stringify({ code: "CRYPTO_SIGNALS_MCP_ERROR", message, details: { tool: name } }) }], isError: true };
    }
  });
  return server;
}

async function main() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  process.stdin.resume();
  process.stdin.on("end", () => process.exit(0));
  setInterval(() => {}, 1 << 30);
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exit(1); });

module.exports = { BASE_URL, TOOLS, clampInteger, requiredText, routeForTool, createServer };
