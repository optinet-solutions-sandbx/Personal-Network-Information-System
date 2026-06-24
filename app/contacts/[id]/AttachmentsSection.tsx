"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Swal from "sweetalert2";
import type { Attachment } from "@/lib/types";
import {
  uploadAttachment,
  isAttachmentStorageConfigured,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_MB,
} from "@/lib/attachments";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function iconFor(mime: string): string {
  if (mime.startsWith("image/")) return "🖼️";
  if (mime === "application/pdf") return "📄";
  if (mime.startsWith("audio/")) return "🎵";
  if (mime.startsWith("video/")) return "🎬";
  if (mime.includes("sheet") || mime.includes("excel") || mime.includes("csv")) return "📊";
  if (mime.includes("word") || mime.includes("document") || mime.startsWith("text/")) return "📝";
  if (mime.includes("zip") || mime.includes("compressed") || mime.includes("tar")) return "🗜️";
  return "📎";
}

// Reusable file-attachments block. As a "card" it's a standalone section for a
// contact's files (noteId omitted); as "inline" it renders compactly inside a
// note (noteId set). Self-fetches its own list and handles upload/download/
// delete against the API.
export function AttachmentsSection({
  contactId,
  noteId,
  variant = "card",
}: {
  contactId: string;
  noteId?: string;
  variant?: "card" | "inline";
}) {
  const configured = isAttachmentStorageConfigured();
  const [items, setItems] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const query = noteId ? `noteId=${encodeURIComponent(noteId)}` : "noteId=null";

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/contacts/${contactId}/attachments?${query}`);
      if (res.ok) setItems(await res.json());
    } catch {
      /* leave the current list in place on a transient failure */
    } finally {
      setLoading(false);
    }
  }, [contactId, query]);

  useEffect(() => {
    if (configured) load();
    else setLoading(false);
  }, [configured, load]);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_ATTACHMENT_BYTES) {
          await Swal.fire({
            icon: "error",
            title: "File too large",
            text: `“${file.name}” exceeds the ${MAX_ATTACHMENT_MB} MB limit.`,
          });
          continue;
        }
        const meta = await uploadAttachment(file, contactId);
        if (!meta) continue; // storage not configured
        const res = await fetch(`/api/contacts/${contactId}/attachments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...meta, noteId: noteId ?? null }),
        });
        if (!res.ok) {
          const { error } = await res.json().catch(() => ({ error: "" }));
          throw new Error(error || "The upload couldn't be saved.");
        }
      }
      await load();
    } catch (err) {
      await Swal.fire({
        icon: "error",
        title: "Couldn't attach file",
        text: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove(att: Attachment) {
    const result = await Swal.fire({
      title: "Delete file?",
      html: `<p style="font-size:0.875rem">Delete <strong>${att.filename}</strong>? This cannot be undone.</p>`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Delete",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#6b7280",
      reverseButtons: true,
    });
    if (!result.isConfirmed) return;
    try {
      const res = await fetch(`/api/attachments/${att.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setItems((prev) => prev.filter((a) => a.id !== att.id));
    } catch {
      await Swal.fire({
        icon: "error",
        title: "Couldn't delete file",
        text: "Please check your connection and try again.",
      });
    }
  }

  const hiddenInput = (
    <input
      ref={inputRef}
      type="file"
      multiple
      className="hidden"
      onChange={(e) => handleFiles(e.target.files)}
    />
  );

  const list = (
    <ul className="space-y-1.5">
      {items.map((att) => (
        <li
          key={att.id}
          className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2.5 py-1.5 text-sm"
        >
          <span aria-hidden>{iconFor(att.mimeType)}</span>
          <a
            href={`/api/attachments/${att.id}`}
            className="min-w-0 flex-1 truncate text-indigo-600 dark:text-indigo-400 hover:underline"
            title={`Download ${att.filename}`}
          >
            {att.filename}
          </a>
          <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">
            {formatBytes(att.size)}
          </span>
          <button
            onClick={() => remove(att)}
            aria-label={`Delete ${att.filename}`}
            className="shrink-0 text-xs text-red-500 dark:text-red-400 hover:underline"
          >
            Delete
          </button>
        </li>
      ))}
    </ul>
  );

  // Inline (per-note) variant: stay out of the way — render nothing when there's
  // nothing to show and uploads aren't available.
  if (variant === "inline") {
    if (!configured && items.length === 0) return null;
    return (
      <div className="mt-2">
        {items.length > 0 && <div className="mb-1.5">{list}</div>}
        {configured && (
          <>
            {hiddenInput}
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50"
            >
              {uploading ? "Uploading…" : "📎 Attach file"}
            </button>
          </>
        )}
      </div>
    );
  }

  // Card (contact-level) variant.
  return (
    <div className="mt-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Files</h2>
        {configured && (
          <>
            {hiddenInput}
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
            >
              {uploading ? "Uploading…" : "📎 Attach file"}
            </button>
          </>
        )}
      </div>
      {!configured ? (
        <p className="text-sm text-zinc-400 dark:text-zinc-500">
          File attachments require Supabase Storage — sign in to enable them.
        </p>
      ) : loading ? (
        <p className="text-sm text-zinc-400 dark:text-zinc-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-zinc-400 dark:text-zinc-500">
          No files yet. Attach PDFs, images, or documents related to this contact.
        </p>
      ) : (
        list
      )}
    </div>
  );
}
