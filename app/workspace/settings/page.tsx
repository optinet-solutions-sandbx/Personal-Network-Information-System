"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Swal from "sweetalert2";
import { fileToAvatarDataUrl } from "@/lib/image";

const authEnabled = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);

type Role = "owner" | "admin" | "member";

type Member = {
  id: string;
  role: Role;
  createdAt: string;
  user: { id: string; email: string; name: string | null; avatar: string | null };
};

type WorkspaceDetail = {
  id: string;
  name: string;
  description: string | null;
  avatar: string | null;
  type: "personal" | "team";
  role: Role;
  members: Member[];
};

type Invite = {
  id: string;
  token: string;
  role: Role;
  expiresAt: string | null;
  revokedAt: string | null;
  usedCount: number;
  createdAt: string;
};

export default function WorkspaceSettingsPage() {
  const [ready, setReady] = useState(false);
  const [ws, setWs] = useState<WorkspaceDetail | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const listRes = await fetch("/api/workspaces");
    if (!listRes.ok) {
      setReady(true);
      return;
    }
    const { currentId } = (await listRes.json()) as { currentId: string | null };
    if (!currentId) {
      setReady(true);
      return;
    }
    const detRes = await fetch(`/api/workspaces/${currentId}`);
    if (detRes.ok) setWs(await detRes.json());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!authEnabled) {
      setReady(true);
      return;
    }
    // Current user id (to identify "you" in the member list).
    import("@/lib/supabase/client").then(({ createClient }) =>
      createClient()
        .auth.getUser()
        .then(({ data }) => setCurrentUserId(data.user?.id ?? null))
    );
    load();
  }, [load]);

  const isAdmin = ws ? ws.role === "owner" || ws.role === "admin" : false;
  const isOwner = ws?.role === "owner";
  const isTeam = ws?.type === "team";

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h1 className="bg-gradient-to-r from-zinc-900 via-indigo-700 to-zinc-900 bg-clip-text text-2xl font-bold tracking-tight text-transparent">
          Workspace settings
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Manage this workspace&apos;s profile, members, and invite links. Switch
          workspaces from the sidebar to manage a different one.
        </p>
      </div>

      {!ready ? (
        <p className="rounded-2xl border border-zinc-200 p-8 text-center text-sm text-zinc-400">
          Loading…
        </p>
      ) : !ws ? (
        <div className="rounded-2xl border border-zinc-200 bg-white/80 p-6 backdrop-blur">
          <p className="text-sm text-zinc-600">
            No workspace selected.{" "}
            <Link href="/login" className="text-indigo-600 hover:underline">
              Sign in
            </Link>{" "}
            and pick a workspace from the sidebar.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <ProfileSection ws={ws} canEdit={isAdmin} onSaved={load} onError={setError} />

          {isTeam && (
            <MembersSection
              ws={ws}
              isAdmin={isAdmin}
              currentUserId={currentUserId}
              onChanged={load}
              onError={setError}
            />
          )}

          {isTeam && isAdmin && (
            <InvitesSection workspaceId={ws.id} onError={setError} />
          )}

          {isTeam && isOwner && <DangerZone ws={ws} onError={setError} />}
        </div>
      )}
    </div>
  );
}

// ── Profile ───────────────────────────────────────────────────────────────────
function ProfileSection({
  ws,
  canEdit,
  onSaved,
  onError,
}: {
  ws: WorkspaceDetail;
  canEdit: boolean;
  onSaved: () => void;
  onError: (e: string | null) => void;
}) {
  const [name, setName] = useState(ws.name);
  const [description, setDescription] = useState(ws.description ?? "");
  const [avatar, setAvatar] = useState<string | null>(ws.avatar);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = "";
    if (!file) return;
    try {
      setAvatar(await fileToAvatarDataUrl(file));
      setDone(false);
    } catch {
      onError("Couldn't read that image. Try a different file.");
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    onError(null);
    setDone(false);
    setSaving(true);
    try {
      const res = await fetch(`/api/workspaces/${ws.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: description || null, avatar }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        onError(d?.error ?? "Could not save workspace.");
        return;
      }
      setDone(true);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const initial = ws.name.trim()[0]?.toUpperCase() ?? "?";

  return (
    <Card title="Profile" icon={<IconUser />}>
      <form onSubmit={save}>
        {done && (
          <div className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            ✓ Saved.
          </div>
        )}
        <div className="mb-5 flex items-center gap-4">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="" className="h-16 w-16 rounded-xl object-cover ring-1 ring-indigo-500/30 shadow-lg shadow-indigo-500/20" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-xl font-semibold text-white shadow-lg shadow-indigo-500/25">
              {initial}
            </div>
          )}
          {canEdit && (
            <div className="flex flex-col gap-1.5">
              <input ref={fileRef} type="file" accept="image/*" onChange={onPickAvatar} className="hidden" />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-zinc-50"
              >
                {avatar ? "Change logo" : "Upload logo"}
              </button>
              {avatar && (
                <button
                  type="button"
                  onClick={() => { setAvatar(null); setDone(false); }}
                  className="text-left text-xs text-zinc-500 hover:text-red-600"
                >
                  Remove logo
                </button>
              )}
            </div>
          )}
        </div>

        <label className="mb-1 block text-xs font-medium text-zinc-600">Name</label>
        <input
          type="text"
          value={name}
          disabled={!canEdit}
          maxLength={100}
          onChange={(e) => { setName(e.target.value); setDone(false); }}
          className="mb-4 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60"
        />

        <label className="mb-1 block text-xs font-medium text-zinc-600">Description</label>
        <textarea
          value={description}
          disabled={!canEdit}
          maxLength={500}
          rows={3}
          onChange={(e) => { setDescription(e.target.value); setDone(false); }}
          placeholder="What is this workspace for?"
          className="w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60"
        />

        {canEdit && (
          <PrimaryButton type="submit" disabled={saving} className="mt-5">
            {saving ? "Saving…" : "Save"}
          </PrimaryButton>
        )}
      </form>
    </Card>
  );
}

// ── Members ─────────────────────────────────────────────────────────────────
function MembersSection({
  ws,
  isAdmin,
  currentUserId,
  onChanged,
  onError,
}: {
  ws: WorkspaceDetail;
  isAdmin: boolean;
  currentUserId: string | null;
  onChanged: () => void;
  onError: (e: string | null) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const ownerCount = ws.members.filter((m) => m.role === "owner").length;

  async function changeRole(m: Member, role: Role) {
    setBusyId(m.id);
    onError(null);
    try {
      const res = await fetch(`/api/workspaces/${ws.id}/members/${m.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        onError(d?.error ?? "Could not change role.");
      } else onChanged();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(m: Member, isSelf: boolean) {
    const confirm = await Swal.fire({
      icon: "warning",
      title: isSelf ? "Leave workspace?" : `Remove ${m.user.name ?? m.user.email}?`,
      html: isSelf
        ? "You'll lose access to this workspace's data until you're re-invited."
        : "They'll lose access to this workspace's data.",
      showCancelButton: true,
      confirmButtonText: isSelf ? "Leave" : "Remove",
      confirmButtonColor: "#dc2626",
    });
    if (!confirm.isConfirmed) return;
    setBusyId(m.id);
    onError(null);
    try {
      const res = await fetch(`/api/workspaces/${ws.id}/members/${m.id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        onError(d?.error ?? "Could not remove member.");
        return;
      }
      // Leaving your active workspace bounces you back to your personal one.
      if (isSelf) window.location.assign("/dashboard");
      else onChanged();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card title={`Members · ${ws.members.length}`} icon={<IconUsers />}>
      <ul className="-my-1 divide-y divide-zinc-100">
        {ws.members.map((m) => {
          const isSelf = m.user.id === currentUserId;
          // An admin can manage members, but not owners (only owners can).
          const canManage = isAdmin && (ws.role === "owner" || m.role !== "owner");
          const isLastOwner = m.role === "owner" && ownerCount <= 1;
          return (
            <li key={m.id} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-zinc-50">
              {m.user.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.user.avatar} alt="" className="h-8 w-8 rounded-full object-cover ring-1 ring-white/10" />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-zinc-200 to-zinc-300 text-xs font-semibold text-zinc-600">
                  {(m.user.name?.trim()[0] ?? m.user.email[0]).toUpperCase()}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-800">
                  {m.user.name ?? m.user.email}
                  {isSelf && <span className="ml-1 text-xs text-zinc-400">(you)</span>}
                </p>
                <p className="truncate text-xs text-zinc-400">{m.user.email}</p>
              </div>

              {canManage && !isLastOwner ? (
                <select
                  value={m.role}
                  disabled={busyId === m.id}
                  onChange={(e) => changeRole(m, e.target.value as Role)}
                  className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs capitalize outline-none"
                >
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                  <option value="owner">owner</option>
                </select>
              ) : (
                <RoleBadge role={m.role} />
              )}

              {/* Remove others (admins) or leave (self), unless last owner. */}
              {!isLastOwner && (canManage || isSelf) && (
                <button
                  type="button"
                  disabled={busyId === m.id}
                  onClick={() => remove(m, isSelf)}
                  className="rounded-md px-2 py-1 text-xs font-medium text-zinc-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                >
                  {isSelf ? "Leave" : "Remove"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ── Invite links ──────────────────────────────────────────────────────────────
const EXPIRY_OPTIONS: { label: string; minutes: number | null }[] = [
  { label: "5 minutes", minutes: 5 },
  { label: "30 minutes", minutes: 30 },
  { label: "1 hour", minutes: 60 },
  { label: "1 day", minutes: 1440 },
  { label: "7 days", minutes: 10080 },
  { label: "Custom (days)", minutes: -1 }, // sentinel → show days input
  { label: "Never expires", minutes: null },
];

function InvitesSection({
  workspaceId,
  onError,
}: {
  workspaceId: string;
  onError: (e: string | null) => void;
}) {
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [role, setRole] = useState<Role>("member");
  const [expiryIdx, setExpiryIdx] = useState(3); // default 1 day
  const [customDays, setCustomDays] = useState(30);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const loadInvites = useCallback(async () => {
    const res = await fetch(`/api/workspaces/${workspaceId}/invites`);
    if (res.ok) setInvites((await res.json()).invites);
  }, [workspaceId]);

  useEffect(() => {
    loadInvites();
  }, [loadInvites]);

  async function create() {
    onError(null);
    setCreating(true);
    try {
      const opt = EXPIRY_OPTIONS[expiryIdx];
      const expiresInMinutes =
        opt.minutes === -1 ? Math.max(1, Math.round(customDays)) * 1440 : opt.minutes;
      const res = await fetch(`/api/workspaces/${workspaceId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, expiresInMinutes }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        onError(d?.error ?? "Could not create invite.");
        return;
      }
      await loadInvites();
    } finally {
      setCreating(false);
    }
  }

  async function copy(token: string) {
    const link = `${window.location.origin}/join/${token}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(token);
      setTimeout(() => setCopied((c) => (c === token ? null : c)), 1500);
    } catch {
      onError("Couldn't copy — your browser blocked clipboard access.");
    }
  }

  // Same endpoint for both: it revokes an active link and hard-deletes a dead one.
  async function removeInvite(invite: Invite) {
    const res = await fetch(`/api/workspaces/${workspaceId}/invites/${invite.id}`, { method: "DELETE" });
    if (res.ok) loadInvites();
    else onError("Could not update invite.");
  }

  function status(inv: Invite): { label: string; active: boolean } {
    if (inv.revokedAt) return { label: "Revoked", active: false };
    if (inv.expiresAt && new Date(inv.expiresAt).getTime() <= Date.now())
      return { label: "Expired", active: false };
    return { label: "Active", active: true };
  }

  return (
    <Card title="Invite links" icon={<IconLink />}>
      <p className="mb-3 text-sm text-zinc-500">
        Anyone who opens an active link (while signed in) joins this workspace with
        the link&apos;s role.
      </p>

      <div className="mb-5 flex flex-wrap items-end gap-2 rounded-xl border border-zinc-200 bg-zinc-50/50 p-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-600">Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm capitalize outline-none"
          >
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-600">Expires</label>
          <select
            value={expiryIdx}
            onChange={(e) => setExpiryIdx(Number(e.target.value))}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm outline-none"
          >
            {EXPIRY_OPTIONS.map((o, i) => (
              <option key={o.label} value={i}>{o.label}</option>
            ))}
          </select>
        </div>
        {EXPIRY_OPTIONS[expiryIdx].minutes === -1 && (
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-600">Days</label>
            <input
              type="number"
              min={1}
              value={customDays}
              onChange={(e) => setCustomDays(Number(e.target.value))}
              className="w-20 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm outline-none"
            />
          </div>
        )}
        <PrimaryButton type="button" onClick={create} disabled={creating} className="px-4 py-1.5">
          {creating ? "Creating…" : "Create link"}
        </PrimaryButton>
      </div>

      {invites === null ? (
        <p className="text-sm text-zinc-400">Loading…</p>
      ) : invites.length === 0 ? (
        <p className="text-sm text-zinc-400">No invite links yet.</p>
      ) : (
        <ul className="-my-1 divide-y divide-zinc-100">
          {invites.map((inv) => {
            const st = status(inv);
            return (
              <li key={inv.id} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-zinc-50">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm">
                    <RoleBadge role={inv.role} />
                    <span className={`inline-flex items-center gap-1.5 ${st.active ? "text-emerald-600" : "text-zinc-400"}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${st.active ? "bg-emerald-500 shadow-[0_0_6px_1px_rgba(16,185,129,0.7)] animate-pulse" : "bg-zinc-400"}`} />
                      {st.label}
                    </span>
                    <span className="text-xs text-zinc-400">· {inv.usedCount} joined</span>
                  </p>
                  <p className="truncate text-xs text-zinc-400">
                    {inv.expiresAt
                      ? `Expires ${new Date(inv.expiresAt).toLocaleString()}`
                      : "Never expires"}
                  </p>
                </div>
                {st.active ? (
                  <>
                    <button
                      type="button"
                      onClick={() => copy(inv.token)}
                      className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-zinc-50"
                    >
                      {copied === inv.token ? "Copied!" : "Copy link"}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeInvite(inv)}
                      className="rounded-md px-2 py-1 text-xs font-medium text-zinc-500 transition-colors hover:bg-red-50 hover:text-red-600"
                    >
                      Revoke
                    </button>
                  </>
                ) : (
                  // Revoked/expired: let admins clear the dead entry from the list.
                  <button
                    type="button"
                    onClick={() => removeInvite(inv)}
                    title="Remove this entry"
                    className="rounded-md px-2 py-1 text-xs font-medium text-zinc-500 transition-colors hover:bg-red-50 hover:text-red-600"
                  >
                    Clear
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ── Danger zone ───────────────────────────────────────────────────────────────
function DangerZone({
  ws,
  onError,
}: {
  ws: WorkspaceDetail;
  onError: (e: string | null) => void;
}) {
  async function del() {
    const confirm = await Swal.fire({
      icon: "warning",
      title: `Delete "${ws.name}"?`,
      html: `This permanently deletes the workspace and <strong>all its contacts, notes, and data</strong>. This can't be undone.<br/><br/>Type <strong>DELETE</strong> to confirm.`,
      input: "text",
      inputPlaceholder: "DELETE",
      inputAttributes: { autocomplete: "off", spellcheck: "false" },
      showCancelButton: true,
      confirmButtonText: "Delete workspace",
      confirmButtonColor: "#dc2626",
      preConfirm: (value: string) => {
        if ((value ?? "").trim() !== "DELETE") {
          Swal.showValidationMessage('Type "DELETE" to confirm');
          return false;
        }
        return true;
      },
    });
    if (!confirm.isConfirmed) return;
    const res = await fetch(`/api/workspaces/${ws.id}`, { method: "DELETE" });
    if (res.ok) window.location.assign("/dashboard");
    else {
      const d = await res.json().catch(() => null);
      onError(d?.error ?? "Could not delete workspace.");
    }
  }

  return (
    <section className="relative overflow-hidden rounded-2xl border border-red-300/60 bg-red-50/60 p-6 backdrop-blur">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-red-500/60 to-transparent" />
      <h2 className="mb-1 text-sm font-semibold tracking-wide text-red-700">
        Danger zone
      </h2>
      <p className="mb-4 text-sm text-zinc-600">
        Deleting a workspace permanently removes it and everything in it.
      </p>
      <button
        type="button"
        onClick={del}
        className="rounded-lg bg-gradient-to-r from-red-600 to-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-red-500/25 transition hover:from-red-500 hover:to-rose-500"
      >
        Delete workspace
      </button>
    </section>
  );
}

// ── Shared bits ───────────────────────────────────────────────────────────────
// Glassy panel with a glowing top hairline and a gradient icon chip — the
// app's "futuristic" surface (mirrors the dark swal/dashboard treatment).
function Card({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-zinc-200/80 bg-white/80 p-6 shadow-sm backdrop-blur">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent" />
      <header className="mb-5 flex items-center gap-2.5">
        {icon && (
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500/20 to-indigo-500/5 text-indigo-500 ring-1 ring-indigo-500/20">
            {icon}
          </span>
        )}
        <h2 className="text-sm font-semibold tracking-wide text-zinc-800">
          {title}
        </h2>
      </header>
      {children}
    </section>
  );
}

// Primary action button shared by the sections: indigo→violet gradient + glow.
function PrimaryButton({
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

function RoleBadge({ role }: { role: Role }) {
  const styles: Record<Role, string> = {
    owner: "bg-indigo-500/10 text-indigo-700 ring-indigo-500/30",
    admin: "bg-blue-500/10 text-blue-700 ring-blue-500/30",
    member: "bg-zinc-500/10 text-zinc-600 ring-zinc-400/30",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ${styles[role]}`}>
      {role}
    </span>
  );
}

// ── Section icons ───────────────────────────────────────────────────────────
function IconUser() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
function IconUsers() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function IconLink() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}
