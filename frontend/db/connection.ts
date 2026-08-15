import type { DataSource } from "typeorm";

import { createAppDataSource } from "./data-source";

const globalForDataSource = globalThis as typeof globalThis & {
  applicationDataSource?: Promise<DataSource>;
};

export function getDataSource(): Promise<DataSource> {
  if (!globalForDataSource.applicationDataSource) {
    const dataSource = createAppDataSource();
    globalForDataSource.applicationDataSource = dataSource.initialize().catch((error) => {
      globalForDataSource.applicationDataSource = undefined;
      throw error;
    });
  }
  return globalForDataSource.applicationDataSource;
}
