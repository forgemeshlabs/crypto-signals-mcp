# Glama Build Instructions

Dockerfile URL:

`https://github.com/forgemeshlabs/crypto-signals-mcp/blob/main/Dockerfile`

Build steps:

```json
["npm ci --omit=dev"]
```

Command arguments:

```json
["node", "index.js"]
```

Required environment variables:

- `WALLET_PRIVATE_KEY` — secret; dedicated low-balance Base wallet used for x402 USDC payments.

Optional environment variables:

- `BASE_RPC_URL` — Base mainnet RPC override.

Runtime: Node.js 20 or newer, stdio transport.
