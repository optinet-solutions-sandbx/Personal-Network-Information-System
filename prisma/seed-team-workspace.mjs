// One-time setup for the shared team workspace (Phase 3 / data sharing).
// Idempotent — safe to re-run.
//
//   node prisma/seed-team-workspace.mjs
//
// Creates a single shared "Optinet Team" workspace, enrolls every
// @optinetsolutions.com auth user as a member (admin@ = owner), and moves ALL
// existing contacts / suggestions / relationships into that workspace so the
// whole team sees the same data. Run AFTER the workspace-scope migration.

import { PrismaClient } from "@prisma/client";

// SAFETY: this script SHARES all contacts across every teammate. The app now
// scopes each account to its own private workspace by default (see
// lib/workspace.ts / prisma/migrate-personal-workspaces.mjs). Running this again
// would undo that isolation, so it refuses unless explicitly confirmed:
//   CONFIRM_TEAM_SHARE=yes node prisma/seed-team-workspace.mjs
if (process.env.CONFIRM_TEAM_SHARE !== "yes") {
  console.error(
    "Refusing to run: this re-shares ALL contacts across the team and overrides\n" +
      "per-account isolation. Re-run with CONFIRM_TEAM_SHARE=yes if that is intended."
  );
  process.exit(1);
}

const p = new PrismaClient();
const TEAM_NAME = "Optinet Team";
const OWNER_EMAIL = "admin@optinetsolutions.com";
const MEMBER_DOMAIN = "@optinetsolutions.com";

try {
  const users = await p.$queryRawUnsafe(
    `select id, email, coalesce(raw_user_meta_data->>'name', '') as name
     from auth.users where email like '%${MEMBER_DOMAIN}' order by created_at asc`
  );
  if (users.length === 0) throw new Error(`no ${MEMBER_DOMAIN} users found in auth.users`);

  // 1) The shared workspace (find by name+type so re-runs don't duplicate it).
  let ws = await p.workspace.findFirst({ where: { name: TEAM_NAME, type: "team" } });
  if (!ws) ws = await p.workspace.create({ data: { name: TEAM_NAME, type: "team" } });
  console.log(`Workspace: ${ws.name} (${ws.id})`);

  // 2) public.User rows + memberships (admin = owner, others = member).
  for (const u of users) {
    await p.user.upsert({
      where: { id: u.id },
      update: { email: u.email, name: u.name || null },
      create: { id: u.id, email: u.email, name: u.name || null },
    });
    const role = u.email === OWNER_EMAIL ? "owner" : "member";
    await p.workspaceMember.upsert({
      where: { userId_workspaceId: { userId: u.id, workspaceId: ws.id } },
      update: { role },
      create: { userId: u.id, workspaceId: ws.id, role },
    });
    console.log(`  member: ${u.email} (${role})`);
  }

  // 3) Move all existing data into the shared workspace.
  const c = await p.contact.updateMany({ data: { workspaceId: ws.id } });
  const s = await p.suggestion.updateMany({ data: { workspaceId: ws.id } });
  const r = await p.relationship.updateMany({ data: { workspaceId: ws.id } });
  console.log(`Backfilled → ${c.count} contacts, ${s.count} suggestions, ${r.count} relationships`);
  console.log("Shared team workspace ready. ✅");
} catch (e) {
  console.error("FAILED:", e.message.split("\n")[0]);
  process.exit(1);
} finally {
  await p.$disconnect();
}
