"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Swal from "sweetalert2";
import type { Contact, ContactInput } from "@/lib/types";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { computeUpcomingBirthdays, formatBirthday } from "@/lib/birthdays";
import { fileToDataUrl, MAX_IMAGE_DIM, MAX_NOTE_IMAGES } from "@/lib/image";
import { resolveSocial } from "@/lib/socials";

const TIER_DOT: Record<string, string> = {
  Strong: "bg-green-500",
  Active: "bg-blue-500",
  Fading: "bg-amber-500",
  Dormant: "bg-gray-400",
};

// How many photos the composer accepts per contact.
const MAX_ATTACHMENTS = 4;

// Cap on photos archived in the immutable creation source (Contact.sourceImages).
// Mirrors LIMITS.sourceImageCount server-side; more generous than a single note
// because the add flow can span several messages.
const MAX_SOURCE_IMAGES = 10;

type Attachment = { name: string; url: string };

// Single-value standard fields we gap-fill when merging into an existing
// contact: only filled when the existing value is empty, never overwritten.
const MERGE_FILL_FIELDS = [
  "email",
  "phone",
  "company",
  "title",
  "location",
  "birthday",
  "howWeMet",
] as const;

const splitTags = (s: string | null | undefined) =>
  (s ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

// Build a non-destructive merge patch: gap-fill empty standard fields, union
// tags (case-insensitively, preserving the existing order), and add new
// custom-field keys without clobbering existing ones. The returned patch only
// carries fields that actually change (plus `name`, which the API requires).
function buildMergePatch(
  existing: Contact,
  incoming: ContactInput
): ContactInput {
  const patch: ContactInput = { name: existing.name };

  for (const f of MERGE_FILL_FIELDS) {
    const next = incoming[f]?.trim();
    if (next && !existing[f]?.trim()) patch[f] = next;
  }

  if (incoming.tags?.trim()) {
    const have = splitTags(existing.tags);
    const seen = new Set(have.map((t) => t.toLowerCase()));
    const merged = [...have];
    for (const t of splitTags(incoming.tags)) {
      if (!seen.has(t.toLowerCase())) {
        seen.add(t.toLowerCase());
        merged.push(t);
      }
    }
    if (merged.length > have.length) patch.tags = merged.join(", ");
  }

  if (incoming.customFields) {
    const cur = existing.customFields ?? {};
    const adders: Record<string, string> = {};
    for (const [k, v] of Object.entries(incoming.customFields)) {
      if (!(k in cur) && v?.trim()) adders[k] = v;
    }
    if (Object.keys(adders).length > 0) {
      patch.customFields = { ...cur, ...adders };
    }
  }

  return patch;
}

// Bucket contacts into A–Z sections for the contacts grid. Names that don't
// start with a letter fall under "#". Aggregates by letter (not by adjacency)
// so each letter is a single, unique section regardless of input order — this
// avoids duplicate React keys if the list is briefly not fully name-sorted.
function groupByInitial(contacts: Contact[]): { letter: string; items: Contact[] }[] {
  const byLetter = new Map<string, Contact[]>();
  for (const c of contacts) {
    const first = (c.name?.trim()?.[0] ?? "#").toUpperCase();
    const letter = /[A-Z]/.test(first) ? first : "#";
    const items = byLetter.get(letter);
    if (items) items.push(c);
    else byLetter.set(letter, [c]);
  }
  return [...byLetter.entries()]
    .sort(([a], [b]) => (a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b)))
    .map(([letter, items]) => ({ letter, items }));
}

// How the contacts list is ordered. Persisted per browser so the choice sticks
// across visits, and shared with the sidebar via a custom event (see below).
type SortMode = "name" | "recent";
const SORT_KEY = "networky:contacts-sort";
const SORT_EVENT = "networky:contacts-sort-change";
// Fired after a contact is created/merged so other views (e.g. the sidebar)
// can refetch even when the route doesn't change. The sidebar listens for it.
const CONTACTS_CHANGED_EVENT = "networky:contacts-changed";

function ContactCard({ c }: { c: Contact }) {
  return (
    <Link
      href={`/contacts/${c.id}`}
      className="block rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 transition-shadow hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{c.name}</p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {[c.title, c.company].filter(Boolean).join(" · ") || "—"}
          </p>
        </div>
        {c.profile && (
          <span className="shrink-0 rounded-full bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 text-xs font-medium text-indigo-600 dark:text-indigo-400">
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
              className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs text-zinc-600 dark:text-zinc-300"
            >
              {t}
            </span>
          ))}
        {c._count && (
          <span className="ml-auto text-xs text-zinc-400 dark:text-zinc-500">
            {c._count.notes} note{c._count.notes === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {c.healthScore != null && c.healthTier && (
        <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-zinc-400">
          <span
            className={`inline-block h-2 w-2 rounded-full ${TIER_DOT[c.healthTier] ?? "bg-gray-400"}`}
          />
          <span className="font-medium">{c.healthTier}</span>
          <span className="text-gray-400 dark:text-zinc-500">({c.healthScore})</span>
        </span>
      )}
    </Link>
  );
}

export default function HomePage() {
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("name");
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
  const [sources, setSources] = useState<{ title: string; url: string }[]>([]);
  // The composer runs as a chat session: each story you send becomes a bubble
  // in this thread, and the whole thread is re-analyzed on every send so the
  // contact refines as you keep adding details.
  const [messages, setMessages] = useState<{ text: string; attachments: Attachment[] }[]>([]);
  const [showExtractToast, setShowExtractToast] = useState(false);
  // Final review modal shown before a contact is actually saved.
  const [showSaveReview, setShowSaveReview] = useState(false);
  const [inputTruncated, setInputTruncated] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Composer attachments (photos) + the "+" attach menu.
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Upload a pre-recorded audio file → server-side transcript → composer. Lets
  // you dictate offline on a phone recorder and add the contact later online.
  const audioInputRef = useRef<HTMLInputElement>(null);
  const [transcribing, setTranscribing] = useState(false);

  // Live-camera capture ("Take photo").
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Word-scanning animation state. While analyzing, scan the words of the
  // message that was just sent (it's left the composer and is now a bubble).
  const [scanIndex, setScanIndex] = useState(0);
  const scanText =
    extracting && messages.length > 0 ? messages[messages.length - 1].text : story;
  const storyTokens = useMemo(() => scanText.split(/(\s+)/).filter(Boolean), [scanText]);
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

  // Transcribe an uploaded recording and append the text to the composer, the
  // same place live dictation lands — then you review and send as usual.
  async function handleAudioFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setMenuOpen(false);
    setExtractError(null);
    setTranscribing(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "" }));
        setExtractError(
          error ||
            (res.status === 429
              ? "You're going a bit fast — please wait a moment and try again."
              : "Couldn't transcribe that recording — try again.")
        );
        return;
      }
      const { text } = (await res.json()) as { text?: string };
      const transcript = (text ?? "").trim();
      if (!transcript) {
        setExtractError("No speech was detected in that recording.");
        return;
      }
      setStory((t) => (t ? `${t} ${transcript}` : transcript));
    } catch {
      setExtractError("Couldn't transcribe that recording — try again.");
    } finally {
      setTranscribing(false);
    }
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
    const text = story.trim();
    const draftAttachments = attachments;
    if (!text && draftAttachments.length === 0) return;

    // Add this turn to the conversation, clear the composer, then re-analyze
    // the whole thread so the AI has the full context of everything you've sent.
    const thread = [...messages, { text, attachments: draftAttachments }];
    setMessages(thread);
    setStory("");
    setAttachments([]);
    setMenuOpen(false);
    setExtracting(true);
    setExtractError(null);
    try {
      const res = await fetch("/api/contacts/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: thread.map((m) => m.text).filter(Boolean).join("\n\n"),
          enrich,
          images: thread.flatMap((m) => m.attachments.map((a) => a.url)),
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
        sources: srcs,
        truncated,
      } = (await res.json()) as {
        fields: ContactInput;
        enriched?: string[];
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
      setSources(Array.isArray(srcs) ? srcs : []);
      setExtractError(null);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      setShowExtractToast(true);
      toastTimer.current = setTimeout(() => setShowExtractToast(false), 4000);
    } finally {
      setExtracting(false);
    }
  }

  function resetForm() {
    setStory("");
    setMessages([]);
    setExtracted(null);
    setExtractError(null);
    setEnrichedKeys([]);
    setSources([]);
    setInputTruncated(false);
    setAttachments([]);
    setMenuOpen(false);
    setShowSaveReview(false);
  }

  // One page of the grid. Search runs server-side via `q`; results are paged.
  const PAGE_SIZE = 24;

  const fetchPage = useCallback(
    async (q: string, offset: number) => {
      const res = await fetch(
        `/api/contacts?q=${encodeURIComponent(q)}&sort=${sort}&limit=${PAGE_SIZE}&offset=${offset}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Contact[];
      const more = res.headers.get("X-Has-More") === "true";
      return { data, more };
    },
    [sort]
  );

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

  // Restore the saved sort preference on mount.
  useEffect(() => {
    const saved = localStorage.getItem(SORT_KEY);
    if (saved === "name" || saved === "recent") setSort(saved);
  }, []);

  // Persist the choice and tell the sidebar so the two views stay in sync.
  function changeSort(next: SortMode) {
    setSort(next);
    localStorage.setItem(SORT_KEY, next);
    window.dispatchEvent(new CustomEvent(SORT_EVENT, { detail: next }));
  }

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => load(query), 200);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query, load]);

  // Reconstruct the full creation input from the chat-style composer: it moves
  // every sent message into `messages` and clears `story`, so the raw record is
  // the whole thread (plus any text/photos typed but never sent). Text is capped
  // to the server's noteContent/sourceText limit; images are returned uncapped
  // and each caller slices to its own limit.
  function buildRawSource() {
    const text = [...messages.map((m) => m.text), story]
      .map((t) => t.trim())
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 20000);
    const images = [
      ...messages.flatMap((m) => m.attachments.map((a) => a.url)),
      ...attachments.map((a) => a.url),
    ];
    return { text, images };
  }

  // Preserve the creation conversation as an editable note, so each contact
  // keeps a working record of what it was created from. Stays "story"-sourced so
  // it gets the 📖 badge in the notes list.
  async function attachStoryNote(contactId: string) {
    const { text, images } = buildRawSource();
    const noteImages = images.slice(0, MAX_NOTE_IMAGES);
    if (!text && noteImages.length === 0) return;
    await fetch(`/api/contacts/${contactId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text, source: "story", images: noteImages }),
    });
  }

  // Create a brand-new contact (the original save path).
  async function createNewContact(input: ContactInput) {
    Swal.fire({
      title: "Saving Contact...",
      html: `<p style="font-size:0.875rem;color:#6b7280">Adding <strong>${input.name}</strong> to your network</p>`,
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => Swal.showLoading(),
    });
    // Archive the original input on the contact itself (immutable), alongside
    // the editable story note. This is the safety net for a future
    // re-analyze/reset — it survives even if the note is edited or deleted.
    const { text: sourceText, images } = buildRawSource();
    const res = await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...input,
        sourceText: sourceText || undefined,
        sourceImages: images.slice(0, MAX_SOURCE_IMAGES),
      }),
    });
    if (!res.ok) throw new Error(`POST /api/contacts ${res.status}`);
    const contact = (await res.json()) as { id: string };
    await attachStoryNote(contact.id);
    Swal.fire({
      icon: "success",
      title: "Contact Saved!",
      html: `<p style="font-size:0.875rem;color:#6b7280"><strong>${input.name}</strong> has been added to your network.</p>`,
      timer: 2000,
      timerProgressBar: true,
      showConfirmButton: false,
    });
    resetForm();
    setShowForm(false);
    // Clear any active search and force a reload so the new contact shows up
    // immediately. setQuery("") alone is a no-op when the box is already empty,
    // so the debounced load wouldn't re-fire — reload explicitly.
    setQuery("");
    await load("");
    // Tell the sidebar (which only refetches on navigation) to refresh too,
    // since creating a contact keeps us on the same route.
    window.dispatchEvent(new CustomEvent(CONTACTS_CHANGED_EVENT));
  }

  // Non-destructively merge the extracted details into an existing contact,
  // then open that contact.
  async function mergeIntoExisting(existing: Contact, input: ContactInput) {
    Swal.fire({
      title: "Merging...",
      html: `<p style="font-size:0.875rem;color:#6b7280">Updating <strong>${existing.name}</strong></p>`,
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => Swal.showLoading(),
    });
    const patch = buildMergePatch(existing, input);
    const res = await fetch(`/api/contacts/${existing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`PATCH /api/contacts ${res.status}`);
    await attachStoryNote(existing.id);
    resetForm();
    setShowForm(false);
    router.push(`/contacts/${existing.id}`);
  }

  async function handleSave() {
    if (!extracted?.name?.trim()) return;
    const input = extracted;
    setSaving(true);
    try {
      // Look for likely duplicates (case-insensitive exact name/email) before
      // creating a new record. A failed check shouldn't block saving.
      const params = new URLSearchParams({ name: input.name.trim() });
      if (input.email?.trim()) params.set("email", input.email.trim());
      let dupes: Contact[] = [];
      try {
        const checkRes = await fetch(`/api/contacts/check?${params}`);
        if (checkRes.ok) dupes = (await checkRes.json()) as Contact[];
      } catch {
        /* network blip on the check — fall through to a normal create */
      }

      if (dupes.length > 0) {
        const existing = dupes[0];
        const subtitle = [existing.title, existing.company]
          .filter(Boolean)
          .join(" · ");
        const choice = await Swal.fire({
          icon: "question",
          title: "Possible duplicate",
          html: `<p style="font-size:0.875rem;color:#6b7280">A contact named <strong>${existing.name}</strong>${
            subtitle ? ` (${subtitle})` : ""
          } already exists. Merge the new details into it, or save as a separate contact?</p>`,
          showDenyButton: true,
          showCancelButton: true,
          confirmButtonText: "Merge",
          denyButtonText: "Save as new",
          cancelButtonText: "Cancel",
          confirmButtonColor: "#4f46e5",
          denyButtonColor: "#52525b",
        });
        if (choice.isConfirmed) {
          await mergeIntoExisting(existing, input);
        } else if (choice.isDenied) {
          await createNewContact(input);
        }
        // Cancel/dismiss → leave the form as-is so nothing is lost.
        return;
      }

      await createNewContact(input);
    } catch {
      Swal.fire({
        icon: "error",
        title: "Save Failed",
        text: "Something went wrong. Please try again.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <Link
        href="/dashboard"
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 dark:text-zinc-400 transition-colors hover:text-indigo-600"
      >
        <span aria-hidden>←</span> Back to dashboard
      </Link>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
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
        <div className="mb-6 space-y-4 rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/50 dark:bg-indigo-950/30 p-5">
          <h2 className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">
            ✨ Add contact
          </h2>

          {/* Sent messages — each story you send becomes a bubble here, above
              the composer. The extracted result card renders below the input. */}
          {(messages.length > 0 || extracting) && (
            <div className="space-y-3">
              {messages.map((m, i) => (
                <div key={i} className="flex justify-end">
                  <div className="flex max-w-[85%] flex-col gap-2 rounded-2xl rounded-br-md bg-indigo-600 px-4 py-3 text-sm text-white shadow-sm">
                    {m.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {m.attachments.map((a, j) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={j}
                            src={a.url}
                            alt={a.name}
                            className="h-12 w-12 rounded-md object-cover ring-1 ring-white/30"
                          />
                        ))}
                      </div>
                    )}
                    {m.text ? (
                      <p className="whitespace-pre-wrap break-words leading-relaxed">
                        {m.text}
                      </p>
                    ) : (
                      <p className="italic text-indigo-100">
                        Sent {m.attachments.length} photo
                        {m.attachments.length === 1 ? "" : "s"}
                      </p>
                    )}
                  </div>
                </div>
              ))}

              {/* Assistant "thinking" — scans your latest message word by word */}
              {extracting && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3 shadow-sm">
                    <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-indigo-600 dark:text-indigo-300">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-600" />
                      Analyzing…
                    </div>
                    <div
                      className="text-sm text-zinc-700 dark:text-zinc-200"
                      style={{ lineHeight: "1.6", whiteSpace: "pre-wrap", wordBreak: "break-word" }}
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
                  </div>
                </div>
              )}
            </div>
          )}

          {extractError && (
            <p className="text-xs text-red-600 dark:text-red-400">{extractError}</p>
          )}

          {/* Claude-style composer: photo thumbnails + textarea, with a toolbar
              (attach menu, mic, send) docked along the bottom edge. Stays open
              the whole session so you can keep sending follow-up messages. */}
          <div className="rounded-2xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-sm transition focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100">
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 p-3 pb-0">
                {attachments.map((a, i) => (
                  <div key={i} className="group relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={a.url}
                      alt={a.name}
                      className="h-16 w-16 rounded-lg border border-zinc-200 dark:border-zinc-800 object-cover"
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

            <textarea
              value={story}
              onChange={(e) => setStory(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleExtract();
                }
              }}
              disabled={extracting || transcribing}
              placeholder={
                transcribing
                  ? "Transcribing your recording…"
                  : messages.length > 0
                  ? "Add more details, or correct something…"
                  : "Tell me about this person — how you met, what they do, where they work…"
              }
              rows={3}
              className="block w-full resize-none border-0 bg-transparent px-4 pt-3 text-sm text-zinc-800 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-0 disabled:opacity-50"
            />

            {/* Toolbar: + attach · mic · (clear) · send */}
            <div className="flex items-center gap-1 px-2.5 pb-2.5 pt-1">
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setMenuOpen((o) => !o)}
                  disabled={extracting || transcribing}
                  title="Add photos & files"
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-300 dark:border-zinc-700 text-xl leading-none text-zinc-500 dark:text-zinc-400 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40"
                >
                  +
                </button>
                {menuOpen && (
                  <div className="absolute bottom-10 left-0 z-10 w-52 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 py-1 shadow-lg">
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        fileInputRef.current?.click();
                      }}
                      disabled={attachments.length >= MAX_ATTACHMENTS}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-zinc-700 dark:text-zinc-200 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40"
                    >
                      <span aria-hidden>📎</span> Add photos &amp; files
                    </button>
                    <button
                      type="button"
                      onClick={openCamera}
                      disabled={attachments.length >= MAX_ATTACHMENTS}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-zinc-700 dark:text-zinc-200 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40"
                    >
                      <span aria-hidden>📷</span> Take photo
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        audioInputRef.current?.click();
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-zinc-700 dark:text-zinc-200 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40"
                    >
                      <span aria-hidden>🎙️</span> Upload recording
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={toggle}
                disabled={!supported || extracting || transcribing}
                title={
                  supported
                    ? "Dictate with speech-to-text"
                    : "Speech recognition not supported in this browser (try Chrome)"
                }
                className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors ${
                  listening
                    ? "bg-red-600 text-white"
                    : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-40"
                }`}
              >
                {listening ? "● Listening… stop" : "🎤"}
              </button>

              {transcribing && (
                <span className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-400/40 border-t-zinc-500" />
                  Transcribing…
                </span>
              )}

              <div className="ml-auto flex items-center gap-2">
                {!extracting &&
                  (story.trim() ||
                    attachments.length > 0 ||
                    messages.length > 0 ||
                    extracted) && (
                    <button
                      type="button"
                      onClick={resetForm}
                      title="Start over — clears the whole conversation"
                      className="rounded-full px-2.5 py-1 text-xs font-medium text-zinc-500 dark:text-zinc-400 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-700"
                    >
                      {messages.length > 0 ? "New" : "Clear"}
                    </button>
                  )}
                <button
                  type="button"
                  onClick={handleExtract}
                  disabled={extracting || transcribing || (!story.trim() && attachments.length === 0)}
                  title={messages.length > 0 ? "Send" : "Analyze story"}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-600 text-white transition-colors hover:bg-indigo-700 disabled:opacity-40"
                >
                  {extracting ? (
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
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
            <input
              ref={audioInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                handleAudioFile(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          <label className="flex items-start gap-2 text-xs text-zinc-600 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={enrich}
              onChange={(e) => setEnrich(e.target.checked)}
              className="mt-0.5 accent-indigo-600"
            />
            <span>
              <span className="font-medium text-zinc-700 dark:text-zinc-200">
                🌐 Enrich from the web
              </span>
              <span className="block text-zinc-400 dark:text-zinc-500">
                Searches the public web for this person (works for anyone with a
                public footprint) and adds cited details — role, bio, interests.
                May be outdated; verify before trusting. Never collects private
                email, phone, or home address.
              </span>
            </span>
          </label>

          {/* Extracted result — renders below the composer */}
          {extracted && !extracting && (
            <div className="space-y-3">
              <ExtractedCard
                extracted={extracted}
                enrichedKeys={enrichedKeys}
                sources={sources}
                onUpdate={setExtracted}
              />
              <button
                type="button"
                onClick={() => setShowSaveReview(true)}
                disabled={saving || !extracted.name?.trim()}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save contact"}
              </button>
            </div>
          )}
        </div>
      )}

      <UpcomingBirthdays contacts={contacts} />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, company, title, tag…"
          className="input w-full"
        />
        <div className="flex shrink-0 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 p-0.5 text-sm">
          {(
            [
              ["name", "A–Z"],
              ["recent", "Recent"],
            ] as [SortMode, string][]
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => changeSort(mode)}
              aria-pressed={sort === mode}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                sort === mode
                  ? "bg-white dark:bg-zinc-900 text-indigo-700 dark:text-indigo-300 shadow-sm"
                  : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="py-12 text-center text-sm text-zinc-400 dark:text-zinc-500">Loading…</p>
      ) : loadError && contacts.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-red-600 dark:text-red-400">
            Couldn&apos;t load contacts — check your connection.
          </p>
          <button
            onClick={() => load(query)}
            className="mt-2 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            Retry
          </button>
        </div>
      ) : contacts.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-400 dark:text-zinc-500">
          {query
            ? "No contacts match your search."
            : "No contacts yet. Add your first one above."}
        </p>
      ) : sort === "name" ? (
        <div className="space-y-6">
          {groupByInitial(contacts).map((group) => (
            <section key={group.letter}>
              <h2 className="mb-2 border-b border-zinc-100 dark:border-zinc-800 pb-1 text-sm font-semibold text-zinc-400 dark:text-zinc-500">
                {group.letter}
              </h2>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {group.items.map((c) => (
                  <li key={c.id}>
                    <ContactCard c={c} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {contacts.map((c) => (
            <li key={c.id}>
              <ContactCard c={c} />
            </li>
          ))}
        </ul>
      )}

      {!loading && hasMore && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}

      {/* Extraction success toast */}
      {showExtractToast && (
        <div className="toast-enter pointer-events-none fixed inset-x-0 top-5 z-50 flex justify-center px-4">
          <div
            className="relative flex w-full max-w-sm items-start gap-3.5 rounded-2xl border border-indigo-100 dark:border-indigo-900/40 bg-white dark:bg-zinc-900 p-4 pb-5"
            style={{ boxShadow: "0 12px 40px -8px rgba(99,102,241,0.28), 0 4px 16px -4px rgba(0,0,0,0.10)" }}
          >
            {/* Check icon */}
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-600">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M5 13l4 4L19 7" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="flex-1 pt-0.5">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Got it!</p>
              <p className="mt-0.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                Review the fields, send another message to add or correct details, or save when it looks right.
              </p>
              {inputTruncated && (
                <p className="mt-1.5 text-xs leading-relaxed text-amber-600 dark:text-amber-400">
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

      {/* Review & confirm modal — final check before the contact is saved */}
      {showSaveReview && extracted && (
        <div
          className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(15, 15, 30, 0.55)", backdropFilter: "blur(6px)" }}
          onClick={() => setShowSaveReview(false)}
        >
          <div
            className="modal-card flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white dark:bg-zinc-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            style={{ boxShadow: "0 24px 64px -12px rgba(99,102,241,0.22), 0 8px 24px -4px rgba(0,0,0,0.12)" }}
          >
            {/* Header */}
            <div className="border-b border-zinc-100 dark:border-zinc-800 px-6 pb-4 pt-6">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                Review &amp; confirm
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                Double-check the details below before adding this contact.
              </p>
            </div>

            {/* Scrollable details */}
            <div className="flex-1 space-y-3.5 overflow-y-auto px-6 py-4">
              {(() => {
                const customEntries = Object.entries(extracted.customFields ?? {});
                return (
                  <>
                    <ReviewRow label="Name" value={extracted.name} />
                    {FIELD_DEFS.map((f) => {
                      const v = extracted[f.key];
                      if (!v || typeof v !== "string") return null;
                      return (
                        <ReviewRow
                          key={f.key}
                          label={f.label}
                          value={v}
                          isTags={f.isTags}
                        />
                      );
                    })}
                    {customEntries.length > 0 && (
                      <div className="space-y-3.5 border-t border-zinc-100 dark:border-zinc-800 pt-3.5">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">
                          ✨ AI-detected
                        </p>
                        {customEntries.map(([k, v]) => (
                          <ReviewRow key={k} label={k} value={String(v)} />
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            {/* Actions */}
            <div className="flex gap-2.5 border-t border-zinc-100 dark:border-zinc-800 px-6 py-4">
              <button
                type="button"
                onClick={() => setShowSaveReview(false)}
                className="flex-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                Go back
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowSaveReview(false);
                  handleSave();
                }}
                disabled={saving || !extracted.name?.trim()}
                className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Confirm & save"}
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
            className="modal-card w-full max-w-md overflow-hidden rounded-2xl bg-white dark:bg-zinc-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            style={{ boxShadow: "0 24px 64px -12px rgba(99,102,241,0.22), 0 8px 24px -4px rgba(0,0,0,0.12)" }}
          >
            <div className="relative aspect-[4/3] w-full bg-black">
              {cameraError ? (
                <div className="flex h-full items-center justify-center p-6 text-center text-sm text-zinc-300 dark:text-zinc-600">
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
                className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800"
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

// A single read-only label/value row in the "Review & confirm" save modal.
function ReviewRow({
  label,
  value,
  isTags = false,
}: {
  label: string;
  value: string;
  isTags?: boolean;
}) {
  const tags = isTags
    ? value
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        {label}
      </p>
      {isTags ? (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span
              key={t}
              className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs text-zinc-700 dark:text-zinc-200"
            >
              {t}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-zinc-800 dark:text-zinc-100">
          {value}
        </p>
      )}
    </div>
  );
}

function ExtractedCard({
  extracted,
  enrichedKeys = [],
  sources = [],
  onUpdate,
}: {
  extracted: ContactInput;
  enrichedKeys?: string[];
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

  const renderCustomRow = ([key, value]: [string, string]) => {
    const social = resolveSocial(key, value);
    return (
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
        {social && editingField !== `custom:${key}` && (
          <a
            href={social.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 inline-flex max-w-full items-center gap-1.5 text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            <span aria-hidden>{social.icon}</span>
            <span className="truncate">{social.url.replace(/^https?:\/\//, "")}</span>
            <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
              ✓ Verified
            </span>
          </a>
        )}
      </div>
      <button
        type="button"
        onClick={() => removeCustomField(key)}
        title="Remove this field"
        className="mt-5 shrink-0 text-zinc-300 dark:text-zinc-600 hover:text-red-400 transition-colors text-xs leading-none px-1"
      >
        ✕
      </button>
    </div>
    );
  };

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
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
          className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          {showMissing
            ? "− Hide empty fields"
            : `+ Add missing fields (${missingFields.length})`}
        </button>
      )}

      {detectedEntries.length > 0 && (
        <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-400 dark:text-indigo-400">
            ✦ AI-detected
          </p>
          {detectedEntries.map(renderCustomRow)}
        </div>
      )}

      {enrichedEntries.length > 0 && (
        <div className="pt-3 border-t border-amber-100 dark:border-amber-900/40 space-y-3 -mx-4 -mb-4 mt-3 rounded-b-lg bg-amber-50/60 dark:bg-amber-950/30 px-4 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
              🌐 Enriched from public knowledge
            </p>
            <p className="mt-0.5 text-[11px] text-amber-700/80 dark:text-amber-300">
              Pulled from the public web — may be outdated or wrong. Verify
              before saving; remove any you don&apos;t want.
            </p>
          </div>
          {enrichedEntries.map(renderCustomRow)}

          {sources.length > 0 && (
            <div className="pt-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-600/80 dark:text-amber-400">
                Sources
              </p>
              <ul className="mt-1 space-y-0.5">
                {sources.map((s) => (
                  <li key={s.url} className="truncate text-[11px]">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-amber-700 dark:text-amber-300 underline hover:text-amber-900"
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
    <div className="mb-4 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-950/30 p-4">
      <h2 className="mb-3 text-sm font-semibold text-amber-900 dark:text-amber-200">
        🎂 Upcoming birthdays
      </h2>
      <ul className="space-y-2">
        {upcoming.map(({ contact, daysUntil }) => (
          <li key={contact.id} className="flex items-center justify-between gap-2">
            <Link
              href={`/contacts/${contact.id}`}
              className="text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:text-indigo-600 truncate"
            >
              {contact.name}
            </Link>
            <span className="shrink-0 text-xs text-amber-700 dark:text-amber-300">
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
      <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        {label}
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
          className="group mt-1 flex cursor-text items-center justify-between rounded px-1 py-0.5 hover:bg-zinc-50 dark:hover:bg-zinc-800"
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
                    className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs text-zinc-600 dark:text-zinc-300"
                  >
                    {t}
                  </span>
                ))}
            </div>
          ) : value ? (
            <span className="text-sm text-zinc-700 dark:text-zinc-200">{value}</span>
          ) : (
            <span
              className={`text-sm italic ${
                isRequired ? "text-red-400 dark:text-red-400" : "text-zinc-400 dark:text-zinc-500"
              }`}
            >
              {isRequired ? "Not found — tap to add" : "—"}
            </span>
          )}
          <span className="ml-2 text-xs text-zinc-300 dark:text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100">
            ✎
          </span>
        </div>
      )}
    </div>
  );
}
