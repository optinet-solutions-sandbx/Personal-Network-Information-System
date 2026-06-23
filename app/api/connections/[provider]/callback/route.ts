import { NextRequest, NextResponse } from "next/server";
import { resolveOwner } from "@/lib/auth";
import { isEncryptionConfigured } from "@/lib/crypto";
import { getConnector } from "@/lib/connectors/registry";
import { redirectUriFor, saveConnection, appOrigin } from "@/lib/connectors/store";
import { STATE_COOKIE } from "../authorize/route";

type Params = { params: Promise<{ provider: string }> };

// GET /api/connections/:provider/callback?code=...&state=...
// The provider redirects here after consent. Verify the CSRF state, exchange
// the code for tokens, store them encrypted, and bounce back to /connections.
export async function GET(req: NextRequest, { params }: Params) {
  const { provider } = await params;
  const base = appOrigin(req);
  const back = (q: string) => NextResponse.redirect(`${base}/connections?${q}`);

  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  const connector = getConnector(provider);
  if (!connector) return back("error=unknown_provider");
  if (!isEncryptionConfigured() || !connector.isConfigured()) {
    return back("error=not_configured");
  }

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const providerError = searchParams.get("error");

  // Always consume the state cookie.
  const cookie = req.cookies.get(STATE_COOKIE)?.value ?? "";
  const clearState = (res: NextResponse) => {
    res.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  };

  if (providerError) return clearState(back(`error=${encodeURIComponent(providerError)}`));
  if (!code || !state) return clearState(back("error=missing_code"));

  const [cookieProvider, cookieState] = cookie.split(":");
  if (cookieProvider !== connector.id || !cookieState || cookieState !== state) {
    return clearState(back("error=state_mismatch"));
  }

  try {
    const redirectUri = redirectUriFor(req, connector.id);
    const tokens = await connector.exchangeCode(code, redirectUri);
    const account = await connector
      .getAccountInfo({ accessToken: tokens.accessToken, apiBaseUrl: tokens.apiBaseUrl })
      .catch(() => ({ externalAccountId: null, label: null }));
    await saveConnection(owner, connector.id, tokens, account);
    return clearState(back(`connected=${connector.id}`));
  } catch (err) {
    console.error(`OAuth callback for ${connector.id} failed:`, err);
    return clearState(back("error=exchange_failed"));
  }
}
