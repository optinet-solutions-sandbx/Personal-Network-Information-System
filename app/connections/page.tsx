"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Swal from "sweetalert2";

type Provider = {
  id: string;
  label: string;
  authMode: "oauth" | "token";
  configured: boolean;
  connected: boolean;
  accountLabel: string | null;
  status: string | null;
  lastError: string | null;
  lastSyncedAt: string | null;
  connectedAt: string | null;
};

type ApiResponse = { encryptionReady: boolean; providers: Provider[] };

const ERROR_MESSAGES: Record<string, string> = {
  unknown_provider: "That integration isn't available.",
  not_configured: "That integration isn't set up on the server yet.",
  missing_code: "The provider didn't return an authorization code. Please try again.",
  state_mismatch: "Security check failed (state mismatch). Please try connecting again.",
  exchange_failed: "Couldn't complete the connection. Please try again.",
  access_denied: "You declined the connection.",
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function ConnectionsPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null); // provider id mid-action

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/connections");
      if (res.ok) setData((await res.json()) as ApiResponse);
    } finally {
      setLoading(false);
    }
  }, []);

  // Surface the ?connected / ?error result of an OAuth round-trip, then clean
  // the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const error = params.get("error");
    if (connected) {
      Swal.fire({ icon: "success", title: "Connected", text: `${connected} is now connected.`, timer: 2200, showConfirmButton: false });
    } else if (error) {
      Swal.fire({ icon: "error", title: "Couldn't connect", text: ERROR_MESSAGES[error] ?? error });
    }
    if (connected || error) {
      window.history.replaceState({}, "", "/connections");
    }
    void load();
  }, [load]);

  async function connect(p: Provider) {
    if (p.authMode === "token") return connectWithToken(p);
    // OAuth: full-page navigation — the server route sets the state cookie then
    // redirects to the provider's consent screen.
    window.location.href = `/api/connections/${p.id}/authorize`;
  }

  async function connectWithToken(p: Provider) {
    const { value: token } = await Swal.fire({
      title: `Connect ${p.label}`,
      input: "password",
      inputLabel: `Paste your ${p.label} private-app access token`,
      inputPlaceholder: "pat-…",
      inputAttributes: { autocapitalize: "off", autocorrect: "off", spellcheck: "false" },
      showCancelButton: true,
      confirmButtonText: "Connect",
      // Add a Show/Hide toggle so the user can review the pasted token.
      didOpen: () => {
        const input = Swal.getInput();
        if (!input) return;
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.textContent = "Show token";
        toggle.style.cssText =
          "margin-top:8px;background:none;border:none;color:#818cf8;font-size:13px;cursor:pointer;";
        toggle.addEventListener("click", () => {
          const masked = input.type === "password";
          input.type = masked ? "text" : "password";
          toggle.textContent = masked ? "Hide token" : "Show token";
          input.focus();
        });
        input.insertAdjacentElement("afterend", toggle);
      },
      preConfirm: (v) => {
        if (!v || !String(v).trim()) {
          Swal.showValidationMessage("Please paste a token.");
          return false;
        }
        return String(v).trim();
      },
    });
    if (!token) return;

    setBusy(p.id);
    try {
      const res = await fetch(`/api/connections/${p.id}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        await Swal.fire({ icon: "error", title: "Couldn't connect", text: body?.error ?? "Please try again." });
        return;
      }
      await Swal.fire({ icon: "success", title: "Connected", timer: 1800, showConfirmButton: false });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function sync(p: Provider) {
    setBusy(p.id);
    try {
      const res = await fetch(`/api/connections/${p.id}/sync`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        await Swal.fire({ icon: "error", title: "Sync failed", text: body?.error ?? "Please try again." });
        return;
      }
      // Contacts line: always shown. Calendar line: only for calendar-capable
      // providers (Google/Outlook), where the API includes an `events` summary —
      // so the user can see their calendar synced, not just their contacts.
      const contactsLine = `Contacts: <b>${body.created}</b> new · <b>${body.updated}</b> updated · <b>${body.duplicates}</b> skipped${
        body.invalid ? ` · <b>${body.invalid}</b> unusable` : ""
      }`;
      const ev = body.events as
        | { received: number; created: number; updated: number; pruned: number }
        | undefined;
      const calendarLine = ev
        ? ev.received > 0
          ? `📅 Calendar: <b>${ev.received}</b> ${ev.received === 1 ? "event" : "events"} synced`
          : `📅 Calendar: no upcoming events found`
        : null;
      await Swal.fire({
        icon: "success",
        title: "Sync complete",
        html: calendarLine
          ? `<div>${contactsLine}</div><div style="margin-top:6px">${calendarLine}</div>`
          : `${contactsLine}.`,
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(p: Provider) {
    const confirm = await Swal.fire({
      icon: "warning",
      title: `Disconnect ${p.label}?`,
      text: "Contacts already imported stay in your network. You can reconnect anytime.",
      showCancelButton: true,
      confirmButtonText: "Disconnect",
    });
    if (!confirm.isConfirmed) return;
    setBusy(p.id);
    try {
      const res = await fetch(`/api/connections/${p.id}`, { method: "DELETE" });
      if (!res.ok) {
        await Swal.fire({ icon: "error", title: "Couldn't disconnect", text: "Please try again." });
        return;
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-5">
        <h1 className="text-2xl font-bold">Connections</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Link a CRM, address book, or calendar to pull contacts into your network. Google and
          Outlook also sync your calendar to power{" "}
          <Link href="/meetings" className="font-medium underline">
            meeting prep &amp; follow-ups
          </Link>
          . Re-syncing updates what it owns instead of creating duplicates, and connected accounts
          refresh automatically once a day.
        </p>
      </div>

      {data && !data.encryptionReady && (
        <div className="mb-4 rounded-lg border border-amber-300 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-800 dark:text-amber-300">
          Connections are turned off on this server: no token-encryption key is configured. Set{" "}
          <code className="font-mono">CONNECTION_ENC_KEY</code> to enable them.
        </div>
      )}

      {loading && <p className="text-sm text-zinc-500">Loading…</p>}

      <div className="space-y-3">
        {data?.providers.map((p) => (
          <section
            key={p.id}
            className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold">{p.label}</h2>
                  {p.connected ? (
                    <span className="rounded-full bg-emerald-100 dark:bg-emerald-950/50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                      Connected
                    </span>
                  ) : !p.configured ? (
                    <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-500">
                      Not set up
                    </span>
                  ) : null}
                </div>
                {p.connected ? (
                  <>
                    <p className="mt-1 truncate text-sm text-zinc-500 dark:text-zinc-400">
                      {p.accountLabel ?? "Connected"}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
                      Connected {formatDateTime(p.connectedAt)} · last synced{" "}
                      {p.lastSyncedAt ? formatDateTime(p.lastSyncedAt) : "never"}
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                    {!p.configured
                      ? "This integration isn't enabled on the server yet."
                      : p.authMode === "token"
                      ? "Paste a private-app access token to import your contacts."
                      : "Authorize access to import your contacts."}
                  </p>
                )}
                {p.status === "error" && p.lastError && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">⚠ {p.lastError}</p>
                )}
              </div>

              <div className="flex shrink-0 gap-2">
                {p.connected ? (
                  <>
                    <button
                      onClick={() => sync(p)}
                      disabled={busy === p.id}
                      className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {busy === p.id ? "Syncing…" : "Sync now"}
                    </button>
                    <button
                      onClick={() => disconnect(p)}
                      disabled={busy === p.id}
                      className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
                    >
                      Disconnect
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => connect(p)}
                    disabled={!p.configured || busy === p.id}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy === p.id ? "Connecting…" : "Connect"}
                  </button>
                )}
              </div>
            </div>
          </section>
        ))}
      </div>

      <p className="mt-5 text-sm text-zinc-500 dark:text-zinc-400">
        Using LinkedIn? Export your connections to CSV and bring them in from the{" "}
        <Link href="/import" className="font-medium underline">
          Import page
        </Link>
        .
      </p>
    </div>
  );
}
