"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type Workspace = {
  id: string;
  name: string;
  type: "personal" | "team";
  role: "owner" | "admin" | "member";
  avatar: string | null;
};

// Square logo for a workspace: its uploaded avatar, or the first letter on an
// indigo tile. `size` controls the box; `text` the fallback letter size.
function WorkspaceLogo({
  workspace,
  className = "h-7 w-7",
  text = "text-xs",
  rounded = "rounded-md",
}: {
  workspace: Pick<Workspace, "name" | "avatar">;
  className?: string;
  text?: string;
  rounded?: string;
}) {
  if (workspace.avatar) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={workspace.avatar}
        alt=""
        className={`${className} ${rounded} flex-shrink-0 object-cover`}
      />
    );
  }
  return (
    <span
      className={`${className} ${rounded} flex flex-shrink-0 items-center justify-center bg-indigo-600 font-semibold text-white ${text}`}
    >
      {workspace.name.trim()[0]?.toUpperCase() ?? "?"}
    </span>
  );
}

// Sidebar workspace switcher (Slack/Linear/Notion style). Lists the workspaces
// the user belongs to, shows the current one, switches between them, and creates
// new team workspaces. Switching POSTs to /api/workspaces/switch (which sets the
// selection cookie) then does a FULL page load to /dashboard — see switchTo for
// why a soft router.refresh() isn't enough.
//
// `collapsed` mirrors ContactsSidebar's rail state: collapsed renders a single
// avatar button, expanded renders the full current-workspace row.
export default function WorkspaceSwitcher({ collapsed }: { collapsed: boolean }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/workspaces")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { workspaces: Workspace[]; currentId: string | null } | null) => {
        if (active && data) {
          setWorkspaces(data.workspaces);
          setCurrentId(data.currentId);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Close on outside click / Escape (mirrors UserMenu in AppShell).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Nothing to show in open mode (no auth) or before the list loads.
  if (workspaces.length === 0) return null;

  const current = workspaces.find((w) => w.id === currentId) ?? workspaces[0];

  async function switchTo(id: string) {
    if (id === currentId || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/workspaces/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: id }),
      });
      if (res.ok) {
        // A full page load (not router.refresh()) is deliberate: refresh only
        // re-fetches server components and leaves CLIENT state intact, so an
        // in-progress contact draft / open form from the previous workspace
        // would bleed into the new one. Reloading to /dashboard wipes all client
        // state, re-reads the selection cookie everywhere, and lands the user on
        // a neutral page that clearly signals the switch.
        window.location.assign("/dashboard");
        return; // navigating away; nothing else to do
      }
    } finally {
      setBusy(false);
    }
  }

  async function createWorkspace(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const ws: Workspace = await res.json();
        setWorkspaces((prev) => [...prev, ws]);
        setNewName("");
        setCreating(false);
        await switchTo(ws.id); // jump into the new workspace immediately
      }
    } finally {
      setBusy(false);
    }
  }

  // ── Collapsed rail: avatar button with a hover tooltip ──────────────────────
  if (collapsed) {
    return (
      <div ref={ref} className="relative flex justify-center px-1 pb-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          title={`${current.name} — switch workspace`}
          aria-label="Switch workspace"
          aria-haspopup="menu"
          aria-expanded={open}
          className={`flex h-8 w-8 items-center justify-center rounded-md transition-shadow ${
            open ? "ring-2 ring-indigo-400/60" : ""
          }`}
        >
          <WorkspaceLogo workspace={current} className="h-8 w-8" text="text-sm" />
        </button>
        {open && <Menu />}
      </div>
    );
  }

  // ── Expanded: current-workspace row that opens the menu ─────────────────────
  return (
    <div ref={ref} className="relative px-2 pb-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-lg border border-zinc-200 px-2 py-2 text-left transition-colors hover:bg-zinc-100"
      >
        <WorkspaceLogo workspace={current} className="h-7 w-7" text="text-xs" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-zinc-800">
            {current.name}
          </span>
          <span className="block text-[11px] capitalize text-zinc-400">
            {current.role}
          </span>
        </span>
        <ChevronIcon />
      </button>
      {open && <Menu />}
    </div>
  );

  // Shared dropdown menu (rendered the same in both rail states).
  function Menu() {
    return (
      <div
        role="menu"
        className="absolute left-2 right-2 top-full z-50 mt-1 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg"
      >
        <div className="border-b border-zinc-100 px-3 py-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
            Workspaces
          </p>
        </div>
        <ul className="max-h-64 overflow-y-auto py-1">
          {workspaces.map((w) => (
            <li key={w.id}>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={w.id === current.id}
                disabled={busy}
                onClick={() => switchTo(w.id)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50"
              >
                <WorkspaceLogo workspace={w} className="h-6 w-6" text="text-[11px]" rounded="rounded" />
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                {w.id === current.id && <CheckIcon />}
              </button>
            </li>
          ))}
        </ul>

        <div className="border-t border-zinc-100 p-1">
          <Link
            href="/workspace/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-50"
          >
            <GearIcon />
            Workspace settings
          </Link>
        </div>

        <div className="border-t border-zinc-100 p-1">
          {creating ? (
            <form onSubmit={createWorkspace} className="flex flex-col gap-1.5 p-1.5">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={100}
                placeholder="Workspace name"
                className="w-full rounded-md border border-zinc-200 px-2 py-1.5 text-sm outline-none focus:border-indigo-400"
              />
              <div className="flex gap-1.5">
                <button
                  type="submit"
                  disabled={busy || !newName.trim()}
                  className="flex-1 rounded-md bg-indigo-600 px-2 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
                >
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreating(false);
                    setNewName("");
                  }}
                  className="rounded-md px-2 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium text-indigo-600 transition-colors hover:bg-indigo-50"
            >
              <PlusIcon />
              New workspace
            </button>
          )}
        </div>
      </div>
    );
  }
}

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-zinc-400">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-indigo-500">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-zinc-400">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
