# Changelog

## 0.1.7

- Dependencies: @x402/core + @x402/evm 2.11.0 → 2.29.0 (drops the transitive vulnerable zod); lockfile refresh resolving the open npm advisories (zod via @x402/core, body-parser, fast-uri, qs, ip-address, @hono/node-server as applicable). No behavior change.

## 0.1.1 — 2026-08-07

- Replaced the internal runtime identifier in public-facing package copy with the product description “x402 crypto market-intelligence service.”

## 0.1.0 — 2026-08-07

- Initial Crypto Signals by ForgeMesh MCP release.
- Ten typed tools backed exclusively by `crypto.forgemesh.io`.
- Challenge-first x402 payments on Base with settlement metadata.
- Fixed upstream allowlist, bounded inputs, request timeouts, and structured errors.
