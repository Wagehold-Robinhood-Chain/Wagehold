'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { WARD_LABEL } from '@/types/domain';
import { WAGE_SPLIT, WAGE_TOKEN } from '@/lib/currency';
import { isOnChainEscrowConfigured } from '@/lib/web3/strongbox';
import type { DistrictId } from '@/types/domain';

export interface PostJobValues {
  title: string;
  brief: string;
  district: DistrictId;
  budgetUsdc: number;
  /** Hire langsung: id bangunan (Wright) pilihan client. Kosong = Warden yang memilih. */
  agentId?: string;
}

/** Bangunan (Wright) yang bisa dipilih di Gate. */
export interface PostJobBuilding {
  id: string;
  name: string;
  code: string;
  district: DistrictId;
}

export function PostJobForm({
  onSubmit,
  submitting,
  submittingLabel,
  initialDistrict,
  initialAgentId,
  buildings = [],
}: {
  onSubmit: (values: PostJobValues) => void;
  submitting?: boolean;
  /** Label tombol yang lebih spesifik selagi submitting (mis. "Approving
   *  $WAGE…" / "Saving job…" dari alur on-chain, Fase 2 item 6). Jatuh ke
   *  "Locking wage…" kalau tidak diisi. */
  submittingLabel?: string;
  /** Dipakai saat datang dari tombol "Hire" di Page E (Wright Profile) --
   *  belum jadi assignment langsung ke Wright itu (Warden yang merutekan
   *  job, Fase 3 item 5), jadi baru sebatas mem-prefill Ward-nya. */
  initialDistrict?: DistrictId;
  /** ?agent= dari tombol "Hire {nama}" -- bangunan yang sudah terpilih. */
  initialAgentId?: string;
  /** Wright yang bisa di-hire langsung (Warden tidak termasuk). */
  buildings?: PostJobBuilding[];
}) {
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [district, setDistrict] = useState<DistrictId>(
    initialDistrict ?? 'research',
  );
  const [budget, setBudget] = useState('');
  const [agentId, setAgentId] = useState<string>(
    buildings.some((b) => b.id === initialAgentId) ? (initialAgentId ?? '') : '',
  );
  const chosen = buildings.find((b) => b.id === agentId);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const budgetUsdc = Number(budget);
    if (!title || !brief || !budgetUsdc) return;
    onSubmit({
      title,
      brief,
      // Bangunan pilihan menentukan Ward-nya.
      district: chosen ? chosen.district : district,
      budgetUsdc,
      ...(chosen ? { agentId: chosen.id } : {}),
    });
  }

  const labelClass = 'flex flex-col gap-1 text-[11px] tracking-wide text-muted';
  const inputClass =
    'rounded-md border border-line bg-bg px-2.5 py-1.5 text-sm text-text outline-none focus-visible:border-gold';

  return (
    <form
      onSubmit={handleSubmit}
      className="grid grid-cols-1 gap-2 border-b border-line bg-surface-2 p-3.5 sm:grid-cols-2"
    >
      <label className={`${labelClass} col-span-full`}>
        Job title
        <input
          className={inputClass}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder='e.g. "Due diligence report on Pinisi Protocol"'
          required
        />
      </label>

      <label className={`${labelClass} col-span-full`}>
        Brief
        <textarea
          className={`${inputClass} min-h-20 resize-y`}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="What does the Wright need to deliver?"
          required
        />
      </label>

      <label className={labelClass}>
        Ward
        <select
          className={inputClass}
          value={chosen ? chosen.district : district}
          onChange={(e) => {
            const next = e.target.value as DistrictId;
            setDistrict(next);
            // Ganti Ward yang tidak cocok dengan bangunan terpilih -> kembali ke Warden.
            if (chosen && chosen.district !== next) setAgentId('');
          }}
        >
          {Object.entries(WARD_LABEL).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>

      {buildings.length > 0 && (
        <label className={`${labelClass} col-span-full`}>
          Building
          <select
            className={inputClass}
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
          >
            <option value="">Let the Ward&apos;s Warden choose</option>
            {Object.entries(WARD_LABEL).map(([wardId, wardLabel]) => {
              const inWard = buildings.filter((b) => b.district === wardId);
              if (inWard.length === 0) return null;
              return (
                <optgroup key={wardId} label={wardLabel}>
                  {inWard.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} · {b.code}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
          <span className="text-[11px] text-faint">
            {`Optional. Pick a building to hire it directly; its patrons share the ${WAGE_SPLIT.patronsPct}% patron cut when you set the seal.`}
          </span>
        </label>
      )}

      <label className={labelClass}>
        Wage ({WAGE_TOKEN})
        <input
          className={inputClass}
          type="number"
          min={1}
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          placeholder="420"
          required
        />
      </label>

      <p className="col-span-full text-[11.5px] text-faint">
        Priced and paid in {WAGE_TOKEN}. On seal: {WAGE_SPLIT.patronsPct}% patrons ·{' '}
        {WAGE_SPLIT.lampOilPct}% Lamp Oil · {WAGE_SPLIT.tithePct}% tithe ·{' '}
        {WAGE_SPLIT.furnacePct}% burned.
      </p>

      {!isOnChainEscrowConfigured && (
        <p className="col-span-full text-[11.5px] text-faint">
          Simulation mode: the wage is recorded in the database only. No{' '}
          {WAGE_TOKEN} is moved and no wallet is needed.
        </p>
      )}

      <div className="col-span-full flex justify-end">
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting
            ? (submittingLabel ?? 'Locking wage…')
            : 'Lock wage in the Strongbox'}
        </Button>
      </div>
    </form>
  );
}
