"use client";

import { useState, useEffect } from "react";
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

function daysAgoLabel(iso: string | null): string {
  if (!iso) return "never";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

type TableRow = { label: string; pts: string; active: boolean };

function buildRecencyTable(score: number): TableRow[] {
  return [
    { label: "Within 7 days", pts: "40 pts", active: score === 40 },
    { label: "Within 30 days", pts: "30 pts", active: score === 30 },
    { label: "Within 90 days", pts: "20 pts", active: score === 20 },
    { label: "Within 180 days", pts: "10 pts", active: score === 10 },
    { label: "Over 180 days / no notes", pts: "0 pts", active: score === 0 },
  ];
}

function buildFrequencyTable(score: number): TableRow[] {
  return [
    { label: "10 or more notes", pts: "30 pts", active: score === 30 },
    { label: "5 – 9 notes", pts: "22 pts", active: score === 22 },
    { label: "2 – 4 notes", pts: "15 pts", active: score === 15 },
    { label: "1 note", pts: "8 pts", active: score === 8 },
    { label: "No notes", pts: "0 pts", active: score === 0 },
  ];
}

type ModalState = { type: "recency" | "frequency" | "richness" } | null;

function DetailModal({
  type,
  inputs,
  onClose,
}: {
  type: "recency" | "frequency" | "richness";
  inputs: HealthInputs;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const titles = { recency: "Recency", frequency: "Frequency (90d)", richness: "Profile Richness" };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white shadow-xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-sm font-semibold text-gray-800">{titles[type]}</h4>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
          >
            ×
          </button>
        </div>

        {type === "recency" && (
          <>
            <p className="text-xs text-gray-500 mb-4">
              Based on when the most recent note was added.{" "}
              <span className="font-medium text-gray-700">
                Last note: {daysAgoLabel(inputs.lastNoteAt)}
              </span>
            </p>
            <ScoreTable rows={buildRecencyTable(inputs.recency)} score={inputs.recency} max={40} />
          </>
        )}

        {type === "frequency" && (
          <>
            <p className="text-xs text-gray-500 mb-4">
              Notes added in the last 90 days.{" "}
              <span className="font-medium text-gray-700">
                {inputs.noteCount90d} note{inputs.noteCount90d !== 1 ? "s" : ""} recorded
              </span>
            </p>
            <ScoreTable rows={buildFrequencyTable(inputs.frequency)} score={inputs.frequency} max={30} />
          </>
        )}

        {type === "richness" && (
          <>
            <p className="text-xs text-gray-500 mb-4">
              3 points per filled field across 10 tracked fields.{" "}
              <span className="font-medium text-gray-700">
                {inputs.filledFields} of 10 fields filled
              </span>
            </p>
            <div className="grid grid-cols-2 gap-1.5 mb-4">
              {[
                "Email", "Phone", "Company", "Title",
                "Location", "Tags", "How we met", "Birthday",
                "Profile", "Custom fields",
              ].map((field, i) => {
                const filled = i < inputs.filledFields;
                return (
                  <div
                    key={field}
                    className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs ${
                      filled
                        ? "bg-green-50 text-green-700"
                        : "bg-gray-50 text-gray-400"
                    }`}
                  >
                    <span>{filled ? "✓" : "○"}</span>
                    {field}
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between text-xs text-gray-500 border-t pt-3">
              <span>Score</span>
              <span className="font-semibold text-gray-700">{inputs.richness} / 30</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ScoreTable({ rows, score, max }: { rows: TableRow[]; score: number; max: number }) {
  return (
    <div className="space-y-1">
      {rows.map((r) => (
        <div
          key={r.label}
          className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs ${
            r.active
              ? "bg-indigo-50 text-indigo-700 font-semibold ring-1 ring-indigo-200"
              : "text-gray-500"
          }`}
        >
          <span>{r.label}</span>
          <span>{r.pts}</span>
        </div>
      ))}
      <div className="flex justify-between text-xs text-gray-500 border-t pt-2 mt-2">
        <span>Your score</span>
        <span className="font-semibold text-gray-700">{score} / {max}</span>
      </div>
    </div>
  );
}

function SubScore({
  label,
  value,
  max,
  barColor,
  delay,
  animated,
  onClick,
}: {
  label: string;
  value: number;
  max: number;
  barColor: string;
  delay: number;
  animated: boolean;
  onClick: () => void;
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left group rounded-lg px-2 py-1.5 -mx-2 hover:bg-gray-50 transition-colors"
    >
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span className="group-hover:text-gray-700 transition-colors">
          {label}
          <span className="ml-1 text-gray-300 group-hover:text-indigo-400 transition-colors text-[10px]">↗</span>
        </span>
        <span className="font-medium">{value}/{max}</span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div
          className={`h-full rounded-full ${barColor}`}
          style={{
            width: animated ? `${pct}%` : "0%",
            transition: `width 900ms cubic-bezier(0.4, 0, 0.2, 1) ${delay}ms`,
          }}
        />
      </div>
    </button>
  );
}

export default function HealthCard({ score, tier, inputs }: Props) {
  const badgeClass = TIER_BADGE[tier] ?? TIER_BADGE.Dormant;
  const dotClass = TIER_DOT[tier] ?? TIER_DOT.Dormant;
  const barClass = TIER_BAR[tier] ?? TIER_BAR.Dormant;
  const [animated, setAnimated] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);

  useEffect(() => {
    const id = setTimeout(() => setAnimated(true), 80);
    return () => clearTimeout(id);
  }, []);

  return (
    <>
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between mb-1">
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

        {/* animated accent line under the heading */}
        <div className="mb-3 h-px bg-gray-100 overflow-hidden rounded-full">
          <div
            className="h-full bg-gradient-to-r from-indigo-300 via-indigo-200 to-transparent"
            style={{
              width: animated ? "100%" : "0%",
              transition: "width 700ms cubic-bezier(0.4, 0, 0.2, 1) 60ms",
            }}
          />
        </div>

        <p className="mb-4 text-4xl font-bold text-gray-800">
          {score}
          <span className="text-base font-normal text-gray-400">/100</span>
        </p>

        <div className="space-y-1">
          <SubScore
            label="Recency"
            value={inputs.recency}
            max={40}
            barColor={barClass}
            delay={120}
            animated={animated}
            onClick={() => setModal({ type: "recency" })}
          />
          <SubScore
            label="Frequency (90d)"
            value={inputs.frequency}
            max={30}
            barColor={barClass}
            delay={270}
            animated={animated}
            onClick={() => setModal({ type: "frequency" })}
          />
          <SubScore
            label="Profile richness"
            value={inputs.richness}
            max={30}
            barColor={barClass}
            delay={420}
            animated={animated}
            onClick={() => setModal({ type: "richness" })}
          />
        </div>
      </div>

      {modal && (
        <DetailModal
          type={modal.type}
          inputs={inputs}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}
