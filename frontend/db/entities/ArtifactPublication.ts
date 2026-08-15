import { EntitySchema } from "typeorm";

/**
 * One successful Artifact Publication (issue #8).
 *
 * Records the build identity the Private Model Service reported when the
 * publication executed, the number of catalogue items whose content that
 * build now covers, the acting admin, and an optional note. Rows are
 * append-only: the latest row is the active published build.
 */
export interface ArtifactPublication {
  id: number;
  buildId: string;
  publishedAt: Date;
  itemCount: number;
  createdBy: number;
  note: string;
}

export const ArtifactPublicationEntity = new EntitySchema<ArtifactPublication>({
  name: "ArtifactPublication",
  tableName: "artifact_publications",
  columns: {
    id: { type: "bigint", primary: true, generated: "increment" },
    buildId: { name: "build_id", type: String, length: 64 },
    publishedAt: { name: "published_at", type: "timestamptz", createDate: true },
    itemCount: { name: "item_count", type: "int" },
    createdBy: { name: "created_by", type: "bigint" },
    note: { type: String, length: 255, default: "" },
  },
});
