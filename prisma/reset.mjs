// Rehearsal reset: wipes ALL contacts/notes and restores the exact demo starting
// state — 4 contacts, with the three "profileOnReset" contacts pre-profiled and
// Sarah Chen left blank for the live generation moment.
//
// Usage: npm run db:reset   (dev server should be running so profiles can pre-generate)

import { PrismaClient } from "@prisma/client";
import { contacts } from "./contacts-data.mjs";

const prisma = new PrismaClient();
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

async function wipe() {
  // onDelete: Cascade removes notes; delete notes first anyway to be safe.
  await prisma.note.deleteMany({});
  const { count } = await prisma.contact.deleteMany({});
  console.log(`Wiped ${count} contact(s) and all notes.`);
}

async function seed() {
  const created = [];
  for (const { notes, profileOnReset, ...data } of contacts) {
    const c = await prisma.contact.create({
      data: {
        ...data,
        notes: { create: notes.map((content) => ({ content })) },
      },
    });
    created.push({ id: c.id, name: c.name, profileOnReset });
    console.log("Seeded:", c.name);
  }
  return created;
}

async function pregenerate(created) {
  const targets = created.filter((c) => c.profileOnReset);
  let ok = 0;
  for (const c of targets) {
    try {
      const res = await fetch(`${BASE_URL}/api/contacts/${c.id}/profile`, {
        method: "POST",
      });
      if (res.ok) {
        const j = await res.json();
        console.log(`  Profile: ${c.name} -> ${j.profileModel}`);
        ok++;
      } else {
        console.log(`  Profile: ${c.name} -> HTTP ${res.status}`);
      }
    } catch {
      console.log(
        `  Profile: ${c.name} -> SKIPPED (dev server not reachable at ${BASE_URL})`
      );
    }
  }
  return { attempted: targets.length, ok };
}

async function main() {
  console.log("— Networky demo reset —");
  await wipe();
  const created = await seed();
  const { attempted, ok } = await pregenerate(created);

  console.log("\nDone.");
  if (ok < attempted) {
    console.log(
      "Note: some profiles were not generated. Make sure `npm run dev` is running,\n" +
        "then re-run `npm run db:reset` (or generate them live in the UI)."
    );
  } else {
    console.log(
      "State: 4 contacts | Marcus, Priya, David pre-profiled | Sarah blank (generate live)."
    );
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
