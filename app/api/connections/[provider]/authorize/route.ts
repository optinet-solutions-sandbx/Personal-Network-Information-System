import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { resolveOwner } from "@/lib/auth";
import { isEncryptionConfigured } from "@/lib/crypto";
import { getConnector } from "@/lib/connectors/registry";
import { redirectUriFor } from "@/lib/connectors/store";

type Params = { params: Promise<{ provider: string }> };

export const STATE_COOKIE = "nk_oauth_state";

// GET /api/connections/:provider/authorize
// Kicks off the OAuth flow: mint a CSRF state, stash it in an httpOnly cookie,
// and redirect the browser to the provider's consent screen.
export async function GET(req: NextRequest, { params }: Params) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  const { provider } = await params;
  const connector = getConnector(provider);
  if (!connector) {
    return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  }
  if (connector.authMode !== "oauth") {
    return NextResponse.json(
      { error: `${connector.label} connects via a pasted token, not OAuth` },
      { status: 400 }
    );
  }
  if (!isEncryptionConfigured() || !connector.isConfigured()) {
    return NextResponse.json(
      { error: `${connector.label} is not configured on this server` },
      { status: 503 }
    );
  }

  const state = randomBytes(16).toString("hex");
  const redirectUri = redirectUriFor(req, connector.id);
  const authorizeUrl = connector.getAuthorizeUrl(redirectUri, state);

  const res = NextResponse.redirect(authorizeUrl);
  // SameSite=Lax so the cookie survives the top-level GET redirect back from the
  // provider. Short-lived; cleared on callback.
  res.cookies.set(STATE_COOKIE, `${connector.id}:${state}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
