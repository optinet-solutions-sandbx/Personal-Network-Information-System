import { PrismaClient } from "@prisma/client";
import { contacts } from "./contacts-data.mjs";

const prisma = new PrismaClient();

// When auth is enabled, set SEED_USER_ID to your Supabase user id so the demo
// contacts are owned by (and visible to) your account. Left unset = open mode.
const SEED_USER_ID = process.env.SEED_USER_ID || null;

async function main() {
  for (const { notes, profileOnReset: _ignore, ...data } of contacts) {
    const existing = await prisma.contact.findFirst({
      where: { name: data.name },
    });
    if (existing) continue;
    await prisma.contact.create({
      data: {
        ...data,
        userId: SEED_USER_ID,
        notes: { create: notes.map((content) => ({ content })) },
      },
    });
    console.log("Seeded:", data.name);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
