#!/usr/bin/env node
"use strict";

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const { x402Client, x402HTTPClient } = require("@x402/core/client");
const { ExactEvmScheme } = require("@x402/evm/exact/client");
const { toClientEvmSigner } = require("@x402/evm");
const { privateKeyToAccount } = require("viem/accounts");
const { createGuard } = require("./x402-guard");

const VERSION = require("./package.json").version;
const BASE_URL = "https://crypto.forgemesh.io";
// Most expensive listed tool is get_crypto_decision at $0.15; X402_MAX_PRICE_USD / X402_SESSION_BUDGET_USD can only lower these caps.
const guard = createGuard({ baseUrl: BASE_URL, payTo: ["0x93A1F57D2e0DBE4cc882b5DbAEbe7F0F16443338"], maxPriceUsd: 0.15, sessionBudgetUsd: 10 });
const SYMBOL_PATTERN = /^[A-Za-z0-9._\/-]{1,32}$/;
const ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

const symbolSchema = {
  type: "string",
  maxLength: 32,
  pattern: "^[A-Za-z0-9._/-]{1,32}$",
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
        decision_id: { type: "string", minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9._-]{1,128}$", description: "Decision UUID returned by get_crypto_decision" },
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
        symbol: { type: "string", maxLength: 32, pattern: "^[A-Za-z0-9._/-]{1,32}$", description: "Optional related symbol" },
        endpoint: { type: "string", maxLength: 200, description: "Optional related ForgeMesh Crypto endpoint path" },
        contact: { type: "string", maxLength: 200, description: "Optional contact handle or email" }
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

function patternText(value, field, pattern, maxLength) {
  const text = requiredText(value, field, maxLength);
  if (!pattern.test(text)) throw new Error(`${field} has invalid characters`);
  return text;
}

function buildHttpClient() {
  const key = process.env.WALLET_PRIVATE_KEY;
  if (!key) throw new Error("WALLET_PRIVATE_KEY is required. Use a dedicated low-balance Base wallet funded only with the USDC you intend to spend.");
  const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);
  const coreClient = new x402Client().register("eip155:*", new ExactEvmScheme(toClientEvmSigner(account))).registerPolicy(guard.policy);
  return new x402HTTPClient(coreClient);
}

function routeForTool(name, args = {}) {
  switch (name) {
    case "get_crypto_signals": return { path: "/api/signals" };
    case "get_crypto_risk": return { path: "/api/kronos/risk" };
    case "get_crypto_signal_history": return { path: `/api/kronos/history?hours=${clampInteger(args.hours, 24, 1, 168)}` };
    case "get_crypto_preflight": return { path: `/api/kronos/preflight?symbol=${encodeURIComponent(patternText(args.symbol, "symbol", SYMBOL_PATTERN, 32))}` };
    case "get_crypto_decision": return { path: `/api/kronos/decision?symbol=${encodeURIComponent(patternText(args.symbol, "symbol", SYMBOL_PATTERN, 32))}` };
    case "audit_crypto_decision": {
      const window = ["1h", "4h", "24h"].includes(args.window) ? args.window : "4h";
      return { path: `/api/kronos/audit?decision_id=${encodeURIComponent(patternText(args.decision_id, "decision_id", ID_PATTERN, 128))}&window=${window}` };
    }
    case "get_crypto_forecast": return { path: `/api/kronos/forecast?symbol=${encodeURIComponent(args.symbol === undefined ? "BTC" : patternText(args.symbol, "symbol", SYMBOL_PATTERN, 32))}` };
    case "get_single_crypto_signal": return { path: `/signal/${encodeURIComponent(patternText(args.symbol, "symbol", SYMBOL_PATTERN, 32))}` };
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
        ...(args.symbol ? { symbol: patternText(args.symbol, "symbol", SYMBOL_PATTERN, 32) } : {}),
        ...(args.endpoint ? { endpoint: requiredText(args.endpoint, "endpoint", 200) } : {}),
        ...(args.contact ? { contact: requiredText(args.contact, "contact", 200) } : {})
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
      const data = await guard.callPaid(getClient(), route.path, route);
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
