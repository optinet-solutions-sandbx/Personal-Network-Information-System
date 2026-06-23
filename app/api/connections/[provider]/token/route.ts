import { NextRequest, NextResponse } from "next/server";
import { resolveOwner } from "@/lib/auth";
import { isEncryptionConfigured } from "@/lib/crypto";
import { getConnector } from "@/lib/connectors/registry";
import { saveConnection } from "@/lib/connectors/store";

type Params = { params: Promise<{ provider: string }> };

const MAX_TOKEN_LEN = 500;

// POST /api/connections/:provider/token  { token }
// Connect a "token"-auth provider (e.g. a HubSpot Private-app token) by saving a
// user-pasted access token. Validates the token with the provider first.
export async function POST(req: NextRequest, { params }: Params) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  const { provider } = await params;
  const connector = getConnector(provider);
  if (!connector) {
    return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  }
  if (connector.authMode !== "token" || !connector.verifyToken) {
    return NextResponse.json(
      { error: `${connector.label} connects via OAuth, not a token` },
      { status: 400 }
    );
  }
  if (!isEncryptionConfigured()) {
    return NextResponse.json(
      { error: "Connections are not enabled on this server (no encryption key)." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token) {
    return NextResponse.json({ error: "A token is required." }, { status: 400 });
  }
  if (token.length > MAX_TOKEN_LEN) {
    return NextResponse.json({ error: "That token is too long." }, { status: 400 });
  }

  try {
    const account = await connector.verifyToken(token);
    await saveConnection(
      owner,
      connector.id,
      { accessToken: token, refreshToken: null, expiresAt: null, scope: null },
      account
    );
    return NextResponse.json({ ok: true, accountLabel: account.label });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not verify that token.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
