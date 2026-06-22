"use client";
import { useState, useEffect, useCallback } from "react";
import { Markdown } from "@/components/Markdown";
import type { Contact } from "@/lib/types";

type ModalState = "idle" | "loading" | "success" | "error";

export function MeetingBriefingModal({ contact }: { contact: Contact }) {
  const [state, setState] = useState<ModalState>("idle");
  const [briefing, setBriefing] = useState("");

  const generate = useCallback(async () => {
    setState("loading");
    setBriefing("");
    try {
      const res = await fetch(`/api/contacts/${contact.id}/briefing`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { briefing: string };
      setBriefing(data.briefing);
      setState("success");
    } catch {
      setState("error");
    }
  }, [contact.id]);

  const close = useCallback(() => {
    setState("idle");
    setBriefing("");
  }, []);

  useEffect(() => {
    if (state === "idle") return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, close]);

  return (
    <>
      <button
        onClick={generate}
        className="rounded-lg border border-indigo-200 px-3 py-1.5 text-sm text-indigo-700 hover:bg-indigo-50"
      >
        Prepare for meeting
      </button>

      {state !== "idle" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4">
              <h2 className="text-base font-semibold text-zinc-800">
                Meeting Briefing — {contact.name}
              </h2>
              <button
                onClick={close}
                className="text-zinc-400 hover:text-zinc-600"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {state === "loading" && (
                <div className="flex flex-col items-center gap-3 py-12 text-zinc-400">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-600" />
                  <p className="text-sm">Generating briefing…</p>
                </div>
              )}
              {state === "success" && <Markdown content={briefing} />}
              {state === "error" && (
                <div className="flex flex-col items-center gap-3 py-12 text-center">
                  <p className="text-sm text-red-600">
                    Couldn&apos;t generate briefing — the AI service may be
                    unavailable.
                  </p>
                  <button
                    onClick={generate}
                    className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
                  >
                    Try again
                  </button>
                </div>
              )}
            </div>

            {state === "success" && (
              <div className="flex justify-end gap-2 border-t border-zinc-100 px-6 py-3">
                <CopyButton text={briefing} />
                <button
                  onClick={close}
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — user can select text manually
    }
  }

  return (
    <button
      onClick={copy}
      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}
