import type { DataSource } from "typeorm";

import { ApplicationStatusEntity } from "../entities/ApplicationStatus";

export async function seedApplicationStatus(dataSource: DataSource): Promise<void> {
  await dataSource.getRepository(ApplicationStatusEntity).upsert(
    { key: "database", value: "ready", updatedAt: new Date() },
    ["key"],
  );
}
