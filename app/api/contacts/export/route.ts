import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveOwner, ownerWhere } from "@/lib/auth";
import { contactsToCsv, contactsToVcf } from "@/lib/contact-io";
import type { Contact } from "@/lib/types";

// GET /api/contacts/export?format=csv|vcf  -> downloadable file of all contacts.
export async function GET(req: NextRequest) {
  const owner = await resolveOwner();
  if (!owner.ok) return owner.response;

  const format = new URL(req.url).searchParams.get("format") === "vcf" ? "vcf" : "csv";

  const rows = await prisma.contact.findMany({
    where: ownerWhere(owner.workspaceId),
    orderBy: { name: "asc" },
  });

  // customFields are stored as a JSON string — parse for the serializers.
  const contacts = rows.map((r) => ({
    ...r,
    customFields:
      typeof r.customFields === "string" && r.customFields
        ? (JSON.parse(r.customFields) as Record<string, string>)
        : null,
  })) as unknown as Contact[];

  const body = format === "vcf" ? contactsToVcf(contacts) : contactsToCsv(contacts);
  const contentType = format === "vcf" ? "text/vcard; charset=utf-8" : "text/csv; charset=utf-8";
  const filename = `networky-contacts.${format}`;

  return new NextResponse(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
