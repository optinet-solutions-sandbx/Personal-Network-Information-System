"use client";

import type { HealthInputs } from "@/lib/types";

type Props = {
  score: number;
  tier: string;
  inputs: HealthInputs;
};

const TIER_BADGE: Record<string, string> = {
  Strong: "text-green-700 bg-green-50 border-green-200",
  Active: "text-blue-700 bg-blue-50 border-blue-200",
  Fading: "text-amber-700 bg-amber-50 border-amber-200",
  Dormant: "text-gray-500 bg-gray-50 border-gray-200",
};

const TIER_DOT: Record<string, string> = {
  Strong: "bg-green-500",
  Active: "bg-blue-500",
  Fading: "bg-amber-500",
  Dormant: "bg-gray-400",
};

const TIER_BAR: Record<string, string> = {
  Strong: "bg-green-400",
  Active: "bg-blue-400",
  Fading: "bg-amber-400",
  Dormant: "bg-gray-400",
};

function SubScore({
  label,
  value,
  max,
  barColor,
}: {
  label: string;
  value: number;
  max: number;
  barColor: string;
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>{label}</span>
        <span className="font-medium">
          {value}/{max}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function HealthCard({ score, tier, inputs }: Props) {
  const badgeClass = TIER_BADGE[tier] ?? TIER_BADGE.Dormant;
  const dotClass = TIER_DOT[tier] ?? TIER_DOT.Dormant;
  const barClass = TIER_BAR[tier] ?? TIER_BAR.Dormant;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          Relationship Health
        </h3>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeClass}`}
        >
          <span className={`h-2 w-2 rounded-full ${dotClass}`} />
          {tier}
        </span>
      </div>
      <p className="mb-4 text-4xl font-bold text-gray-800">
        {score}
        <span className="text-base font-normal text-gray-400">/100</span>
      </p>
      <div className="space-y-3">
        <SubScore label="Recency" value={inputs.recency} max={40} barColor={barClass} />
        <SubScore label="Frequency (90d)" value={inputs.frequency} max={30} barColor={barClass} />
        <SubScore label="Profile richness" value={inputs.richness} max={30} barColor={barClass} />
      </div>
    </div>
  );
}
