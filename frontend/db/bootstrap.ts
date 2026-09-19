import type { DataSource } from "typeorm";

import { seedAdminUser } from "./seeds/admin.seed";
import { seedApplicationStatus } from "./seeds/application-status.seed";
import { seedCatalogueBilingual } from "./seeds/catalogue-bilingual.seed";

export async function migrateAndSeed(dataSource: DataSource): Promise<void> {
  await dataSource.runMigrations({ transaction: "all" });
  await seedApplicationStatus(dataSource);
  await seedAdminUser(dataSource);
  await seedCatalogueBilingual(dataSource);
}
