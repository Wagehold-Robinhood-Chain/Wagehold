/**
 * ABI minimal WageholdPatronage -- hanya yang dipakai app. File ini sengaja TANPA import supaya
 * `scripts/patronage-verify-abi.ts` dan uji bisa memuatnya tanpa viem/wagmi. Sumber kebenaran:
 * `contracts/src/WageholdPatronage.sol`; jalankan skrip verifikasi tiap kali kontrak berubah.
 */
export const patronageAbi = [
  // ---- tulis ----
  {
    type: "function",
    name: "stake",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "bytes32" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "requestUnstake",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "bytes32" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "claimMany",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentIds", type: "bytes32[]" }],
    outputs: [],
  },
  // ---- baca ----
  {
    type: "function",
    name: "pendingRewards",
    stateMutability: "view",
    inputs: [
      { name: "agentId", type: "bytes32" },
      { name: "user", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "stakeOf",
    stateMutability: "view",
    inputs: [
      { name: "agentId", type: "bytes32" },
      { name: "user", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "cooldownOf",
    stateMutability: "view",
    inputs: [
      { name: "agentId", type: "bytes32" },
      { name: "user", type: "address" },
    ],
    outputs: [
      { name: "amount", type: "uint256" },
      { name: "unlockAt", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "totalStaked",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "isBuilding",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "wageToken",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "minStake",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "maxStakePerUser",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "cooldown",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint32" }],
  },
  {
    type: "function",
    name: "paused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  // ---- custom error ----
  { type: "error", name: "ZeroAmount", inputs: [] },
  { type: "error", name: "BuildingNotRegistered", inputs: [] },
  { type: "error", name: "BelowMinStake", inputs: [] },
  { type: "error", name: "ExceedsMaxStake", inputs: [] },
  { type: "error", name: "InsufficientStake", inputs: [] },
  { type: "error", name: "StillCoolingDown", inputs: [{ name: "unlockAt", type: "uint256" }] },
  { type: "error", name: "NothingToWithdraw", inputs: [] },
  { type: "error", name: "NothingToClaim", inputs: [] },
  // OpenZeppelin v5 (Pausable) -- lihat contracts/test/WageholdPatronage.t.sol
  { type: "error", name: "EnforcedPause", inputs: [] },
] as const;
