"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const authEnabled = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);

export default function AccountPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!authEnabled) {
      setReady(true);
      return;
    }
    let active = true;
    import("@/lib/supabase/client").then(({ createClient }) => {
      createClient()
        .auth.getUser()
        .then(({ data }) => {
          if (active) {
            setEmail(data.user?.email ?? null);
            setReady(true);
          }
        });
    });
    return () => {
      active = false;
    };
  }, []);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);

    if (next.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (next !== confirm) {
      setError("New password and confirmation don't match.");
      return;
    }
    if (current && next === current) {
      setError("New password must be different from the current one.");
      return;
    }
    if (!email) {
      setError("You must be signed in to change your password.");
      return;
    }

    setSaving(true);
    try {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();

      // Verify the current password by re-authenticating first.
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password: current,
      });
      if (signInError) {
        setError("Current password is incorrect.");
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({ password: next });
      if (updateError) {
        setError(updateError.message);
        return;
      }

      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-5">
        <h1 className="text-2xl font-bold">Account</h1>
        <p className="text-sm text-zinc-500">
          Manage your sign-in credentials.
        </p>
      </div>

      {!ready ? (
        <p className="rounded-xl border border-zinc-200 p-8 text-center text-sm text-zinc-400">
          Loading…
        </p>
      ) : !authEnabled ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-6">
          <p className="text-sm text-zinc-600">
            Authentication isn&apos;t enabled in this environment, so there&apos;s no
            password to change. The app is running in open mode.
          </p>
        </div>
      ) : !email ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-6">
          <p className="text-sm text-zinc-600">
            You&apos;re not signed in.{" "}
            <Link href="/login" className="text-indigo-600 hover:underline">
              Sign in
            </Link>{" "}
            to manage your account.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-200 bg-white p-6">
          <div className="mb-4 flex items-center gap-2 text-sm">
            <span className="text-zinc-500">Signed in as</span>
            <span className="font-medium">{email}</span>
          </div>

          <h2 className="mb-3 text-base font-semibold">Change password</h2>

          {done && (
            <div className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              ✓ Password updated. Use it next time you sign in.
            </div>
          )}
          {error && (
            <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={changePassword} className="space-y-3">
            <Field
              label="Current password"
              value={current}
              onChange={setCurrent}
              show={show}
              autoComplete="current-password"
            />
            <Field
              label="New password"
              value={next}
              onChange={setNext}
              show={show}
              autoComplete="new-password"
              hint="At least 8 characters."
            />
            <Field
              label="Confirm new password"
              value={confirm}
              onChange={setConfirm}
              show={show}
              autoComplete="new-password"
            />

            <label className="flex items-center gap-2 text-xs text-zinc-500">
              <input
                type="checkbox"
                checked={show}
                onChange={(e) => setShow(e.target.checked)}
                className="accent-indigo-600"
              />
              Show passwords
            </label>

            <button
              type="submit"
              disabled={saving || !current || !next || !confirm}
              className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? "Updating…" : "Update password"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  show,
  autoComplete,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  autoComplete: string;
  hint?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-zinc-600">
        {label}
      </label>
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
      />
      {hint && <p className="mt-1 text-[11px] text-zinc-400">{hint}</p>}
    </div>
  );
}
