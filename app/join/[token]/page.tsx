"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type State =
  | { kind: "joining" }
  | { kind: "joined"; workspaceName: string; alreadyMember: boolean }
  | { kind: "invalid"; message: string };

// Public landing for a shareable invite link. The proxy already routes
// logged-out visitors through /login?next=/join/<token>, so by the time this
// runs the user is normally signed in; we still handle a 401 defensively.
export default function JoinPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [state, setState] = useState<State>({ kind: "joining" });
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // guard React 18 double-invoke in dev
    ran.current = true;

    fetch(`/api/invites/${token}/accept`, { method: "POST" })
      .then(async (res) => {
        if (res.status === 401) {
          window.location.assign(`/login?next=/join/${token}`);
          return;
        }
        const data = await res.json().catch(() => null);
        if (res.ok && data?.ok) {
          setState({
            kind: "joined",
            workspaceName: data.workspaceName ?? "the workspace",
            alreadyMember: Boolean(data.alreadyMember),
          });
          // Land them inside the workspace they just joined.
          setTimeout(() => window.location.assign("/dashboard"), 1200);
        } else {
          setState({
            kind: "invalid",
            message: data?.error ?? "This invite link is no longer valid.",
          });
        }
      })
      .catch(() =>
        setState({ kind: "invalid", message: "Something went wrong. Please try again." })
      );
  }, [token]);

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <div className="mb-4 flex items-center justify-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
            N
          </span>
          <span className="text-xl font-semibold tracking-tight">
            Networky<span className="text-indigo-600">.ai</span>
          </span>
        </div>

        {state.kind === "joining" && (
          <p className="text-sm text-zinc-500">Joining workspace…</p>
        )}

        {state.kind === "joined" && (
          <>
            <h1 className="text-lg font-semibold text-zinc-900">
              {state.alreadyMember ? "You're already a member" : "You're in!"}
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              Switched to <strong>{state.workspaceName}</strong>. Taking you to the
              dashboard…
            </p>
          </>
        )}

        {state.kind === "invalid" && (
          <>
            <h1 className="text-lg font-semibold text-zinc-900">
              Invite unavailable
            </h1>
            <p className="mt-1 text-sm text-zinc-500">{state.message}</p>
            <Link
              href="/dashboard"
              className="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
            >
              Go to dashboard
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
