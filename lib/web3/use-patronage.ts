"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { erc20Abi, zeroAddress, type Address, type Hash } from "viem";
import { useAccount, useConfig, useReadContract, useSwitchChain } from "wagmi";
import { getAccount, readContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { activeChain } from "@/lib/web3/chains";
import {
  computeChainAgentId,
  describePatronageError,
  patronageAbi,
  patronageAddress,
  PatronageUserError,
} from "@/lib/web3/patronage";
import { DEFAULT_WAGE_DECIMALS } from "@/lib/wage-format";
import type { PositionRow } from "@/lib/patronage-page";

/**
 * Sesi 4A -- hook baca/tulis Patronage (Dev Brief §8.2). Dipakai panel di profil bangunan
 * sekarang, dan halaman /patronage (4B) serta cincin patron di kota (4C) setelahnya.
 *
 * Baca  : `usePatronageBuilding(agentUuid)` -- state pool publik + posisi wallet (stake,
 *         cooldown, pending rewards, saldo, allowance) lewat view call langsung, bukan API
 *         indexer (yang tertinggal beberapa menit).
 * Tulis : `usePatronageActions(...)` -- stake (approve bila perlu lalu stake), request
 *         unstake, withdraw, claim. Satu transaksi pada satu waktu, status inline.
 * Jaringan: `useNetworkGate()` -- deteksi chain salah + tombol pindah ke `activeChain`.
 */

const REFETCH_MS = 20_000;

// ---------------------------------------------------------------------------------------------
// Jaringan
// ---------------------------------------------------------------------------------------------

export function useNetworkGate() {
  const { address, isConnected, chainId } = useAccount();
  const { switchChainAsync, isPending } = useSwitchChain();
  const [switchError, setSwitchError] = useState<string | null>(null);

  const wrongNetwork = isConnected && chainId !== activeChain.id;

  const switchNetwork = useCallback(async () => {
    setSwitchError(null);
    try {
      await switchChainAsync({ chainId: activeChain.id });
    } catch (err) {
      setSwitchError(describePatronageError(err));
    }
  }, [switchChainAsync]);

  return {
    address: address as Address | undefined,
    connected: isConnected && !!address,
    wrongNetwork,
    /** Nama jaringan yang diminta, untuk teks tombol: "Robinhood Chain Testnet". */
    networkName: activeChain.name,
    switching: isPending,
    switchError,
    switchNetwork,
  };
}

// ---------------------------------------------------------------------------------------------
// Baca
// ---------------------------------------------------------------------------------------------

type CallResult = { status: "success"; result: unknown } | { status: "failure"; error: Error } | undefined;
const ok = <T,>(r: CallResult): T | undefined => (r?.status === "success" ? (r.result as T) : undefined);

/**
 * Pengganti `useReadContracts`: satu `readContract` per panggilan, dijalankan paralel. Sengaja BUKAN multicall:
 * definisi chain Robinhood tidak memuat alamat Multicall3, jadi `useReadContracts` gagal untuk semua entri.
 * Bentuk hasil sama dengan `useReadContracts` (`status` + `result`/`error` per panggilan), jadi pemanggil tidak berubah.
 * Satu panggilan yang gagal tidak menggagalkan yang lain; `isError` hanya bila semuanya gagal.
 */
interface ReadCall {
  address: Address | undefined;
  abi: readonly unknown[];
  chainId: number;
  functionName: string;
  args?: readonly unknown[];
}

function useParallelReads(contracts: readonly ReadCall[], opts: { enabled: boolean; refetchInterval: number }) {
  const config = useConfig();
  const key = JSON.stringify(
    contracts.map((c) => [c.address, c.functionName, c.args ?? []]),
    (_k, v) => (typeof v === "bigint" ? v.toString() : v),
  );
  const q = useQuery({
    queryKey: ["patronage-parallel-reads", key],
    enabled: opts.enabled,
    refetchInterval: opts.refetchInterval,
    queryFn: async (): Promise<CallResult[]> => {
      const settled = await Promise.allSettled(
        contracts.map((c) => readContract(config, c as never) as Promise<unknown>),
      );
      if (settled.length > 0 && settled.every((r) => r.status === "rejected")) {
        throw (settled[0] as PromiseRejectedResult).reason;
      }
      return settled.map((r): CallResult =>
        r.status === "fulfilled"
          ? { status: "success", result: r.value }
          : { status: "failure", error: r.reason instanceof Error ? r.reason : new Error(String(r.reason)) },
      );
    },
  });
  const { refetch: refetchQuery } = q;
  const refetch = useCallback(async () => {
    await refetchQuery();
  }, [refetchQuery]);
  return { data: q.data, isLoading: q.isLoading, isError: q.isError, refetch };
}

export interface PatronageBuildingState {
  /** NEXT_PUBLIC_PATRONAGE_ADDRESS terisi. */
  configured: boolean;
  /** Data publik pool (dan desimal token) sudah terbaca; angka aman ditampilkan. */
  ready: boolean;
  /** Pembacaan publik gagal (RPC mati / alamat salah). */
  loadFailed: boolean;
  agentChainId: `0x${string}`;

  registered: boolean;
  paused: boolean;
  poolStaked: bigint;
  minStake: bigint;
  /** 0n = tanpa batas. */
  maxStakePerUser: bigint;
  cooldownSeconds: number;
  token: Address | undefined;
  decimals: number;

  // ---- wallet ----
  address: Address | undefined;
  connected: boolean;
  wrongNetwork: boolean;
  /** Posisi wallet sudah terbaca (atau tidak ada wallet). */
  userReady: boolean;
  staked: bigint;
  cooling: bigint;
  /** Detik epoch; 0 = tidak ada cooldown. */
  unlockAt: number;
  pending: bigint;
  balance: bigint;
  allowance: bigint;

  refetch: () => Promise<void>;
}

export function usePatronageBuilding(agentUuid: string): PatronageBuildingState {
  const gate = useNetworkGate();
  const configured = !!patronageAddress;
  const agentChainId = useMemo(() => computeChainAgentId(agentUuid), [agentUuid]);

  const base = { address: patronageAddress, abi: patronageAbi, chainId: activeChain.id } as const;

  const pub = useParallelReads(
    [
      { ...base, functionName: "isBuilding", args: [agentChainId] },
      { ...base, functionName: "totalStaked", args: [agentChainId] },
      { ...base, functionName: "minStake" },
      { ...base, functionName: "maxStakePerUser" },
      { ...base, functionName: "cooldown" },
      { ...base, functionName: "paused" },
      { ...base, functionName: "wageToken" },
    ],
    { enabled: configured, refetchInterval: REFETCH_MS },
  );

  const d = pub.data as CallResult[] | undefined;
  const token = ok<Address>(d?.[6]);

  const decimalsRead = useReadContract({
    address: token,
    abi: erc20Abi,
    chainId: activeChain.id,
    functionName: "decimals",
    query: { enabled: !!token, staleTime: Infinity },
  });

  const wallet = gate.address;
  const userEnabled = configured && !!token && !!wallet;
  const user = useParallelReads(
    [
      { ...base, functionName: "stakeOf", args: [agentChainId, wallet ?? zeroAddress] },
      { ...base, functionName: "cooldownOf", args: [agentChainId, wallet ?? zeroAddress] },
      { ...base, functionName: "pendingRewards", args: [agentChainId, wallet ?? zeroAddress] },
      {
        address: token,
        abi: erc20Abi,
        chainId: activeChain.id,
        functionName: "balanceOf",
        args: [wallet ?? zeroAddress],
      },
      {
        address: token,
        abi: erc20Abi,
        chainId: activeChain.id,
        functionName: "allowance",
        args: [wallet ?? zeroAddress, patronageAddress ?? zeroAddress],
      },
    ],
    { enabled: userEnabled, refetchInterval: REFETCH_MS },
  );

  const u = user.data as CallResult[] | undefined;
  const cooldownOf = ok<readonly [bigint, bigint]>(u?.[1]);

  const decimals = typeof decimalsRead.data === "number" ? decimalsRead.data : DEFAULT_WAGE_DECIMALS;
  const publicOk = !!d && d.slice(0, 7).every((r) => r?.status === "success");

  const { refetch: refetchPub } = pub;
  const { refetch: refetchUser } = user;
  const refetch = useCallback(async () => {
    await Promise.all([refetchPub(), userEnabled ? refetchUser() : Promise.resolve()]);
  }, [refetchPub, refetchUser, userEnabled]);

  return {
    configured,
    ready: publicOk && typeof decimalsRead.data === "number",
    loadFailed: configured && !pub.isLoading && (pub.isError || (!!d && !publicOk)),
    agentChainId,

    registered: ok<boolean>(d?.[0]) ?? false,
    poolStaked: ok<bigint>(d?.[1]) ?? 0n,
    minStake: ok<bigint>(d?.[2]) ?? 0n,
    maxStakePerUser: ok<bigint>(d?.[3]) ?? 0n,
    cooldownSeconds: Number(ok<number>(d?.[4]) ?? 0),
    paused: ok<boolean>(d?.[5]) ?? false,
    token,
    decimals,

    address: wallet,
    connected: gate.connected,
    wrongNetwork: gate.wrongNetwork,
    userReady: !wallet || (!!u && u.every((r) => r?.status === "success")),
    staked: ok<bigint>(u?.[0]) ?? 0n,
    cooling: cooldownOf?.[0] ?? 0n,
    unlockAt: Number(cooldownOf?.[1] ?? 0n),
    pending: ok<bigint>(u?.[2]) ?? 0n,
    balance: ok<bigint>(u?.[3]) ?? 0n,
    allowance: ok<bigint>(u?.[4]) ?? 0n,

    refetch,
  };
}

/**
 * Posisi satu wallet di BANYAK bangunan sekaligus (halaman /patronage, 4B): stakeOf, cooldownOf dan
 * pendingRewards tiap bangunan dibaca lewat readContract paralel (bukan multicall) langsung dari kontrak. Angka ini live;
 * API indexer hanya dipakai untuk daftar bangunan dan total yang sudah diklaim.
 *
 * `agentChainIds` = bytes32 on-chain. Panggil dengan array yang identik antar-render (isi sama sudah
 * cukup; hook memakai isinya, bukan identitas array, sebagai kunci).
 */
export function usePatronagePositions(agentChainIds: readonly `0x${string}`[]) {
  const gate = useNetworkGate();
  const configured = !!patronageAddress;
  const wallet = gate.address;

  const tokenRead = useReadContract({
    address: patronageAddress,
    abi: patronageAbi,
    chainId: activeChain.id,
    functionName: "wageToken",
    query: { enabled: configured, staleTime: Infinity },
  });
  const token = tokenRead.data as Address | undefined;
  const decimalsRead = useReadContract({
    address: token,
    abi: erc20Abi,
    chainId: activeChain.id,
    functionName: "decimals",
    query: { enabled: !!token, staleTime: Infinity },
  });

  const idsKey = agentChainIds.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `idsKey` mewakili isi `agentChainIds`
  const ids = useMemo(() => [...agentChainIds], [idsKey]);

  const enabled = configured && !!wallet && !gate.wrongNetwork && ids.length > 0;
  const contracts = useMemo(
    () =>
      ids.flatMap((id) => [
        { address: patronageAddress, abi: patronageAbi, chainId: activeChain.id, functionName: "stakeOf" as const, args: [id, wallet ?? zeroAddress] as const },
        { address: patronageAddress, abi: patronageAbi, chainId: activeChain.id, functionName: "cooldownOf" as const, args: [id, wallet ?? zeroAddress] as const },
        { address: patronageAddress, abi: patronageAbi, chainId: activeChain.id, functionName: "pendingRewards" as const, args: [id, wallet ?? zeroAddress] as const },
      ]),
    [ids, wallet],
  );

  const read = useParallelReads(contracts, { enabled, refetchInterval: REFETCH_MS });

  const results = read.data as unknown as CallResult[] | undefined;
  const complete = !!results && results.length === ids.length * 3;
  // Tanpa bangunan sama sekali tidak ada yang dibaca: itu "siap, kosong", bukan "sedang memuat".
  const allOk = ids.length === 0 || (!!results && complete && results.every((r) => r?.status === "success"));

  const rows = useMemo(() => {
    if (!results || !complete) return [] as PositionRow[];
    return ids.map((id, i) => {
      const cd = ok<readonly [bigint, bigint]>(results[i * 3 + 1]);
      return {
        chainAgentId: id,
        staked: ok<bigint>(results[i * 3]) ?? 0n,
        cooling: cd?.[0] ?? 0n,
        unlockAt: Number(cd?.[1] ?? 0n),
        pending: ok<bigint>(results[i * 3 + 2]) ?? 0n,
      } satisfies PositionRow;
    });
  }, [complete, ids, results]);

  const refetchRead = read.refetch;
  const refetch = useCallback(async () => {
    if (enabled) await refetchRead();
  }, [enabled, refetchRead]);

  return {
    configured,
    address: wallet,
    connected: gate.connected,
    wrongNetwork: gate.wrongNetwork,
    /** Semua pembacaan sukses; `rows` aman dijumlahkan dan ditampilkan. */
    ready: allOk,
    loading: enabled && !complete && !read.isError,
    /** Pembacaan gagal (RPC mati / alamat salah): jangan tampilkan angka sebagian. */
    loadFailed: enabled && (read.isError || (complete && !allOk)),
    decimals: typeof decimalsRead.data === "number" ? decimalsRead.data : DEFAULT_WAGE_DECIMALS,
    rows: allOk ? rows : ([] as PositionRow[]),
    refetch,
  };
}

// ---------------------------------------------------------------------------------------------
// Tulis
// ---------------------------------------------------------------------------------------------

export type PatronageAction = "stake" | "requestUnstake" | "withdraw" | "claim" | "claimMany";

export type TxState =
  | { phase: "idle" }
  | {
      phase: "signing" | "confirming";
      action: PatronageAction;
      /** "Approve" / "Stake" ... dengan nomor langkah, mis. 1/2. */
      step: { label: string; index: number; total: number };
      hash?: Hash;
    }
  | { phase: "done"; action: PatronageAction; hash: Hash }
  | { phase: "error"; action: PatronageAction; message: string; hash?: Hash };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function usePatronageActions({
  agentChainId,
  onSettled,
}: {
  /** Bangunan untuk stake/unstake/withdraw/claim. Dikosongkan oleh halaman /patronage (4B), yang
   *  hanya memakai `claimMany`; memanggil aksi satu-bangunan tanpa id akan ditolak sebelum wallet diminta. */
  agentChainId?: `0x${string}`;
  /** Dipanggil setelah transaksi terkonfirmasi (dan setelah gagal-sebagian): muat ulang data. */
  onSettled: () => Promise<void> | void;
}) {
  const config = useConfig();
  const [tx, setTx] = useState<TxState>({ phase: "idle" });
  const busy = useRef(false);

  const needBuilding = useCallback((): `0x${string}` => {
    if (!agentChainId) throw new PatronageUserError("No building selected.");
    return agentChainId;
  }, [agentChainId]);

  /** Cek yang harus lolos sebelum wallet diminta apa pun. */
  const preflight = useCallback(() => {
    if (!patronageAddress) throw new PatronageUserError("Patronage isn't live on this network yet.");
    const account = getAccount(config);
    if (!account.address) throw new PatronageUserError("Connect your wallet first.");
    if (account.chainId !== activeChain.id) {
      throw new PatronageUserError(`Switch your wallet to ${activeChain.name} first.`);
    }
    return { patronage: patronageAddress, user: account.address };
  }, [config]);

  /** Kirim satu transaksi, tunggu receipt, dan pastikan tidak revert. */
  const send = useCallback(
    async (
      action: PatronageAction,
      step: { label: string; index: number; total: number },
      call: () => Promise<Hash>,
    ): Promise<Hash> => {
      setTx({ phase: "signing", action, step });
      const hash = await call();
      setTx({ phase: "confirming", action, step, hash });
      const receipt = await waitForTransactionReceipt(config, { hash, chainId: activeChain.id });
      if (receipt.status !== "success") {
        throw Object.assign(
          new PatronageUserError("The transaction was mined but reverted. Open it on the explorer for details."),
          { hash },
        );
      }
      return hash;
    },
    [config],
  );

  /** Resolve `true` kalau transaksi berhasil, `false` kalau gagal atau sedang ada yang berjalan. */
  const run = useCallback(
    async (action: PatronageAction, body: () => Promise<Hash>): Promise<boolean> => {
      if (busy.current) return false;
      busy.current = true;
      let success = false;
      try {
        const hash = await body();
        setTx({ phase: "done", action, hash });
        success = true;
      } catch (err) {
        const failedHash = (err as { hash?: Hash }).hash;
        setTx({ phase: "error", action, message: describePatronageError(err), hash: failedHash });
      } finally {
        busy.current = false;
        // Walau gagal di langkah kedua (approve sudah masuk), angka di layar harus menyusul.
        try {
          await onSettled();
        } catch {
          /* muat ulang gagal bukan alasan menutupi hasil transaksi */
        }
      }
      return success;
    },
    [onSettled],
  );

  const stake = useCallback(
    (amount: bigint, token: Address) =>
      run("stake", async () => {
        const { patronage, user } = preflight();
        const building = needBuilding(); // tolak sebelum approve, bukan sesudahnya

        // Baca segar saat aksi, bukan angka di layar yang bisa basi beberapa detik.
        const [balance, allowance] = await Promise.all([
          readContract(config, { address: token, abi: erc20Abi, chainId: activeChain.id, functionName: "balanceOf", args: [user] }),
          readContract(config, { address: token, abi: erc20Abi, chainId: activeChain.id, functionName: "allowance", args: [user, patronage] }),
        ]);
        if (balance < amount) throw new PatronageUserError("Your wallet doesn't hold enough $WAGE for that.");

        const needsApprove = allowance < amount;
        const total = needsApprove ? 2 : 1;

        if (needsApprove) {
          // Persetujuan tepat sejumlah yang di-stake, bukan "unlimited".
          await send("stake", { label: "Approve $WAGE", index: 1, total }, () =>
            writeContract(config, {
              address: token,
              abi: erc20Abi,
              chainId: activeChain.id,
              functionName: "approve",
              args: [patronage, amount],
            }),
          );
          // Beberapa RPC membaca state sedikit tertinggal; tunggu allowance terlihat sebelum
          // meminta tanda tangan kedua, kalau tidak estimasi gas stake() bisa revert palsu.
          for (let i = 0; i < 6; i++) {
            const seen = await readContract(config, {
              address: token,
              abi: erc20Abi,
              chainId: activeChain.id,
              functionName: "allowance",
              args: [user, patronage],
            });
            if (seen >= amount) break;
            await sleep(1_000);
          }
        }

        return send("stake", { label: "Stake", index: total, total }, () =>
          writeContract(config, {
            address: patronage,
            abi: patronageAbi,
            chainId: activeChain.id,
            functionName: "stake",
            args: [building, amount],
          }),
        );
      }),
    [needBuilding, config, preflight, run, send],
  );

  const requestUnstake = useCallback(
    (amount: bigint) =>
      run("requestUnstake", async () => {
        const { patronage } = preflight();
        return send("requestUnstake", { label: "Request unstake", index: 1, total: 1 }, () =>
          writeContract(config, {
            address: patronage,
            abi: patronageAbi,
            chainId: activeChain.id,
            functionName: "requestUnstake",
            args: [needBuilding(), amount],
          }),
        );
      }),
    [needBuilding, config, preflight, run, send],
  );

  const withdraw = useCallback(
    () =>
      run("withdraw", async () => {
        const { patronage } = preflight();
        return send("withdraw", { label: "Withdraw", index: 1, total: 1 }, () =>
          writeContract(config, {
            address: patronage,
            abi: patronageAbi,
            chainId: activeChain.id,
            functionName: "withdraw",
            args: [needBuilding()],
          }),
        );
      }),
    [needBuilding, config, preflight, run, send],
  );

  const claim = useCallback(
    () =>
      run("claim", async () => {
        const { patronage } = preflight();
        return send("claim", { label: "Claim", index: 1, total: 1 }, () =>
          writeContract(config, {
            address: patronage,
            abi: patronageAbi,
            chainId: activeChain.id,
            functionName: "claim",
            args: [needBuilding()],
          }),
        );
      }),
    [needBuilding, config, preflight, run, send],
  );

  /** Klaim banyak bangunan sekaligus (`claimMany`). Bangunan tanpa reward dilewati kontrak; revert
   *  hanya bila seluruh batch tidak membayar apa pun. Tetap bisa saat kontrak di-pause. */
  const claimMany = useCallback(
    (agentIds: readonly `0x${string}`[]) =>
      run("claimMany", async () => {
        const { patronage } = preflight();
        if (agentIds.length === 0) throw new PatronageUserError("There are no patron rewards to claim yet.");
        return send("claimMany", { label: "Claim all", index: 1, total: 1 }, () =>
          writeContract(config, {
            address: patronage,
            abi: patronageAbi,
            chainId: activeChain.id,
            functionName: "claimMany",
            args: [[...agentIds]],
          }),
        );
      }),
    [config, preflight, run, send],
  );

  const reset = useCallback(() => {
    if (!busy.current) setTx({ phase: "idle" });
  }, []);

  return {
    tx,
    busy: tx.phase === "signing" || tx.phase === "confirming",
    stake,
    requestUnstake,
    withdraw,
    claim,
    claimMany,
    reset,
  };
}
