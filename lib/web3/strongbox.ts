import { isAddress, keccak256, toBytes } from "viem";

/**
 * Fase 2 item 6 -- "Post a Job -> lock wage on-chain sungguhan".
 *
 * Minimal ABI: just the functions this app actually calls -- `createJob`
 * (browser, item 6), `getJob` (server + browser), `approve` (browser, item 7:
 * \"Set the seal\" -- only the job's own client can call it on-chain),
 * `setPayee` + `council` (server, item 7: the council key wires the payee
 * before the seal), plus the custom errors a wallet call can revert with so
 * viem can decode them into readable messages. Not the full
 * `WageholdStrongbox` ABI -- see `contracts/src/WageholdStrongbox.sol`.
 *
 * `getJob`'s return tuple has named components matching the contract's
 * `Job` struct field-for-field (client, payee, amount, status) so viem
 * decodes it as an object with those keys, not a positional array.
 */
export const strongboxAbi = [
  {
    type: "function",
    name: "createJob",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "bytes32" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getJob",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "client", type: "address" },
          { name: "payee", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [{ name: "jobId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "setPayee",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "bytes32" },
      { name: "payee", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "council",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  { type: "error", name: "JobNotFound", inputs: [] },
  { type: "error", name: "InvalidStatus", inputs: [] },
  { type: "error", name: "NotClient", inputs: [] },
  { type: "error", name: "NotCouncil", inputs: [] },
  { type: "error", name: "PayeeNotSet", inputs: [] },
  { type: "error", name: "ZeroAddress", inputs: [] },
] as const;

/** Job.Status enum order in the Solidity contract -- `getJob(...).status`
 *  decodes to one of these as a plain number (uint8). `Open` is what item 6
 *  checks (wage locked, nothing decided yet); `Released` is what item 7
 *  checks after the client's seal transaction. */
export const JobStatus = {
  None: 0,
  Open: 1,
  Released: 2,
  Refunded: 3,
  Disputed: 4,
} as const;

function toAddress(value: string | undefined): `0x${string}` | undefined {
  if (!value) return undefined;
  return isAddress(value) ? value : undefined;
}

/** Set once `contracts/script/Deploy.s.sol` has actually been broadcast to
 *  Robinhood Chain testnet (Fase 2 item 4) and the printed addresses are
 *  copied into `.env.local` -- see `.env.local.example`. Both undefined
 *  until then, same "missing env degrades gracefully" pattern as
 *  `isWeb3Configured` in `lib/web3/config.ts`. */
export const strongboxAddress = toAddress(process.env.NEXT_PUBLIC_STRONGBOX_ADDRESS);
export const wageTokenAddress = toAddress(process.env.NEXT_PUBLIC_WAGE_TOKEN_ADDRESS);

/** True once both contract addresses are configured. Does NOT imply a
 *  wallet is connected (see `isWeb3Configured` for that) -- callers on the
 *  browser side need both to actually lock a wage. Callers on the server
 *  side (verifying what a client claims -- see `lib/web3/verify-lock.ts`)
 *  only need this one. */
export const isOnChainEscrowConfigured = !!strongboxAddress && !!wageTokenAddress;

/** `WageholdStrongbox.sol`'s doc comment fixes this convention:
 *  `jobId = keccak256(bytes(uuidString))`, computed off-chain so the
 *  contract never needs to know about Postgres UUIDs. Used both when
 *  locking the wage (browser, `lib/web3/lock-wage.ts`) and when verifying
 *  the lock afterwards (server, `lib/web3/verify-lock.ts`) -- both sides
 *  must derive the exact same bytes32 from the same UUID string. */
export function computeJobId(jobUuid: string): `0x${string}` {
  return keccak256(toBytes(jobUuid));
}
