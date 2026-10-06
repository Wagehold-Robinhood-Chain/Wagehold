/**
 * Fase 2 item 7 -- minimal ABI for `WageholdSplitter` (only what the server
 * calls after the client's seal): `registerJob` (council, before the seal),
 * `pullAndSplit` (permissionless, after the seal) and the `getSplit` view.
 * See `contracts/src/WageholdSplitter.sol` for the real contract and the
 * exact call order.
 */
export const splitterAbi = [
  {
    type: "function",
    name: "registerJob",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "bytes32" },
      { name: "patronPool", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "pullAndSplit",
    stateMutability: "nonpayable",
    inputs: [{ name: "jobId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getSplit",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "patronPool", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "split", type: "bool" },
        ],
      },
    ],
  },
] as const;

/**
 * Patronage build -- `WageholdSplitterV2`. `registerJob(jobId, agentId)` binds a job to a building
 * (`agentId = keccak256(bytes(agentUuid))`); the 60% Patron cut is sent to `WageholdPatronage` and
 * credited to that building's patrons inside `pullAndSplit`. Callable only by the Registrar.
 */
export const splitterV2Abi = [
  {
    type: "function",
    name: "registerJob",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "bytes32" },
      { name: "agentId", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "pullAndSplit",
    stateMutability: "nonpayable",
    inputs: [{ name: "jobId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getSplit",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "agentId", type: "bytes32" },
          { name: "amount", type: "uint256" },
          { name: "split", type: "bool" },
        ],
      },
    ],
  },
] as const;

/** Role getters on `WageholdStrongboxV2` (the v1 ABI in `strongbox.ts` only has `council`). */
export const strongboxRolesAbi = [
  { type: "function", name: "registrar", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "council", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "allowedPayee", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "bool" }] },
] as const;
