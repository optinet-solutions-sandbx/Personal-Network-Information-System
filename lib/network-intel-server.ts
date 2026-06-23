// Server-only helper: load a workspace's contacts + connection count from the
// DB and reduce them to NetworkStats. Kept out of lib/network-intel.ts so that
// file stays pure (no prisma import) and trivially testable.

import { prisma } from "@/lib/prisma";
import { ownerWhere } from "@/lib/auth";
import { computeNetworkStats, type NetworkStats } from "@/lib/network-intel";
import type { Contact } from "@/lib/types";

export async function loadNetworkStats(
  workspaceId: Parameters<typeof ownerWhere>[0]
): Promise<NetworkStats> {
  const where = ownerWhere(workspaceId);

  const [rows, connections] = await Promise.all([
    prisma.contact.findMany({
      where,
      select: {
        id: true,
        name: true,
        company: true,
        location: true,
        tags: true,
        title: true,
        healthTier: true,
        birthday: true,
        createdAt: true,
        _count: { select: { notes: true } },
      },
    }),
    prisma.relationship.count({ where }),
  ]);

  // computeNetworkStats only reads the selected fields; cast to the shared shape.
  const contacts = rows as unknown as Contact[];
  return computeNetworkStats(contacts, connections);
}
