import { prisma } from "../src/client";

// Idempotent seed: create the singleton Settings + SystemConfiguration rows
// with conservative v1 defaults. Trading starts DISABLED.
async function main() {
  await prisma.settings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" }, // defaults: 0.5% risk, 1 position, 3/day, 16 bps
  });
  await prisma.systemConfiguration.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" }, // tradingEnabled = false
  });
  console.log("Seed complete: settings + system_configuration ready (trading DISABLED).");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
