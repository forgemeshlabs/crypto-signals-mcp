# Changelog

## 0.2.1

- Hardening: error messages are now short and fixed (HTTP status plus the service's error code); the service body is carried only as capped structured data in `upstream`, never interpolated into the message. No tool or price change.

## 0.2.0 — 2026-11-13

- Tool text and schemas refreshed to the live service contract (route integrity pass): tracked symbols are crypto plus US stocks and ETFs, not only BTC/ETH/SOL/XRP/ADA; decision `confidence` is the measured hit rate or null; audit answers 425 with `available_at` while its window is open; history `hours` 1-168; whale `amount_usd`; stale data is refused unpaid.
- `get_crypto_signals` accepts an optional `symbol` filter; `get_crypto_forecast` symbol is now an enum of BTC, ETH, SOL, XRP, ADA.
- Errors now carry the service's HTTP `status`, `charged` flag and `upstream` body instead of a truncated string.

## 0.1.7

- Dependencies: @x402/core + @x402/evm 2.11.0 → 2.29.0 (drops the transitive vulnerable zod); lockfile refresh resolving the open npm advisories (zod via @x402/core, body-parser, fast-uri, qs, ip-address, @hono/node-server as applicable). No behavior change.

## 0.1.1 — 2026-08-07

- Replaced the internal runtime identifier in public-facing package copy with the product description “x402 crypto market-intelligence service.”

## 0.1.0 — 2026-08-07

- Initial Crypto Signals by ForgeMesh MCP release.
- Ten typed tools backed exclusively by `crypto.forgemesh.io`.
- Challenge-first x402 payments on Base with settlement metadata.
- Fixed upstream allowlist, bounded inputs, request timeouts, and structured errors.
