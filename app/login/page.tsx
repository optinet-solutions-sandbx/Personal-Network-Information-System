"use client";

import { Suspense, useActionState, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { authenticate, type AuthState } from "@/app/auth/actions";

export default function LoginPage() {
  // useSearchParams must sit under a Suspense boundary for prerendering.
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [showPassword, setShowPassword] = useState(false);
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "";
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

        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-zinc-900">
            {isSignup ? "Create your account" : "Welcome back"}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {isSignup
              ? "Sign up to start building your network."
              : "Sign in to access your contacts."}
          </p>

          <form action={formAction} className="mt-5 space-y-4">
            <input type="hidden" name="intent" value={mode} />
            {next && <input type="hidden" name="next" value={next} />}

            <div>
              <label htmlFor="email" className="mb-1 block text-xs font-medium text-zinc-600">
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
              <label htmlFor="password" className="mb-1 block text-xs font-medium text-zinc-600">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={isSignup ? "new-password" : "current-password"}
                  required
                  minLength={isSignup ? 8 : undefined}
                  className="input w-full pr-10"
                  placeholder={isSignup ? "At least 8 characters" : "••••••••"}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-zinc-400 hover:text-zinc-600"
                >
                  {showPassword ? (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                      <line x1="2" x2="22" y1="2" y2="22" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {state?.error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600">
                {state.error}
              </p>
            )}
            {state?.message && (
              <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
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

          <p className="mt-4 text-center text-xs text-zinc-500">
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

        <p className="mt-4 text-center text-xs text-zinc-400">
          <Link href="/" className="hover:underline">
            ← Back home
          </Link>
        </p>
      </div>
    </div>
  );
}
