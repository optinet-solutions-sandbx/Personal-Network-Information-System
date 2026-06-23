import { NextRequest, NextResponse } from "next/server";
import { resolveOwner } from "@/lib/auth";
import { getConnector } from "@/lib/connectors/registry";
import { deleteConnection } from "@/lib/connectors/store";

type Params = { params: Promise<{ provider: string }> };

// DELETE /api/connections/:provider
// Disconnect a provider: remove the stored grant. Contacts already synced are
// left in place (they're yours now); a future sync simply won't run until you
// reconnect.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  const { provider } = await params;
  const connector = getConnector(provider);
  if (!connector) {
    return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  }

  const removed = await deleteConnection(owner, connector.id);
  if (!removed) {
    return NextResponse.json({ error: `${connector.label} is not connected` }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
