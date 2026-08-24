import "reflect-metadata";
import "pg";

import { DataSource } from "typeorm";

import { ApplicationStatusEntity } from "./entities/ApplicationStatus";
import { ArtifactPublicationEntity } from "./entities/ArtifactPublication";
import { catalogueEntities } from "./entities/Catalogue";
import { memberEntities } from "./entities/Members";
import { CreateApplicationStatus1723708800000 } from "./migrations/1723708800000-CreateApplicationStatus";
import { CreateCatalogue1786766400000 } from "./migrations/1786766400000-CreateCatalogue";
import { ProtectArtifactItemId1786766500000 } from "./migrations/1786766500000-ProtectArtifactItemId";
import { CreateMembersAndSessions1786939200000 } from "./migrations/1786939200000-CreateMembersAndSessions";
import { CreateRecommendationRequests1787025600000 } from "./migrations/1787025600000-CreateRecommendationRequests";
import { RecommendationRequestEntity, RecommendationRequestSelectedKeywordEntity, RecommendationResultEntity } from "./entities/RecommendationRequests";
import { AddArtifactPublication1787100000000 } from "./migrations/1787100000000-AddArtifactPublication";
import { CreatePasswordResetTokens1787200000000 } from "./migrations/1787200000000-CreatePasswordResetTokens";
import { FixAyutthayaPerformanceType1787300000000 } from "./migrations/1787300000000-FixAyutthayaPerformanceType";

export function createAppDataSource(databaseUrl = process.env.DATABASE_URL): DataSource {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required by the Next.js Application Backend");
  }

  return new DataSource({
    type: "postgres",
    url: databaseUrl,
    synchronize: false,
    migrationsRun: false,
    migrationsTableName: "typeorm_migrations",
    entities: [
      ApplicationStatusEntity,
      ArtifactPublicationEntity,
      ...catalogueEntities,
      ...memberEntities,
      RecommendationRequestEntity,
      RecommendationRequestSelectedKeywordEntity,
      RecommendationResultEntity,
    ],
    migrations: [
      CreateApplicationStatus1723708800000,
      CreateCatalogue1786766400000,
      ProtectArtifactItemId1786766500000,
      CreateMembersAndSessions1786939200000,
      CreateRecommendationRequests1787025600000,
      AddArtifactPublication1787100000000,
      CreatePasswordResetTokens1787200000000,
      FixAyutthayaPerformanceType1787300000000,
    ],
    logging: process.env.TYPEORM_LOGGING === "1",
  });
}
