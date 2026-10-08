# Crypto Signals by ForgeMesh

[![M8ven Score](https://m8ven.ai/badge/mcp/forgemeshlabs-crypto-signals-mcp-1qui57)](https://m8ven.ai/mcp/forgemeshlabs-crypto-signals-mcp-1qui57)
[![mcpservers.org](https://mcpservers.org/badge.svg)](https://mcpservers.org/servers/forgemeshlabs/crypto-signals-mcp)

Dedicated MCP wrapper for [ForgeMesh Crypto Signals](https://crypto.forgemesh.io), an x402 crypto market-intelligence service.

This is separate from `coinopai-mcp`. Every tool targets `crypto.forgemesh.io` and pays the ForgeMesh Crypto Signals service wallet through x402 on Base.

## Install

```bash
npx -y @forgemeshlabs/crypto-signals-mcp
```

Configure `WALLET_PRIVATE_KEY` with a dedicated low-balance Base wallet funded only with the USDC you intend the agent to spend. Never use a primary wallet.

Example MCP configuration:

```json
{
  "mcpServers": {
    "crypto-signals-mcp": {
      "command": "npx",
      "args": ["-y", "@forgemeshlabs/crypto-signals-mcp"],
      "env": {
        "WALLET_PRIVATE_KEY": "${WALLET_PRIVATE_KEY}"
      }
    }
  }
}
```

## Requirements

- Node.js 20 or newer and a dedicated, low-balance Base wallet (`WALLET_PRIVATE_KEY`).
- Spending caps: the server only talks to `https://crypto.forgemesh.io` and refuses to sign for any other payee, any network except Base mainnet, any asset except USDC, or any amount above the built-in $0.15 per-call and $10 per-session caps. The environment variables `X402_MAX_PRICE_USD` and `X402_SESSION_BUDGET_USD` can only lower those caps, never raise them.

## Tools

- `get_crypto_signals` — $0.05
- `get_crypto_risk` — $0.02
- `get_crypto_signal_history` — $0.05
- `get_crypto_preflight` — $0.05
- `get_crypto_decision` — $0.15
- `audit_crypto_decision` — $0.07
- `get_crypto_forecast` — $0.05
- `get_single_crypto_signal` — $0.05
- `get_crypto_whale_alerts` — $0.02
- `submit_crypto_feedback` — $0.005

All outputs are market intelligence for research and decision support, not financial advice or market activity instructions.
