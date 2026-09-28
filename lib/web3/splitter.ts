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
