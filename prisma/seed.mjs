import { PrismaClient } from "@prisma/client";
import { contacts } from "./contacts-data.mjs";

const prisma = new PrismaClient();

async function main() {
  for (const { notes, profileOnReset: _ignore, ...data } of contacts) {
    const existing = await prisma.contact.findFirst({
      where: { name: data.name },
    });
    if (existing) continue;
    await prisma.contact.create({
      data: {
        ...data,
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
