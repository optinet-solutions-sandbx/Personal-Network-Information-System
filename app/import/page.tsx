"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import Swal from "sweetalert2";
import { parseContactsFile } from "@/lib/contact-io";
import type { ContactInput } from "@/lib/types";

type Summary = { received: number; created: number; duplicates: number; invalid: number };

export default function ImportExportPage() {
  const [parsed, setParsed] = useState<ContactInput[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [showAll, setShowAll] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(file: File | null) {
    if (!file) return;
    setSummary(null);
    try {
      const text = await file.text();
      const contacts = parseContactsFile(file.name, text);
      if (contacts.length === 0) {
        await Swal.fire({
          icon: "warning",
          title: "Nothing to import",
          text: "No contacts with a name were found in that file. Make sure there's a 'name' column (CSV) or FN/N (vCard).",
        });
        return;
      }
      setFileName(file.name);
      setParsed(contacts);
      setShowAll(false);
    } catch {
      await Swal.fire({ icon: "error", title: "Couldn't read that file", text: "Try a .csv or .vcf file." });
    }
  }

  async function doImport() {
    if (!parsed) return;
    setImporting(true);
    try {
      const res = await fetch("/api/contacts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contacts: parsed }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        await Swal.fire({ icon: "error", title: "Import failed", text: data?.error || "Please try again." });
        return;
      }
      setSummary(data as Summary);
      setParsed(null);
      setFileName("");
      if (fileRef.current) fileRef.current.value = "";
    } catch {
      await Swal.fire({ icon: "error", title: "Import failed", text: "Please check your connection and try again." });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-5">
        <h1 className="text-2xl font-bold">Import &amp; export</h1>
        <p className="text-sm text-zinc-500">
          Move contacts in and out as CSV or vCard.
        </p>
      </div>

      {/* Export */}
      <section className="mb-5 rounded-xl border border-zinc-200 bg-white p-5">
        <h2 className="mb-1 font-semibold">Export your contacts</h2>
        <p className="mb-3 text-sm text-zinc-500">
          Download every contact you own. CSV opens in Excel/Sheets; vCard imports into phones and other address books.
        </p>
        <div className="flex flex-wrap gap-2">
          <a
            href="/api/contacts/export?format=csv"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            ⬇ Export CSV
          </a>
          <a
            href="/api/contacts/export?format=vcf"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50"
          >
            ⬇ Export vCard
          </a>
        </div>
      </section>

      {/* Import */}
      <section className="rounded-xl border border-zinc-200 bg-white p-5">
        <h2 className="mb-1 font-semibold">Import contacts</h2>
        <p className="mb-3 text-sm text-zinc-500">
          Upload a <span className="font-medium">.csv</span> or <span className="font-medium">.vcf</span> file.
          Unknown CSV columns become custom fields, and contacts that already exist (same name + email) are skipped.
        </p>

        <input
          ref={fileRef}
          type="file"
          accept=".csv,.vcf,.vcard,text/csv,text/vcard"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-zinc-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-indigo-700"
        />

        {parsed && (
          <div className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3">
            <p className="text-sm">
              <span className="font-semibold">{parsed.length}</span> contact
              {parsed.length === 1 ? "" : "s"} found in{" "}
              <span className="font-medium">{fileName}</span>.
            </p>
            <ul className={`mt-2 ${showAll ? "max-h-72" : "max-h-40"} overflow-y-auto text-xs text-zinc-600`}>
              {(showAll ? parsed : parsed.slice(0, 8)).map((c, i) => (
                <li key={i} className="truncate">
                  • {c.name}
                  {c.email ? ` — ${c.email}` : ""}
                  {c.company ? ` · ${c.company}` : ""}
                </li>
              ))}
              {parsed.length > 8 && (
                <li>
                  <button
                    type="button"
                    onClick={() => setShowAll((v) => !v)}
                    className="mt-1 font-medium text-indigo-600 hover:underline"
                  >
                    {showAll ? "Show less" : `…and ${parsed.length - 8} more`}
                  </button>
                </li>
              )}
            </ul>
            <div className="mt-3 flex gap-2">
              <button
                onClick={doImport}
                disabled={importing}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {importing ? "Importing…" : `Import ${parsed.length}`}
              </button>
              <button
                onClick={() => {
                  setParsed(null);
                  setFileName("");
                  if (fileRef.current) fileRef.current.value = "";
                }}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {summary && (
          <div className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
            ✓ Imported <span className="font-semibold">{summary.created}</span> new contact
            {summary.created === 1 ? "" : "s"}.
            {summary.duplicates > 0 && ` Skipped ${summary.duplicates} already-existing.`}
            {summary.invalid > 0 && ` ${summary.invalid} row(s) were invalid and skipped.`}{" "}
            <Link href="/contacts" className="font-medium underline">
              View contacts →
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
