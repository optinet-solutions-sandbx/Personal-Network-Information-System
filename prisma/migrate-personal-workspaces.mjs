// One-time migration: un-share the "Optinet Team" workspace back into per-account
// PRIVATE workspaces. Every existing contact is moved to the personal workspace
// of the account that CREATED it (Contact.userId); suggestions and relationships
// follow the workspace of their contacts; notes inherit their parent contact's
// workspace (no own column), so nothing to do there.
//
//   node prisma/migrate-personal-workspaces.mjs
//
// Idempotent — safe to re-run. Run AFTER deploying the personal-first
// resolveOrCreateWorkspace change (lib/workspace.ts). The old team workspace and
// its memberships are left intact (inert) so team-sharing can be re-enabled later.

import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

// Find (or create) the personal workspace owned by `userId`.
const cache = new Map();
async function personalWorkspaceFor(userId) {
  if (cache.has(userId)) return cache.get(userId);
  let ws = await p.workspaceMember.findFirst({
    where: { userId, workspace: { type: "personal" } },
    orderBy: { createdAt: "asc" },
    select: { workspaceId: true },
  });
  let workspaceId = ws?.workspaceId;
  if (!workspaceId) {
    const user = await p.user.findUnique({ where: { id: userId } });
    const label = user?.name || user?.email || userId;
    const created = await p.workspace.create({
      data: { name: `${label}'s Workspace`, type: "personal" },
    });
    await p.workspaceMember.create({
      data: { userId, workspaceId: created.id, role: "owner" },
    });
    workspaceId = created.id;
    console.log(`  created personal workspace for ${label} (${workspaceId})`);
  }
  cache.set(userId, workspaceId);
  return workspaceId;
}

try {
  // 0) Consolidate any duplicate personal workspaces per user (one can appear if
  //    the live app raced this migration on a user's first login — there is no DB
  //    constraint preventing two). Keep the earliest, fold the rest in.
  const pm = await p.workspaceMember.findMany({
    where: { workspace: { type: "personal" } },
    include: { workspace: true },
    orderBy: { workspace: { createdAt: "asc" } },
  });
  const owned = new Map();
  for (const m of pm) (owned.get(m.userId) ?? owned.set(m.userId, []).get(m.userId)).push(m.workspaceId);
  for (const [userId, wsIds] of owned) {
    if (wsIds.length <= 1) continue;
    const [keep, ...dupes] = wsIds;
    for (const dupe of dupes) {
      await p.contact.updateMany({ where: { workspaceId: dupe }, data: { workspaceId: keep } });
      await p.suggestion.updateMany({ where: { workspaceId: dupe }, data: { workspaceId: keep } });
      await p.relationship.updateMany({ where: { workspaceId: dupe }, data: { workspaceId: keep } });
      await p.workspace.delete({ where: { id: dupe } }); // cascades its membership
      console.log(`  consolidated duplicate personal workspace ${dupe} -> ${keep} (user ${userId})`);
      cache.set(userId, keep);
    }
  }

  // 1) Contacts -> creator's personal workspace.
  const contacts = await p.contact.findMany({ select: { id: true, name: true, userId: true } });
  let moved = 0, orphan = 0;
  for (const c of contacts) {
    if (!c.userId) { orphan++; console.log(`  ! contact "${c.name}" has no creator (userId null) — left as-is`); continue; }
    const wsId = await personalWorkspaceFor(c.userId);
    await p.contact.update({ where: { id: c.id }, data: { workspaceId: wsId } });
    moved++;
  }
  console.log(`Contacts moved: ${moved}${orphan ? `, orphaned (no creator): ${orphan}` : ""}`);

  // 2) Suggestions -> workspace of their contacts. A suggestion linking two
  //    contacts now in DIFFERENT private workspaces can't belong to either, so
  //    it's deleted (no longer a valid intra-workspace introduction).
  const suggestions = await p.suggestion.findMany({ select: { id: true, contactAId: true, contactBId: true } });
  let sResc = 0, sDel = 0;
  for (const s of suggestions) {
    const [a, b] = await Promise.all([
      p.contact.findUnique({ where: { id: s.contactAId }, select: { workspaceId: true } }),
      p.contact.findUnique({ where: { id: s.contactBId }, select: { workspaceId: true } }),
    ]);
    if (a?.workspaceId && a.workspaceId === b?.workspaceId) {
      await p.suggestion.update({ where: { id: s.id }, data: { workspaceId: a.workspaceId } });
      sResc++;
    } else {
      await p.suggestion.delete({ where: { id: s.id } });
      sDel++;
      console.log(`  deleted cross-workspace suggestion ${s.id}`);
    }
  }
  console.log(`Suggestions rescoped: ${sResc}, deleted (cross-workspace): ${sDel}`);

  // 3) Relationships -> workspace of their endpoints (same cross-workspace rule).
  const rels = await p.relationship.findMany({ select: { id: true, fromId: true, toId: true } });
  let rResc = 0, rDel = 0;
  for (const r of rels) {
    const [f, t] = await Promise.all([
      p.contact.findUnique({ where: { id: r.fromId }, select: { workspaceId: true } }),
      p.contact.findUnique({ where: { id: r.toId }, select: { workspaceId: true } }),
    ]);
    if (f?.workspaceId && f.workspaceId === t?.workspaceId) {
      await p.relationship.update({ where: { id: r.id }, data: { workspaceId: f.workspaceId } });
      rResc++;
    } else {
      await p.relationship.delete({ where: { id: r.id } });
      rDel++;
      console.log(`  deleted cross-workspace relationship ${r.id}`);
    }
  }
  console.log(`Relationships rescoped: ${rResc}, deleted (cross-workspace): ${rDel}`);

  console.log("Done. Each account now resolves to its own private workspace. ✅");
} catch (e) {
  console.error("FAILED:", e.message?.split("\n")[0] ?? e);
  process.exit(1);
} finally {
  await p.$disconnect();
}
