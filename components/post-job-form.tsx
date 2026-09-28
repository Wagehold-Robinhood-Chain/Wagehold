"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { WARD_LABEL } from "@/types/domain";
import type { DistrictId } from "@/types/domain";

export interface PostJobValues {
  title: string;
  brief: string;
  district: DistrictId;
  budgetUsdc: number;
}

export function PostJobForm({
  onSubmit,
  submitting,
  submittingLabel,
  initialDistrict,
}: {
  onSubmit: (values: PostJobValues) => void;
  submitting?: boolean;
  /** Label tombol yang lebih spesifik selagi submitting (mis. "Approving
   *  USDC…" / "Saving job…" dari alur on-chain, Fase 2 item 6). Jatuh ke
   *  "Locking wage…" kalau tidak diisi. */
  submittingLabel?: string;
  /** Dipakai saat datang dari tombol "Hire" di Page E (Wright Profile) --
   *  belum jadi assignment langsung ke Wright itu (Warden yang merutekan
   *  job, Fase 3 item 5), jadi baru sebatas mem-prefill Ward-nya. */
  initialDistrict?: DistrictId;
}) {
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [district, setDistrict] = useState<DistrictId>(initialDistrict ?? "research");
  const [budget, setBudget] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const budgetUsdc = Number(budget);
    if (!title || !brief || !budgetUsdc) return;
    onSubmit({ title, brief, district, budgetUsdc });
  }

  const labelClass = "flex flex-col gap-1 text-[11px] tracking-wide text-muted";
  const inputClass =
    "rounded-md border border-line bg-bg px-2.5 py-1.5 text-sm text-text outline-none focus-visible:border-gold";

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
          value={district}
          onChange={(e) => setDistrict(e.target.value as DistrictId)}
        >
          {Object.entries(WARD_LABEL).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <label className={labelClass}>
        Wage (USDC)
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

      <div className="col-span-full flex justify-end">
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? submittingLabel ?? "Locking wage…" : "Lock wage in the Strongbox"}
        </Button>
      </div>
    </form>
  );
}
