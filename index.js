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
  description: "Tracked market symbol: a crypto pair (BTC, ETH, SOL, XRP, ADA and others) or a US stock/ETF ticker (AAPL, SPY, NVDA). An unknown symbol is answered 404 and not charged."
};

const cryptoSymbolSchema = {
  type: "string",
  enum: ["BTC", "ETH", "SOL", "XRP", "ADA"],
  default: "BTC",
  description: "Crypto symbol. Forecasts cover BTC, ETH, SOL, XRP and ADA only."
};

const SIGNALS_FILTER_PATTERN = /^[A-Za-z0-9._\/,-]{1,200}$/;
const FORECAST_SYMBOLS = ["BTC", "ETH", "SOL", "XRP", "ADA"];

const TOOLS = [
  {
    name: "get_crypto_signals",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description: "Trading signals for crypto and US equities: the latest Kronos signal score for every tracked symbol (crypto pairs plus US stocks and ETFs) in one hourly snapshot, with top_k, regime, score_details, data_quality, as_of, timeframe and data_freshness. Optional symbol filter, e.g. BTC,ETH. Crypto updates hourly; equity bars update in US market hours. A snapshot older than 2 hours is refused unpaid. Market intelligence only. Costs $0.05 USDC.",
    inputSchema: { type: "object", properties: { symbol: { type: "string", maxLength: 200, pattern: "^[A-Za-z0-9._/,-]{1,200}$", description: "Optional symbol filter, comma-separated, e.g. BTC,ETH" } } }
  },
  {
    name: "get_crypto_risk",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description: "Market risk state: current Kronos risk state, per-symbol signal streaks and active cooldown timers, rewritten every hourly cycle. Returns state, signal_streak, cooldown, last_updated, data_freshness and why_not_high caveats. A risk state older than 2 hours is refused unpaid. Use it as a low-cost risk gate. Costs $0.02 USDC.",
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
    description: "Signal history: hourly Kronos signal snapshots for every tracked symbol over a lookback window. Pass hours (integer 1-168, default 24). Returns count, hours, window, timeframe and signals: one snapshot per hourly cycle, each with ts, per-symbol scores, score_details and top_k. Invalid hours is answered 400 and not charged. Costs $0.05 USDC.",
    inputSchema: {
      type: "object",
      properties: { hours: { type: "integer", minimum: 1, maximum: 168, description: "Lookback window in hours, integer 1 to 168 (default 24)" } }
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
    description: "Market preflight: a go/no-go check for one tracked symbol before a costlier decision call. Returns allowed (true or false), market_state, in_cooldown, signal_strength, data_freshness and warnings. An unknown symbol is answered 404 and a stale or missing signal 503; neither is charged. Costs $0.05 USDC.",
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
    description: "Decision journal: an auditable market-intelligence record for one tracked symbol (crypto or US equity). Returns directional_bias, confidence (the measured directional hit rate for that symbol, or null with calibration insufficient_outcomes), anomaly_score and level, signal_gates, why_not_high caveats and a decision_id. Unknown or unavailable symbols are not charged. Market intelligence only; not financial advice. Costs $0.15 USDC.",
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
    description: "Decision outcome audit: scores a prior decision_id against the price move over its window, measured on the hourly Kronos feed from the decision's signal bar. Returns verdict, outcome (pnl_pct, direction_correct), prices with timestamps, directional_bias and symbol. A window that has not closed is answered HTTP 425 with available_at and is not charged; retry after available_at. Decisions stay auditable for 7 days. Costs $0.07 USDC.",
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
    description: "Crypto price forecast: calibrated price range for BTC, ETH, SOL, XRP or ADA, refit hourly. Returns horizon, current_price, range_80 (low and high of a conformal 80% interval, with recent empirical coverage), upside_probability with calibration details, as_of and why_not_high caveats. A forecast older than 2 hours is refused unpaid. Costs $0.05 USDC.",
    inputSchema: { type: "object", properties: { symbol: cryptoSymbolSchema } }
  },
  {
    name: "get_single_crypto_signal",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description: "Single-symbol trading signal: the latest Kronos signal for one symbol (BTC, BTC/USD, BTCUSDT, btc, or a stock ticker such as AAPL). Returns symbol, signal, score_details, data_quality, as_of, regime and data_freshness (MARKET_CLOSED with the last bar time for equities outside US market hours). An unknown symbol is answered 404 and not charged. Costs $0.05 USDC.",
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
    description: "Whale alerts: large exchange, bridge and stablecoin-issuer flows at monitored addresses (major exchanges, L2 bridges, Tether and Circle treasuries). Pass chain (ethereum, base or arbitrum; default base) and hours (1-168, default 4; base max 96). Returns JSON with chain, window_hours, alert_count, alerts (symbol such as CEX_INFLOW or BRIDGE_IN, source, timestamp, amount_eth for ETH flows, amount_usd priced from the hourly ETH/USD feed, or null with a reason) and source_status. Empty windows are stated. Costs $0.02 USDC.",
    inputSchema: {
      type: "object",
      properties: {
        chain: { type: "string", enum: ["ethereum", "base", "arbitrum"], description: "Chain to inspect (default base)" },
        hours: { type: "integer", minimum: 1, maximum: 168, description: "Lookback in hours, integer 1 to 168 (default 4; base allows at most 96)" }
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
    description: "Feedback to the operator: send a symbol request, bug report or integration suggestion to ForgeMesh Crypto Signals. Costs $0.005 USDC.",
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
    case "get_crypto_signals": return { path: args.symbol === undefined || args.symbol === "" ? "/api/signals" : `/api/signals?symbol=${encodeURIComponent(patternText(args.symbol, "symbol", SIGNALS_FILTER_PATTERN, 200))}` };
    case "get_crypto_risk": return { path: "/api/kronos/risk" };
    case "get_crypto_signal_history": return { path: `/api/kronos/history?hours=${clampInteger(args.hours, 24, 1, 168)}` };
    case "get_crypto_preflight": return { path: `/api/kronos/preflight?symbol=${encodeURIComponent(patternText(args.symbol, "symbol", SYMBOL_PATTERN, 32))}` };
    case "get_crypto_decision": return { path: `/api/kronos/decision?symbol=${encodeURIComponent(patternText(args.symbol, "symbol", SYMBOL_PATTERN, 32))}` };
    case "audit_crypto_decision": {
      const window = ["1h", "4h", "24h"].includes(args.window) ? args.window : "4h";
      return { path: `/api/kronos/audit?decision_id=${encodeURIComponent(patternText(args.decision_id, "decision_id", ID_PATTERN, 128))}&window=${window}` };
    }
    case "get_crypto_forecast": {
      const symbol = args.symbol === undefined ? "BTC" : patternText(args.symbol, "symbol", SYMBOL_PATTERN, 32).toUpperCase();
      if (!FORECAST_SYMBOLS.includes(symbol)) throw new Error(`symbol must be one of ${FORECAST_SYMBOLS.join(", ")} for forecasts`);
      return { path: `/api/kronos/forecast?symbol=${symbol}` };
    }
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
      // Surface the service's refusal as-is: HTTP status, charged flag and the response body.
      const out = { code: "CRYPTO_SIGNALS_MCP_ERROR", message, details: { tool: name } };
      if (error && error.status !== undefined) out.status = error.status;
      if (error && error.charged !== undefined) out.charged = error.charged;
      if (error && error.upstream !== undefined) out.upstream = error.upstream;
      return { content: [{ type: "text", text: JSON.stringify(out) }], isError: true };
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
