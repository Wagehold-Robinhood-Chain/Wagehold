"use client";

import { useAppKit, useAppKitAccount, useAppKitNetwork } from "@reown/appkit/react";
import { useDisconnect } from "wagmi";
import { Button } from "@/components/ui/button";
import { SUPPORTED_CHAIN_IDS } from "@/lib/web3/chains";
import { isWeb3Configured } from "@/lib/web3/config";

function truncate(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Rendered instead of WalletConnectActive when NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID isn't
 *  set yet -- no Reown/wagmi hooks called here (unlike WalletConnectActive below), since
 *  those throw if the modal was never initialized (see web3-provider.tsx). Kept as a
 *  separate component rather than an early return inside WalletConnectActive so the hook
 *  calls below stay unconditional either way (rules-of-hooks). */
function WalletConnectDisabled() {
  return (
    <span
      title="Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID in .env.local (see .env.local.example) to enable wallet connect"
      className="cursor-not-allowed rounded-[7px] border border-line px-2.5 py-1 text-xs text-muted opacity-60"
    >
      Connect wallet
    </span>
  );
}

function WalletConnectActive() {
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const { chainId } = useAppKitNetwork();
  const { disconnect } = useDisconnect();

  if (!isConnected || !address) {
    return (
      <Button size="small" onClick={() => open()}>
        Connect wallet
      </Button>
    );
  }

  const wrongNetwork = typeof chainId === "number" && !SUPPORTED_CHAIN_IDS.has(chainId);

  if (wrongNetwork) {
    return (
      <Button
        size="small"
        className="border-[#d97a4a] text-[#d97a4a] hover:border-[#d97a4a]"
        onClick={() => open({ view: "Networks" })}
      >
        Wrong network -- switch
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Button size="small" onClick={() => open({ view: "Account" })}>
        {truncate(address)}
      </Button>
      <button
        onClick={() => disconnect()}
        aria-label="Disconnect wallet"
        title="Disconnect wallet"
        className="rounded-[7px] border border-line px-2 py-1 text-xs text-muted transition-colors hover:border-[#46507a] hover:text-text"
      >
        ×
      </button>
    </div>
  );
}

/** Item 5 (Fase 2) -- Connect/disconnect a wallet via WalletConnect (or any injected wallet,
 *  Reown AppKit bundles both). Deliberately stops at connection state here: it does not yet
 *  read balances or send transactions -- that's Fase 2 item 6-7, once "Post a Job"/"Set the
 *  seal" actually call WageholdStrongbox/WageholdSplitter instead of the current database
 *  simulation. Placed next to AuthStatus in every page header (both concern "who is this
 *  session", just two different identities: Supabase email vs. on-chain wallet). */
export function WalletConnect() {
  if (!isWeb3Configured) return <WalletConnectDisabled />;
  return <WalletConnectActive />;
}
