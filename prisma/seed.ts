import { prisma } from "../src/db/prisma";
import { configDefaults } from "../src/config/ConfigService";

// Fixed demo fixture ids, matched by src/simulator/simulatedDevice.ts
// defaults - lets `npm run prisma:seed && npm run dev && npm run simulate`
// produce a working end-to-end pipeline with zero extra configuration.
export const DEMO_USER_ID = "demo-user-001";
export const DEMO_FARM_ID = "demo-farm-001";
export const DEMO_DEVICE_ID = "sim-device-001";
export const DEMO_HMAC_SECRET = "dev-only-demo-secret-change-me";

async function main() {
  for (const [key, { value, description }] of Object.entries(configDefaults)) {
    await prisma.systemConfig.upsert({
      where: { key },
      update: {}, // never overwrite a value someone already tuned - seed only fills gaps
      create: { key, value: value as any, description, updatedBy: "seed" },
    });
  }
  console.log(`Seeded ${Object.keys(configDefaults).length} config key(s) (existing values left untouched).`);

  await prisma.user.upsert({
    where: { id: DEMO_USER_ID },
    update: {},
    create: { id: DEMO_USER_ID, name: "Demo Farmer" },
  });
  await prisma.farm.upsert({
    where: { id: DEMO_FARM_ID },
    update: {},
    create: { id: DEMO_FARM_ID, ownerUserId: DEMO_USER_ID, name: "Demo Farm" },
  });
  await prisma.device.upsert({
    where: { id: DEMO_DEVICE_ID },
    update: {},
    create: {
      id: DEMO_DEVICE_ID,
      farmId: DEMO_FARM_ID,
      name: "Demo Motor Controller",
      hmacSecretRef: DEMO_HMAC_SECRET,
    },
  });
  console.log(`Seeded demo fixtures: user=${DEMO_USER_ID} farm=${DEMO_FARM_ID} device=${DEMO_DEVICE_ID}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
