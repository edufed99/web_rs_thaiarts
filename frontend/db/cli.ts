import { migrateAndSeed } from "./bootstrap";
import { createAppDataSource } from "./data-source";
import { seedApplicationStatus } from "./seeds/application-status.seed";

const command = process.argv[2];
const dataSource = createAppDataSource();

function assertResetIsAllowed(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Database rebuild is disabled in production");
  }
  if (process.env.ALLOW_DATABASE_RESET !== "1") {
    throw new Error("Set ALLOW_DATABASE_RESET=1 to rebuild a development database");
  }
}

async function main(): Promise<void> {
  await dataSource.initialize();
  try {
    const commands: Record<string, () => Promise<void>> = {
      "migration:run": async () => {
        await dataSource.runMigrations({ transaction: "all" });
      },
      "migration:revert": async () => {
        await dataSource.undoLastMigration({ transaction: "all" });
      },
      "migration:show": async () => {
        process.stdout.write((await dataSource.showMigrations()) ? "pending\n" : "current\n");
      },
      // Release gate (issue #11): exits non-zero while any migration is
      // pending, so the pre-release procedure can fail closed instead of
      // routing public traffic to an unverified schema.
      "migration:verify": async () => {
        if (await dataSource.showMigrations()) {
          throw new Error("Pending migrations detected — run migration:run before release.");
        }
        process.stdout.write("current\n");
      },
      seed: async () => {
        await seedApplicationStatus(dataSource);
      },
      rebuild: async () => {
        assertResetIsAllowed();
        await dataSource.dropDatabase();
        await migrateAndSeed(dataSource);
      },
    };
    const run = command ? commands[command] : undefined;
    if (!run) {
      throw new Error(
        "Usage: tsx db/cli.ts <migration:run|migration:revert|migration:show|migration:verify|seed|rebuild>",
      );
    }
    await run();
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
