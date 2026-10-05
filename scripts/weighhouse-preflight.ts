/**
 * Pre-flight check (Dev Brief §2): token yang dipakai app, Splitter, Strongbox, dan CA di brief
 * harus SAMA. Kalau ada yang beda: berhenti dan laporkan.
 *   npx tsx --env-file=.env.local scripts/weighhouse-preflight.ts
 */
import { createPublicClient, http, parseAbi } from "viem";
import { activeChain } from "../lib/web3/chains";
import { ADDRESSES } from "../lib/web3/addresses";

const abi = parseAbi(["function wageToken() view returns (address)", "function decimals() view returns (uint8)", "function totalSupply() view returns (uint256)"]);

async function main() {
  const client = createPublicClient({ chain: activeChain, transport: http() });
  console.log(`Chain: ${activeChain.name} (${activeChain.id})`);
  const [sbToken, spToken, decimals, supply] = await Promise.all([
    client.readContract({ address: ADDRESSES.strongbox, abi, functionName: "wageToken" }),
    client.readContract({ address: ADDRESSES.splitter, abi, functionName: "wageToken" }),
    client.readContract({ address: ADDRESSES.wageToken, abi, functionName: "decimals" }),
    client.readContract({ address: ADDRESSES.wageToken, abi, functionName: "totalSupply" }),
  ]);
  const checks: [string, string | undefined][] = [
    ["brief CA", ADDRESSES.wageToken],
    ["Strongbox.wageToken()", sbToken.toLowerCase()],
    ["Splitter.wageToken()", spToken.toLowerCase()],
    ["NEXT_PUBLIC_WAGE_TOKEN_ADDRESS", process.env.NEXT_PUBLIC_WAGE_TOKEN_ADDRESS?.toLowerCase()],
  ];
  let bad = false;
  for (const [name, v] of checks) {
    const ok = v === ADDRESSES.wageToken;
    if (!ok) bad = true;
    console.log(`${ok ? "OK  " : "FAIL"} ${name}: ${v ?? "(unset)"}`);
  }
  console.log(`decimals() = ${decimals} ${decimals === 18 ? "OK" : "FAIL (brief assumes 18)"}`);
  console.log(`totalSupply() = ${supply} (brief assumes 1,000,000,000 × 10^18)`);
  if (decimals !== 18) bad = true;
  if (bad) { console.error("\nSTOP: ada alamat yang tidak cocok. Jangan deploy Weighhouse sebelum diselesaikan."); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
