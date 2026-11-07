import { prisma } from "../src/db/prisma";
import { configDefaults } from "../src/config/ConfigService";

async function main() {
  for (const [key, { value, description }] of Object.entries(configDefaults)) {
    await prisma.systemConfig.upsert({
      where: { key },
      update: {}, // never overwrite a value someone already tuned - seed only fills gaps
      create: { key, value: value as any, description, updatedBy: "seed" },
    });
  }
  console.log(`Seeded ${Object.keys(configDefaults).length} config key(s) (existing values left untouched).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
