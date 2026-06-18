"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Swal from "sweetalert2";
import type { Contact, ContactInput } from "@/lib/types";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { computeUpcomingBirthdays, formatBirthday } from "@/lib/birthdays";

const TIER_DOT: Record<string, string> = {
  Strong: "bg-green-500",
  Active: "bg-blue-500",
  Fading: "bg-amber-500",
  Dormant: "bg-gray-400",
};

// How many photos the composer accepts per contact.
const MAX_ATTACHMENTS = 4;
// Longest edge we downscale photos to before upload — keeps the request small
// (and within the serverless body limit) without hurting OCR of the vision model.
const MAX_IMAGE_DIM = 1568;

type Attachment = { name: string; url: string };

// Read an image File and return a (possibly downscaled) data URL. Large photos
// are re-encoded as JPEG via a canvas; small ones pass through untouched.
async function fileToDataUrl(file: File): Promise<string> {
  const original = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("decode failed"));
    i.src = original;
  });

  const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(img.width, img.height));
  // Already small enough and not huge on disk — keep the original bytes.
  if (scale === 1 && original.length < 1_500_000) return original;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return original;
  // Flatten onto white so transparent PNGs don't turn black as JPEG.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

export default function HomePage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [extracted, setExtracted] = useState<ContactInput | null>(null);
  const [saving, setSaving] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [story, setStory] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [enrich, setEnrich] = useState(true);
  const [enrichedKeys, setEnrichedKeys] = useState<string[]>([]);
  const [enrichedContact, setEnrichedContact] = useState<string[]>([]);
  const [enrichedContactSources, setEnrichedContactSources] = useState<
    Record<string, string>
  >({});
  const [sources, setSources] = useState<{ title: string; url: string }[]>([]);
  const [showReExtractConfirm, setShowReExtractConfirm] = useState(false);
  const [showExtractToast, setShowExtractToast] = useState(false);
  const [inputTruncated, setInputTruncated] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Composer attachments (photos) + the "+" attach menu.
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Live-camera capture ("Take photo").
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Word-scanning animation state
  const [scanIndex, setScanIndex] = useState(0);
  const storyTokens = useMemo(() => story.split(/(\s+)/).filter(Boolean), [story]);
  const tokenWordIndices = useMemo(() => {
    let w = 0;
    return storyTokens.map(t => (t.trim() ? w++ : -1));
  }, [storyTokens]);
  const wordCount = useMemo(() => storyTokens.filter(t => t.trim()).length, [storyTokens]);

  useEffect(() => {
    if (!extracting) { setScanIndex(0); return; }
    const id = setInterval(() => setScanIndex(i => (i + 1) % Math.max(1, wordCount)), 100);
    return () => clearInterval(id);
  }, [extracting, wordCount]);

  const { listening, supported, toggle } = useSpeechRecognition({
    onResult: (text) => setStory((t) => (t ? `${t} ${text}` : text)),
  });

  // Close the attach menu on any outside click.
  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) return;
    const picked = Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .slice(0, room);
    try {
      const next = await Promise.all(
        picked.map(async (f) => ({ name: f.name, url: await fileToDataUrl(f) }))
      );
      setAttachments((prev) => [...prev, ...next].slice(0, MAX_ATTACHMENTS));
    } catch {
      setExtractError("Couldn't read one of those images — try a different file.");
    }
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  // Open the live camera modal (works on desktop + mobile via getUserMedia).
  function openCamera() {
    setMenuOpen(false);
    if (attachments.length >= MAX_ATTACHMENTS) return;
    setCameraError(null);
    setCameraOpen(true);
  }

  // Acquire/tear down the camera stream while the modal is open.
  useEffect(() => {
    if (!cameraOpen) return;
    let cancelled = false;
    const media = navigator.mediaDevices;
    if (!media?.getUserMedia) {
      setCameraError("This browser can't access a camera. Use “Add photos” instead.");
      return;
    }
    media
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCameraError(
            "Couldn't access the camera — check the browser permission, or use “Add photos” instead."
          );
        }
      });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [cameraOpen]);

  // Snapshot the current video frame into an attachment, downscaling to match
  // uploaded photos, then close the camera.
  function capturePhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const scale = Math.min(
      1,
      MAX_IMAGE_DIM / Math.max(video.videoWidth, video.videoHeight)
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg", 0.85);
    setAttachments((prev) =>
      [...prev, { name: `photo-${prev.length + 1}.jpg`, url }].slice(0, MAX_ATTACHMENTS)
    );
    setCameraOpen(false);
  }

  async function handleExtract() {
    if (!story.trim() && attachments.length === 0) return;
    setExtracting(true);
    setExtractError(null);
    Swal.fire({
      title: "Analyzing Story...",
      html: '<p style="font-size:0.875rem;color:#6b7280">Extracting contact details from your story</p>',
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => Swal.showLoading(),
    });
    try {
      const res = await fetch("/api/contacts/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: story,
          enrich,
          images: attachments.map((a) => a.url),
        }),
      });
      if (!res.ok) {
        setExtractError(
          res.status === 429
            ? "You're going a bit fast — please wait a moment and try again."
            : "Couldn't extract details — try rephrasing or extracting again."
        );
        return;
      }
      const {
        fields,
        enriched,
        enrichedContact: enrichedC,
        enrichedContactSources: enrichedCSrcs,
        sources: srcs,
        truncated,
      } = (await res.json()) as {
        fields: ContactInput;
        enriched?: string[];
        enrichedContact?: string[];
        enrichedContactSources?: Record<string, string>;
        sources?: { title: string; url: string }[];
        truncated?: boolean;
      };
      setInputTruncated(truncated === true);
      // Normalise all field values to strings to guard against LLM returning arrays/numbers
      const safe: ContactInput = {
        name: String(fields.name ?? ""),
        title: fields.title ? String(fields.title) : undefined,
        company: fields.company ? String(fields.company) : undefined,
        email: fields.email ? String(fields.email) : undefined,
        phone: fields.phone ? String(fields.phone) : undefined,
        location: fields.location ? String(fields.location) : undefined,
        tags: fields.tags ? String(fields.tags) : undefined,
        howWeMet: fields.howWeMet ? String(fields.howWeMet) : undefined,
        birthday: fields.birthday ? String(fields.birthday) : undefined,
        customFields:
          fields.customFields && Object.keys(fields.customFields).length > 0
            ? fields.customFields
            : undefined,
      };
      setExtracted(safe);
      setEnrichedKeys(
        Array.isArray(enriched)
          ? enriched.filter((k) => k in (safe.customFields ?? {}))
          : []
      );
      setEnrichedContact(Array.isArray(enrichedC) ? enrichedC : []);
      setEnrichedContactSources(
        enrichedCSrcs && typeof enrichedCSrcs === "object" ? enrichedCSrcs : {}
      );
      setSources(Array.isArray(srcs) ? srcs : []);
      setExtractError(null);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      setShowExtractToast(true);
      toastTimer.current = setTimeout(() => setShowExtractToast(false), 4000);
    } finally {
      setExtracting(false);
      Swal.close();
    }
  }

  function resetForm() {
    setStory("");
    setExtracted(null);
    setExtractError(null);
    setEnrichedKeys([]);
    setEnrichedContact([]);
    setEnrichedContactSources({});
    setSources([]);
    setInputTruncated(false);
    setAttachments([]);
    setMenuOpen(false);
  }

  // One page of the grid. Search runs server-side via `q`; results are paged.
  const PAGE_SIZE = 24;

  const fetchPage = useCallback(async (q: string, offset: number) => {
    const res = await fetch(
      `/api/contacts?q=${encodeURIComponent(q)}&limit=${PAGE_SIZE}&offset=${offset}`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as Contact[];
    const more = res.headers.get("X-Has-More") === "true";
    return { data, more };
  }, []);

  const load = useCallback(
    async (q: string) => {
      setLoading(true);
      setLoadError(false);
      try {
        const { data, more } = await fetchPage(q, 0);
        setContacts(data);
        setHasMore(more);
      } catch {
        setContacts([]);
        setHasMore(false);
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    },
    [fetchPage]
  );

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const { data, more } = await fetchPage(query, contacts.length);
      setContacts((prev) => [...prev, ...data]);
      setHasMore(more);
    } catch {
      setLoadError(true);
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPage, query, contacts.length]);

  // Seed the search box from a `?q=` param so dashboard deep-links (company /
  // tag pills) land here pre-filtered. Read once on mount; we use
  // window.location instead of useSearchParams to avoid a Suspense boundary.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) setQuery(q);
  }, []);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => load(query), 200);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query, load]);

  async function handleSave() {
    if (!extracted?.name?.trim()) return;
    setSaving(true);
    Swal.fire({
      title: "Saving Contact...",
      html: `<p style="font-size:0.875rem;color:#6b7280">Adding <strong>${extracted.name}</strong> to your network</p>`,
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => Swal.showLoading(),
    });
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(extracted),
      });
      if (res.ok) {
        const contact = (await res.json()) as { id: string };
        if (story.trim()) {
          await fetch(`/api/contacts/${contact.id}/notes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: story, source: "story" }),
          });
        }
        Swal.fire({
          icon: "success",
          title: "Contact Saved!",
          html: `<p style="font-size:0.875rem;color:#6b7280"><strong>${extracted.name}</strong> has been added to your network.</p>`,
          timer: 2000,
          timerProgressBar: true,
          showConfirmButton: false,
        });
        resetForm();
        setShowForm(false);
        setQuery("");
      } else {
        Swal.fire({
          icon: "error",
          title: "Save Failed",
          text: "Something went wrong. Please try again.",
        });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <Link
        href="/dashboard"
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition-colors hover:text-indigo-600"
      >
        <span aria-hidden>←</span> Back to dashboard
      </Link>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
          <p className="text-sm text-zinc-500">
            Your professional network, enriched with AI.
          </p>
        </div>
        <button
          onClick={() => {
            if (showForm) resetForm();
            setShowForm((s) => !s);
          }}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
        >
          {showForm ? "Cancel" : "+ Add contact"}
        </button>
      </div>

      {showForm && (
        <div className="mb-6 space-y-4 rounded-xl border border-indigo-200 bg-indigo-50/50 p-5">
          <h2 className="text-sm font-semibold text-indigo-900">
            ✨ Add contact
          </h2>

          {/* Claude-style composer: photo thumbnails + textarea, with a toolbar
              (attach menu, mic, send) docked along the bottom edge. */}
          <div className="rounded-2xl border border-zinc-300 bg-white shadow-sm transition focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100">
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 p-3 pb-0">
                {attachments.map((a, i) => (
                  <div key={i} className="group relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={a.url}
                      alt={a.name}
                      className="h-16 w-16 rounded-lg border border-zinc-200 object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeAttachment(i)}
                      title="Remove image"
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-700 text-[10px] leading-none text-white shadow transition-colors hover:bg-red-500"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            {extracting ? (
              <div
                className="w-full overflow-auto px-4 pt-3 text-sm"
                style={{ minHeight: "5rem", lineHeight: "1.6", whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                aria-live="polite"
              >
                {storyTokens.map((token, idx) => {
                  const wIdx = tokenWordIndices[idx];
                  if (wIdx === -1) return <span key={idx}>{token}</span>;
                  const active = wIdx === scanIndex;
                  return (
                    <span
                      key={idx}
                      style={{
                        backgroundColor: active ? "rgba(99,102,241,0.15)" : undefined,
                        color: active ? "rgb(79,70,229)" : undefined,
                        fontWeight: active ? 600 : undefined,
                        borderRadius: "3px",
                        transition: "background-color 0.08s, color 0.08s",
                      }}
                    >
                      {token}
                    </span>
                  );
                })}
              </div>
            ) : (
              <textarea
                value={story}
                onChange={(e) => setStory(e.target.value)}
                placeholder="Tell me about this person — how you met, what they do, where they work…"
                rows={3}
                className="block w-full resize-none border-0 bg-transparent px-4 pt-3 text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:ring-0"
              />
            )}

            {/* Toolbar: + attach · mic · (clear) · send */}
            <div className="flex items-center gap-1 px-2.5 pb-2.5 pt-1">
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setMenuOpen((o) => !o)}
                  disabled={extracting}
                  title="Add photos & files"
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-300 text-xl leading-none text-zinc-500 transition-colors hover:bg-zinc-50 disabled:opacity-40"
                >
                  +
                </button>
                {menuOpen && (
                  <div className="absolute bottom-10 left-0 z-10 w-52 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg">
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        fileInputRef.current?.click();
                      }}
                      disabled={attachments.length >= MAX_ATTACHMENTS}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-40"
                    >
                      <span aria-hidden>📎</span> Add photos &amp; files
                    </button>
                    <button
                      type="button"
                      onClick={openCamera}
                      disabled={attachments.length >= MAX_ATTACHMENTS}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-40"
                    >
                      <span aria-hidden>📷</span> Take photo
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={toggle}
                disabled={!supported || extracting}
                title={
                  supported
                    ? "Dictate with speech-to-text"
                    : "Speech recognition not supported in this browser (try Chrome)"
                }
                className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors ${
                  listening
                    ? "bg-red-600 text-white"
                    : "text-zinc-500 hover:bg-zinc-100 disabled:opacity-40"
                }`}
              >
                {listening ? "● Listening… stop" : "🎤"}
              </button>

              <div className="ml-auto flex items-center gap-2">
                {!extracting && (story.trim() || attachments.length > 0 || extracted) && (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="rounded-full px-2.5 py-1 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100"
                  >
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => (extracted ? setShowReExtractConfirm(true) : handleExtract())}
                  disabled={extracting || (!story.trim() && attachments.length === 0)}
                  title={extracted ? "Re-extract" : "Extract contact details"}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-600 text-white transition-colors hover:bg-indigo-700 disabled:opacity-40"
                >
                  {extracting ? (
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  ) : extracted ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M4 4v5h5M20 20v-5h-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M20 12a8 8 0 0 1-14.93 2.96M4 12a8 8 0 0 1 14.93-2.96" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          <label className="flex items-start gap-2 text-xs text-zinc-600">
            <input
              type="checkbox"
              checked={enrich}
              onChange={(e) => setEnrich(e.target.checked)}
              className="mt-0.5 accent-indigo-600"
            />
            <span>
              <span className="font-medium text-zinc-700">
                🌐 Enrich from the web
              </span>
              <span className="block text-zinc-400">
                Searches the public web for this person (works for anyone with a
                public footprint) and adds cited details — role, bio, interests.
                May be outdated; verify before trusting. Never collects private
                email, phone, or home address.
              </span>
            </span>
          </label>

          {extractError && (
            <p className="text-xs text-red-600">{extractError}</p>
          )}

          {extracted && (
            <ExtractedCard
              extracted={extracted}
              enrichedKeys={enrichedKeys}
              enrichedContact={enrichedContact}
              enrichedContactSources={enrichedContactSources}
              sources={sources}
              onUpdate={setExtracted}
            />
          )}

          {extracted && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !extracted.name?.trim()}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save contact"}
            </button>
          )}
        </div>
      )}

      <UpcomingBirthdays contacts={contacts} />

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name, company, title, tag…"
        className="input mb-4 w-full"
      />

      {loading ? (
        <p className="py-12 text-center text-sm text-zinc-400">Loading…</p>
      ) : loadError && contacts.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-red-600">
            Couldn&apos;t load contacts — check your connection.
          </p>
          <button
            onClick={() => load(query)}
            className="mt-2 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
          >
            Retry
          </button>
        </div>
      ) : contacts.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-400">
          {query
            ? "No contacts match your search."
            : "No contacts yet. Add your first one above."}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {contacts.map((c) => (
            <li key={c.id}>
              <Link
                href={`/contacts/${c.id}`}
                className="block rounded-xl border border-zinc-200 bg-white p-4 transition-shadow hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{c.name}</p>
                    <p className="text-sm text-zinc-500">
                      {[c.title, c.company].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                  {c.profile && (
                    <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">
                      AI profile
                    </span>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {(c.tags || "")
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean)
                    .map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600"
                      >
                        {t}
                      </span>
                    ))}
                  {c._count && (
                    <span className="ml-auto text-xs text-zinc-400">
                      {c._count.notes} note{c._count.notes === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
                {c.healthScore != null && c.healthTier && (
                  <span className="flex items-center gap-1 text-xs text-gray-500">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${TIER_DOT[c.healthTier] ?? "bg-gray-400"}`}
                    />
                    <span className="font-medium">{c.healthTier}</span>
                    <span className="text-gray-400">({c.healthScore})</span>
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {!loading && hasMore && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}

      {/* Extraction success toast */}
      {showExtractToast && (
        <div className="toast-enter pointer-events-none fixed inset-x-0 top-5 z-50 flex justify-center px-4">
          <div
            className="relative flex w-full max-w-sm items-start gap-3.5 rounded-2xl border border-indigo-100 bg-white p-4 pb-5"
            style={{ boxShadow: "0 12px 40px -8px rgba(99,102,241,0.28), 0 4px 16px -4px rgba(0,0,0,0.10)" }}
          >
            {/* Check icon */}
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-600">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M5 13l4 4L19 7" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="flex-1 pt-0.5">
              <p className="text-sm font-semibold text-zinc-900">Extraction complete!</p>
              <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
                Review the extracted fields below and fill in anything that&apos;s missing before saving.
              </p>
              {inputTruncated && (
                <p className="mt-1.5 text-xs leading-relaxed text-amber-600">
                  Your text was long, so only the beginning was analyzed. Double-check nothing important was missed.
                </p>
              )}
            </div>
            {/* Progress bar */}
            <div className="absolute inset-x-4 bottom-0 h-0.5 overflow-hidden rounded-full">
              <div
                className="h-full bg-indigo-400 rounded-full"
                style={{ animation: "toast-bar-shrink 4s linear forwards", transformOrigin: "left" }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Re-extract confirmation modal */}
      {showReExtractConfirm && (
        <div
          className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(15, 15, 30, 0.55)", backdropFilter: "blur(6px)" }}
          onClick={() => setShowReExtractConfirm(false)}
        >
          <div
            className="modal-card w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            style={{ boxShadow: "0 24px 64px -12px rgba(99,102,241,0.22), 0 8px 24px -4px rgba(0,0,0,0.12)" }}
          >
            {/* Icon */}
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 4v5h5M20 20v-5h-5" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M20 12a8 8 0 0 1-14.93 2.96M4 12a8 8 0 0 1 14.93-2.96" stroke="#6366f1" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>

            {/* Heading */}
            <h2 className="mb-1 text-base font-semibold text-zinc-900">Re-extract contact info?</h2>
            <p className="mb-5 text-sm leading-relaxed text-zinc-500">
              This will overwrite your currently extracted details. Any edits you&apos;ve made will be lost.
            </p>

            {/* Actions */}
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setShowReExtractConfirm(false)}
                className="flex-1 rounded-lg border border-zinc-200 bg-white py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowReExtractConfirm(false);
                  handleExtract();
                }}
                className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
              >
                Yes, re-extract
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Camera capture modal */}
      {cameraOpen && (
        <div
          className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(15, 15, 30, 0.7)", backdropFilter: "blur(6px)" }}
          onClick={() => setCameraOpen(false)}
        >
          <div
            className="modal-card w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            style={{ boxShadow: "0 24px 64px -12px rgba(99,102,241,0.22), 0 8px 24px -4px rgba(0,0,0,0.12)" }}
          >
            <div className="relative aspect-[4/3] w-full bg-black">
              {cameraError ? (
                <div className="flex h-full items-center justify-center p-6 text-center text-sm text-zinc-300">
                  {cameraError}
                </div>
              ) : (
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className="h-full w-full object-cover"
                />
              )}
            </div>
            <div className="flex items-center justify-between gap-3 p-4">
              <button
                type="button"
                onClick={() => setCameraOpen(false)}
                className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={capturePhoto}
                disabled={!!cameraError}
                className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-40"
              >
                <span aria-hidden>📷</span> Capture
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Extracted fields card ───────────────────────────────────────────────────

const FIELD_DEFS: {
  key: keyof ContactInput;
  label: string;
  multiline?: boolean;
  isTags?: boolean;
  placeholder?: string;
}[] = [
  { key: "title", label: "Title" },
  { key: "company", label: "Company" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "location", label: "Location" },
  { key: "tags", label: "Tags", isTags: true },
  { key: "howWeMet", label: "How we met", multiline: true },
  { key: "birthday", label: "Birthday", placeholder: "MM-DD or MM-DD-YYYY" },
];

function ExtractedCard({
  extracted,
  enrichedKeys = [],
  enrichedContact = [],
  enrichedContactSources = {},
  sources = [],
  onUpdate,
}: {
  extracted: ContactInput;
  enrichedKeys?: string[];
  enrichedContact?: string[];
  enrichedContactSources?: Record<string, string>;
  sources?: { title: string; url: string }[];
  onUpdate: (updated: ContactInput) => void;
}) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [showMissing, setShowMissing] = useState(false);

  function updateField(key: keyof ContactInput, value: string) {
    onUpdate({ ...extracted, [key]: value });
  }

  function updateCustomField(key: string, value: string) {
    onUpdate({
      ...extracted,
      customFields: { ...(extracted.customFields ?? {}), [key]: value },
    });
  }

  function removeCustomField(key: string) {
    const next = { ...(extracted.customFields ?? {}) };
    delete next[key];
    onUpdate({
      ...extracted,
      customFields: Object.keys(next).length > 0 ? next : undefined,
    });
  }

  const missingFields = FIELD_DEFS.filter((f) => !extracted[f.key]);
  const customEntries = Object.entries(extracted.customFields ?? {});
  const enrichedSet = new Set(enrichedKeys);
  const detectedEntries = customEntries.filter(([k]) => !enrichedSet.has(k));
  const enrichedEntries = customEntries.filter(([k]) => enrichedSet.has(k));

  const renderCustomRow = ([key, value]: [string, string]) => (
    <div key={key} className="flex items-start gap-1.5">
      <div className="flex-1">
        <FieldRow
          label={key}
          value={value}
          isEditing={editingField === `custom:${key}`}
          multiline={value.length > 60}
          onStartEdit={() => setEditingField(`custom:${key}`)}
          onCommit={(v) => {
            updateCustomField(key, v);
            setEditingField(null);
          }}
        />
      </div>
      <button
        type="button"
        onClick={() => removeCustomField(key)}
        title="Remove this field"
        className="mt-5 shrink-0 text-zinc-300 hover:text-red-400 transition-colors text-xs leading-none px-1"
      >
        ✕
      </button>
    </div>
  );

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 space-y-3">
      <FieldRow
        label="Name *"
        value={extracted.name ?? ""}
        isRequired
        isEditing={editingField === "name"}
        onStartEdit={() => setEditingField("name")}
        onCommit={(v) => {
          updateField("name", v);
          setEditingField(null);
        }}
      />

      {FIELD_DEFS.map((f) => {
        const hasValue = Boolean(extracted[f.key]);
        if (!hasValue && !showMissing) return null;
        return (
          <FieldRow
            key={f.key}
            label={f.label}
            value={(extracted[f.key] as string) ?? ""}
            isEditing={editingField === f.key}
            multiline={f.multiline}
            isTags={f.isTags}
            placeholder={f.placeholder}
            fromWeb={enrichedContact.includes(f.key)}
            fromWebUrl={enrichedContactSources[f.key as string]}
            onStartEdit={() => setEditingField(f.key)}
            onCommit={(v) => {
              updateField(f.key, v);
              setEditingField(null);
            }}
          />
        );
      })}

      {missingFields.length > 0 && (
        <button
          type="button"
          onClick={() => setShowMissing((s) => !s)}
          className="text-xs text-indigo-600 hover:underline"
        >
          {showMissing
            ? "− Hide empty fields"
            : `+ Add missing fields (${missingFields.length})`}
        </button>
      )}

      {detectedEntries.length > 0 && (
        <div className="pt-3 border-t border-zinc-100 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-400">
            ✦ AI-detected
          </p>
          {detectedEntries.map(renderCustomRow)}
        </div>
      )}

      {enrichedEntries.length > 0 && (
        <div className="pt-3 border-t border-amber-100 space-y-3 -mx-4 -mb-4 mt-3 rounded-b-lg bg-amber-50/60 px-4 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">
              🌐 Enriched from public knowledge
            </p>
            <p className="mt-0.5 text-[11px] text-amber-700/80">
              Pulled from the public web — may be outdated or wrong. Verify
              before saving; remove any you don&apos;t want.
            </p>
          </div>
          {enrichedEntries.map(renderCustomRow)}

          {sources.length > 0 && (
            <div className="pt-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-600/80">
                Sources
              </p>
              <ul className="mt-1 space-y-0.5">
                {sources.map((s) => (
                  <li key={s.url} className="truncate text-[11px]">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-amber-700 underline hover:text-amber-900"
                    >
                      {s.title || s.url}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Contacts with a birthday in the next 30 days, soonest first. Uses the shared
// birthday helper so the stored canonical format ("YYYY-MM-DD" / "--MM-DD") and
// custom-field fallbacks are handled consistently with the dashboard.
function UpcomingBirthdays({ contacts }: { contacts: Contact[] }) {
  const upcoming = computeUpcomingBirthdays(contacts, 30);
  if (upcoming.length === 0) return null;

  return (
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
      <h2 className="mb-3 text-sm font-semibold text-amber-900">
        🎂 Upcoming birthdays
      </h2>
      <ul className="space-y-2">
        {upcoming.map(({ contact, daysUntil }) => (
          <li key={contact.id} className="flex items-center justify-between gap-2">
            <Link
              href={`/contacts/${contact.id}`}
              className="text-sm font-medium text-zinc-700 hover:text-indigo-600 truncate"
            >
              {contact.name}
            </Link>
            <span className="shrink-0 text-xs text-amber-700">
              {daysUntil === 0
                ? "Today 🎉"
                : daysUntil === 1
                ? "Tomorrow"
                : `in ${daysUntil} days`}
              {" · "}
              {formatBirthday(contact.birthday)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FieldRow({
  label,
  value,
  isRequired,
  isEditing,
  multiline,
  isTags,
  placeholder,
  fromWeb,
  fromWebUrl,
  onStartEdit,
  onCommit,
}: {
  label: string;
  value: string;
  isRequired?: boolean;
  isEditing: boolean;
  multiline?: boolean;
  isTags?: boolean;
  placeholder?: string;
  fromWeb?: boolean;
  fromWebUrl?: string;
  onStartEdit: () => void;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const escapedRef = useRef(false);
  useEffect(() => setDraft(value), [value]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !multiline) onCommit(draft);
    if (e.key === "Escape") {
      escapedRef.current = true;
      onCommit(value);
    }
  }

  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-400">
        {label}
        {fromWeb &&
          (fromWebUrl ? (
            <a
              href={fromWebUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              title={`Found on the web — open the source to verify (${fromWebUrl})`}
              className="inline-flex items-center gap-0.5 rounded-full bg-green-100 px-1.5 py-0.5 text-[9px] font-semibold text-green-700 normal-case tracking-normal transition-colors hover:bg-green-200"
            >
              🌐 web · verify ↗
            </a>
          ) : (
            <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[9px] font-semibold text-green-700">
              🌐 web · verify
            </span>
          ))}
      </dt>
      {isEditing ? (
        multiline ? (
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => { if (!escapedRef.current) onCommit(draft); escapedRef.current = false; }}
            onKeyDown={handleKeyDown}
            rows={2}
            className="input mt-1 w-full resize-y"
          />
        ) : (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => { if (!escapedRef.current) onCommit(draft); escapedRef.current = false; }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="input mt-1 w-full"
          />
        )
      ) : (
        <div
          role="button"
          onClick={onStartEdit}
          className="group mt-1 flex cursor-text items-center justify-between rounded px-1 py-0.5 hover:bg-zinc-50"
        >
          {isTags && value ? (
            <div className="flex flex-wrap gap-1">
              {value
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean)
                .map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600"
                  >
                    {t}
                  </span>
                ))}
            </div>
          ) : value ? (
            <span className="text-sm text-zinc-700">{value}</span>
          ) : (
            <span
              className={`text-sm italic ${
                isRequired ? "text-red-400" : "text-zinc-400"
              }`}
            >
              {isRequired ? "Not found — tap to add" : "—"}
            </span>
          )}
          <span className="ml-2 text-xs text-zinc-300 opacity-0 transition-opacity group-hover:opacity-100">
            ✎
          </span>
        </div>
      )}
    </div>
  );
}
