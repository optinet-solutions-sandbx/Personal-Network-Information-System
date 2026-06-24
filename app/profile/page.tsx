"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { fileToAvatarDataUrl } from "@/lib/image";

const authEnabled = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);

type Profile = {
  email: string;
  name: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  bio: string | null;
  website: string | null;
  phone: string | null;
  avatar: string | null;
};

const EMPTY: Omit<Profile, "email"> = {
  name: "",
  title: "",
  company: "",
  location: "",
  bio: "",
  website: "",
  phone: "",
  avatar: null,
};

export default function ProfilePage() {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  const [form, setForm] = useState<Omit<Profile, "email">>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!authEnabled) {
      setReady(true);
      return;
    }
    let active = true;
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { profile: Profile | null }) => {
        if (!active) return;
        if (data.profile) {
          setSignedIn(true);
          setEmail(data.profile.email);
          setForm({
            name: data.profile.name ?? "",
            title: data.profile.title ?? "",
            company: data.profile.company ?? "",
            location: data.profile.location ?? "",
            bio: data.profile.bio ?? "",
            website: data.profile.website ?? "",
            phone: data.profile.phone ?? "",
            avatar: data.profile.avatar ?? null,
          });
        }
        setReady(true);
      })
      .catch(() => active && setReady(true));
    return () => {
      active = false;
    };
  }, []);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setDone(false);
  }

  async function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setError(null);
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      set("avatar", dataUrl);
    } catch {
      setError("Couldn't read that image. Try a different file.");
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    setSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Could not save your profile.");
        return;
      }
      setDone(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-5">
        <h1 className="text-2xl font-bold">Your profile</h1>
        <p className="text-sm text-zinc-500">
          How you show up in your network — the person behind the contacts you
          keep. This is just for you (and powers AI context); it isn&apos;t public.
        </p>
      </div>

      {!ready ? (
        <p className="rounded-xl border border-zinc-200 p-8 text-center text-sm text-zinc-400">
          Loading…
        </p>
      ) : !authEnabled ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-6">
          <p className="text-sm text-zinc-600">
            Authentication isn&apos;t enabled in this environment, so there&apos;s
            no account to attach a profile to. The app is running in open mode.
          </p>
        </div>
      ) : !signedIn ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-6">
          <p className="text-sm text-zinc-600">
            You&apos;re not signed in.{" "}
            <Link href="/login" className="text-indigo-600 hover:underline">
              Sign in
            </Link>{" "}
            to set up your profile.
          </p>
        </div>
      ) : (
        <form
          onSubmit={save}
          className="rounded-xl border border-zinc-200 bg-white p-6"
        >
          {done && (
            <div className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              ✓ Profile saved.
            </div>
          )}
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Avatar */}
          <div className="mb-6 flex items-center gap-4">
            <Avatar avatar={form.avatar} name={form.name} email={email} />
            <div className="flex flex-col gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={onPickAvatar}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-zinc-50"
              >
                {form.avatar ? "Change photo" : "Upload photo"}
              </button>
              {form.avatar && (
                <button
                  type="button"
                  onClick={() => set("avatar", null)}
                  className="text-left text-xs text-zinc-500 hover:text-red-600"
                >
                  Remove photo
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField
              label="Name"
              value={form.name ?? ""}
              onChange={(v) => set("name", v)}
              placeholder="Jane Doe"
            />
            <TextField
              label="Title / role"
              value={form.title ?? ""}
              onChange={(v) => set("title", v)}
              placeholder="Head of Partnerships"
            />
            <TextField
              label="Company"
              value={form.company ?? ""}
              onChange={(v) => set("company", v)}
              placeholder="Optinet Solutions"
            />
            <TextField
              label="Location"
              value={form.location ?? ""}
              onChange={(v) => set("location", v)}
              placeholder="Austin, TX"
            />
            <TextField
              label="Website"
              value={form.website ?? ""}
              onChange={(v) => set("website", v)}
              placeholder="https://…"
            />
            <TextField
              label="Phone"
              value={form.phone ?? ""}
              onChange={(v) => set("phone", v)}
              placeholder="+1 555 123 4567"
            />
          </div>

          <div className="mt-4">
            <label className="mb-1 block text-xs font-medium text-zinc-600">
              About you
            </label>
            <textarea
              value={form.bio ?? ""}
              onChange={(e) => set("bio", e.target.value)}
              rows={4}
              placeholder="A short description of what you do, what you're working on, and what kind of connections you're looking for."
              className="w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          {email && (
            <p className="mt-4 text-xs text-zinc-400">
              Signed in as {email}.{" "}
              <Link href="/account" className="text-indigo-600 hover:underline">
                Account settings
              </Link>
            </p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="mt-5 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50 sm:w-auto sm:px-6"
          >
            {saving ? "Saving…" : "Save profile"}
          </button>
        </form>
      )}
    </div>
  );
}

function Avatar({
  avatar,
  name,
  email,
}: {
  avatar: string | null;
  name: string | null;
  email: string | null;
}) {
  const initial = (name?.trim()?.[0] ?? email?.[0] ?? "?").toUpperCase();
  return avatar ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={avatar}
      alt="Your profile photo"
      className="h-20 w-20 rounded-full object-cover ring-1 ring-zinc-200"
    />
  ) : (
    <div className="flex h-20 w-20 items-center justify-center rounded-full bg-indigo-600 text-2xl font-semibold text-white">
      {initial}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-zinc-600">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
      />
    </div>
  );
}
