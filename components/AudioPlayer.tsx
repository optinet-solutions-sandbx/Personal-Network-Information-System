"use client";

// A compact, futuristic audio player used wherever we play back a voice
// recording (the Add-contact composer, the contact recorder, and saved voice
// notes). Replaces the raw <audio controls> element — whose default chrome is a
// light grey bar that clashes with the dark UI — with a glowing gradient play
// control and a clickable waveform that fills as the clip plays. Renders just
// the controls; callers provide any surrounding box.

import { useMemo, useRef, useState } from "react";

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Stable pseudo-random bar heights (classic fract(sin) hash) so the waveform
// looks organic but never flickers across renders.
function waveform(count: number): number[] {
  return Array.from({ length: count }, (_, i) => {
    const v = Math.abs(Math.sin((i + 1) * 12.9898) * 43758.5453);
    const frac = v - Math.floor(v);
    return 22 + frac * 78; // 22%–100% tall
  });
}

export default function AudioPlayer({
  src,
  label,
  onRemove,
  tone = "default",
  className = "",
}: {
  src: string;
  /** Optional filename/title shown next to the play button. */
  label?: string;
  /** When provided, renders an ✕ button that calls this. */
  onRemove?: () => void;
  /** "accent" recolors the player for a solid indigo background (chat bubble). */
  tone?: "default" | "accent";
  className?: string;
}) {
  const accent = tone === "accent";
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const bars = useMemo(() => waveform(64), []);

  function toggle() {
    const a = ref.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  }

  // Chrome reports `Infinity` for MediaRecorder webm blobs that lack a duration
  // header. Nudging currentTime to the end forces it to compute the real value.
  function handleLoaded() {
    const a = ref.current;
    if (!a) return;
    if (!Number.isFinite(a.duration)) {
      const fix = () => {
        a.removeEventListener("timeupdate", fix);
        a.currentTime = 0;
        setDuration(Number.isFinite(a.duration) ? a.duration : 0);
      };
      a.addEventListener("timeupdate", fix);
      a.currentTime = 1e7;
    } else {
      setDuration(a.duration);
    }
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const a = ref.current;
    if (!a || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    a.currentTime = frac * duration;
    setCurrent(a.currentTime);
  }

  const progress = duration ? current / duration : 0;

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <audio
        ref={ref}
        src={src}
        preload="metadata"
        onLoadedMetadata={handleLoaded}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        className="hidden"
      />

      {/* Play / pause — glowing gradient orb (white orb on an accent bg). */}
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause" : "Play"}
        className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all duration-200 hover:scale-105 active:scale-95 ${
          accent
            ? "bg-white text-indigo-600 shadow-[0_0_12px_rgba(255,255,255,0.5)]"
            : `bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-white ${
                playing
                  ? "shadow-[0_0_18px_rgba(139,92,246,0.85)]"
                  : "shadow-[0_0_10px_rgba(99,102,241,0.5)] hover:shadow-[0_0_16px_rgba(99,102,241,0.8)]"
              }`
        }`}
      >
        {/* soft outer halo */}
        <span
          aria-hidden
          className={`absolute inset-0 rounded-full blur-md transition-opacity ${
            accent ? "bg-white/40" : "bg-violet-500/30"
          } ${playing ? "opacity-100" : "opacity-0"}`}
        />
        {playing ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden className="relative">
            <rect x="6" y="5" width="4" height="14" rx="1.2" />
            <rect x="14" y="5" width="4" height="14" rx="1.2" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden className="relative ml-0.5">
            <path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.29-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14Z" />
          </svg>
        )}
      </button>

      {label && (
        <span
          className={`max-w-[6.5rem] shrink-0 truncate text-[11px] font-medium uppercase tracking-wide ${
            accent ? "text-indigo-100/80" : "text-zinc-400"
          }`}
          title={label}
        >
          {label}
        </span>
      )}

      {/* Waveform scrubber — many thin bars; those left of the playhead glow,
          the rest stay dim. Capped width so it reads as a sleek equalizer
          instead of stretching into fat blobs on wide containers. */}
      <div
        onClick={seek}
        className="group flex h-8 w-full max-w-[360px] flex-1 cursor-pointer items-center gap-[2px]"
      >
        {bars.map((h, i) => {
          const played = (i + 0.5) / bars.length <= progress;
          const dimClass = played
            ? ""
            : accent
            ? "bg-white/30"
            : "bg-zinc-300";
          return (
            <div
              key={i}
              className={`w-full flex-1 rounded-full transition-all duration-150 ${dimClass}`}
              style={{
                height: `${h}%`,
                background: played
                  ? accent
                    ? "#ffffff"
                    : "linear-gradient(to top, #6366f1, #d946ef)"
                  : undefined,
                boxShadow: played
                  ? accent
                    ? "0 0 5px rgba(255,255,255,0.8)"
                    : "0 0 4px rgba(139,92,246,0.65)"
                  : undefined,
              }}
            />
          );
        })}
      </div>

      <span
        className={`shrink-0 text-[11px] tabular-nums ${
          accent ? "text-indigo-100/90" : "text-zinc-400"
        }`}
      >
        {fmt(current)} / {fmt(duration)}
      </span>

      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title="Remove recording"
          aria-label="Remove recording"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-200 hover:text-red-500"
        >
          ✕
        </button>
      )}
    </div>
  );
}
