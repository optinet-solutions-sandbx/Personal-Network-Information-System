"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { authenticate, type AuthState } from "@/app/auth/actions";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    authenticate,
    undefined
  );

  const isSignup = mode === "signup";

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
            N
          </span>
          <span className="text-xl font-semibold tracking-tight">
            Networky<span className="text-indigo-600">.ai</span>
          </span>
        </div>

        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {isSignup ? "Create your account" : "Welcome back"}
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {isSignup
              ? "Sign up to start building your network."
              : "Sign in to access your contacts."}
          </p>

          <form action={formAction} className="mt-5 space-y-4">
            <input type="hidden" name="intent" value={mode} />

            <div>
              <label htmlFor="email" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="input w-full"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete={isSignup ? "new-password" : "current-password"}
                required
                minLength={isSignup ? 8 : undefined}
                className="input w-full"
                placeholder={isSignup ? "At least 8 characters" : "••••••••"}
              />
            </div>

            {state?.error && (
              <p className="rounded-md bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-600 dark:text-red-400">
                {state.error}
              </p>
            )}
            {state?.message && (
              <p className="rounded-md bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
                {state.message}
              </p>
            )}

            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              {pending
                ? isSignup
                  ? "Creating account…"
                  : "Signing in…"
                : isSignup
                ? "Create account"
                : "Sign in"}
            </button>
          </form>

          <p className="mt-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
            {isSignup ? "Already have an account?" : "Don't have an account?"}{" "}
            <button
              type="button"
              onClick={() => setMode(isSignup ? "login" : "signup")}
              className="font-medium text-indigo-600 hover:underline"
            >
              {isSignup ? "Sign in" : "Sign up"}
            </button>
          </p>
        </div>

        <p className="mt-4 text-center text-xs text-zinc-400 dark:text-zinc-500">
          <Link href="/" className="hover:underline">
            ← Back home
          </Link>
        </p>
      </div>
    </div>
  );
}
