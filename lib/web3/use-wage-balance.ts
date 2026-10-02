'use client';

import { erc20Abi, formatUnits } from 'viem';
import { useAccount, useReadContract } from 'wagmi';
import { wageTokenAddress } from '@/lib/web3/strongbox';
import { isWalletMode } from '@/lib/identity/mode';
import { activeChain } from '@/lib/web3/chains';

/**
 * Saldo $WAGE wallet yang sedang terhubung (Revision 1: stat "Your wallet").
 *
 * `null` = tidak ada yang bisa ditampilkan: mode simulasi (tidak ada wallet/saldo),
 * wallet belum terhubung, atau saldo belum terbaca. Hook wagmi dipanggil tanpa syarat
 * (aturan hooks); `query.enabled` yang mematikan pembacaannya.
 */
export function useWageBalance(): number | null {
  const { address, isConnected } = useAccount();
  const enabled =
    isWalletMode && isConnected && !!address && !!wageTokenAddress;

  const balance = useReadContract({
    address: wageTokenAddress,
    abi: erc20Abi,
    chainId: activeChain.id,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled, refetchInterval: 30_000 },
  });
  const decimals = useReadContract({
    address: wageTokenAddress,
    abi: erc20Abi,
    chainId: activeChain.id,
    functionName: 'decimals',
    query: { enabled, staleTime: Infinity },
  });

  if (!enabled || balance.data === undefined || decimals.data === undefined) {
    return null;
  }
  return Number(formatUnits(balance.data, decimals.data));
}
