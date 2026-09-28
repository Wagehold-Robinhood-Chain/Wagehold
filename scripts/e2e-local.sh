#!/usr/bin/env bash
# Fase 2 item 8 -- menjalankan E2E penuh di Anvil lokal (chain id 46630, sama dengan
# Robinhood Chain testnet supaya library app tidak perlu diubah). Deploy memakai
# contracts/script/Deploy.s.sol yang sama dengan yang akan dipakai di testnet.
#
#   bash scripts/e2e-local.sh [--with-finding]
#
# Butuh: anvil + forge di PATH, `npm install` sudah jalan, contracts/lib terisi (forge install).
set -euo pipefail
cd "$(dirname "$0")/.."

for bin in anvil forge npx; do
  command -v "$bin" >/dev/null || { echo "'$bin' tidak ada di PATH"; exit 2; }
done

PORT="${E2E_ANVIL_PORT:-8546}"
RPC="http://127.0.0.1:${PORT}"
EXTRA="${1:-}"

# Kunci bawaan Anvil (PUBLIK, hanya untuk chain lokal -- jangan pernah dipakai di testnet/mainnet)
DEPLOYER=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80   # #0
COUNCIL=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d    # #1
LAMP=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a       # #2
TITHE=0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6      # #3
CLIENT=0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a     # #4

anvil --chain-id 46630 --port "$PORT" --silent &
ANVIL_PID=$!
trap 'kill $ANVIL_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do
  curl -s -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$RPC" >/dev/null 2>&1 && break
  sleep 0.2
done

addr() { cast wallet address --private-key "$1"; }

# Deploy sungguhan lewat Deploy.s.sol (MockUSDC baru karena WAGE_TOKEN_ADDRESS kosong)
pushd contracts >/dev/null
OUT=$(DEPLOYER_PRIVATE_KEY=$DEPLOYER \
  COUNCIL_ADDRESS=$(addr $COUNCIL) LAMP_OIL_TREASURY_ADDRESS=$(addr $LAMP) TITHE_TREASURY_ADDRESS=$(addr $TITHE) \
  forge script script/Deploy.s.sol --rpc-url "$RPC" --broadcast 2>&1)
popd >/dev/null
pick() { echo "$OUT" | grep -E "^\s*$1" | grep -oE '0x[0-9a-fA-F]{40}' | head -1; }
export NEXT_PUBLIC_ROBINHOOD_TESTNET_RPC_URL="$RPC"
export NEXT_PUBLIC_WAGE_TOKEN_ADDRESS=$(pick "wageToken")
export NEXT_PUBLIC_STRONGBOX_ADDRESS=$(pick "WageholdStrongbox")
export WAGEHOLD_SPLITTER_ADDRESS=$(pick "WageholdSplitter")
export COUNCIL_PRIVATE_KEY=$COUNCIL
export E2E_CLIENT_PRIVATE_KEY=$CLIENT
export E2E_LAMP_OIL_PRIVATE_KEY=$LAMP
export E2E_TITHE_PRIVATE_KEY=$TITHE
echo "token=$NEXT_PUBLIC_WAGE_TOKEN_ADDRESS strongbox=$NEXT_PUBLIC_STRONGBOX_ADDRESS splitter=$WAGEHOLD_SPLITTER_ADDRESS"

RC=0
npx tsx scripts/e2e-testnet.ts --mode splitter $EXTRA || RC=$?
npx tsx scripts/e2e-testnet.ts --mode direct || RC=$?
exit $RC
