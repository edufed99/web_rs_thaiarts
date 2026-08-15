import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableColumn,
  TableForeignKey,
  TableIndex,
  TableUnique,
} from "typeorm";

/**
 * Recommendation request/result analytics owned by the Application Backend.
 *
 * Adopts the legacy Alembic 0006 table shapes when they already exist (the
 * staged-migration database is shared with the compatibility FastAPI), and
 * creates them fresh for brand-new databases. Fresh creation also restores
 * the ``interaction_logs.recommendation_request_id`` FK the legacy revision
 * added, so view-attribution telemetry keeps its referential integrity.
 */
export class CreateRecommendationRequests1787025600000 implements MigrationInterface {
  // fallow-ignore-next-line unused-class-member -- TypeORM invokes this dynamically.
  name = "CreateRecommendationRequests1787025600000";

  // fallow-ignore-next-line unused-class-member, complexity -- Adopted Alembic schemas skip creation; fresh databases create the legacy 0006 shape.
  async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable("recommendation_requests")) return;

    await queryRunner.createTable(
      new Table({
        name: "recommendation_requests",
        columns: [
          { name: "id", type: "bigserial", isPrimary: true },
          { name: "user_id", type: "bigint", isNullable: true },
          { name: "selected_context_id", type: "bigint" },
          { name: "candidate_count", type: "int" },
          { name: "top_k", type: "int" },
          { name: "method", type: "varchar", length: "80" },
          { name: "metadata_json", type: "text", default: "''" },
          { name: "created_at", type: "timestamptz", default: "CURRENT_TIMESTAMP" },
        ],
        foreignKeys: [
          new TableForeignKey({
            name: "recommendation_requests_user_id_fkey",
            columnNames: ["user_id"],
            referencedTableName: "users",
            referencedColumnNames: ["id"],
            onDelete: "SET NULL",
          }),
          new TableForeignKey({
            name: "recommendation_requests_ctx_fkey",
            columnNames: ["selected_context_id"],
            referencedTableName: "contexts",
            referencedColumnNames: ["id"],
            onDelete: "RESTRICT",
          }),
        ],
        indices: [
          new TableIndex({
            name: "ix_recommendation_requests_user_id",
            columnNames: ["user_id"],
          }),
          new TableIndex({
            name: "ix_recommendation_requests_created_at",
            columnNames: ["created_at"],
          }),
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "recommendation_request_selected_keywords",
        columns: [
          { name: "id", type: "bigserial", isPrimary: true },
          { name: "request_id", type: "bigint" },
          { name: "keyword_id", type: "bigint" },
        ],
        uniques: [
          new TableUnique({
            name: "uq_rsk_request_keyword",
            columnNames: ["request_id", "keyword_id"],
          }),
        ],
        foreignKeys: [
          new TableForeignKey({
            name: "rsk_request_fkey",
            columnNames: ["request_id"],
            referencedTableName: "recommendation_requests",
            referencedColumnNames: ["id"],
            onDelete: "CASCADE",
          }),
          new TableForeignKey({
            name: "rsk_keyword_fkey",
            columnNames: ["keyword_id"],
            referencedTableName: "keywords",
            referencedColumnNames: ["id"],
            onDelete: "CASCADE",
          }),
        ],
        indices: [
          new TableIndex({ name: "ix_rsk_request_id", columnNames: ["request_id"] }),
          new TableIndex({ name: "ix_rsk_keyword_id", columnNames: ["keyword_id"] }),
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "recommendation_results",
        columns: [
          { name: "id", type: "bigserial", isPrimary: true },
          { name: "request_id", type: "bigint" },
          { name: "item_id", type: "bigint" },
          { name: "rank", type: "int" },
          { name: "cbf_score", type: "float" },
          { name: "cf_score", type: "float" },
          { name: "hybrid_score", type: "float" },
          { name: "is_context_valid", type: "boolean", default: "true" },
          { name: "matched_keywords_json", type: "text", default: "'[]'" },
          { name: "explanation", type: "text", default: "''" },
        ],
        uniques: [
          new TableUnique({
            name: "uq_rr_request_item",
            columnNames: ["request_id", "item_id"],
          }),
          new TableUnique({
            name: "uq_rr_request_rank",
            columnNames: ["request_id", "rank"],
          }),
        ],
        foreignKeys: [
          new TableForeignKey({
            name: "rr_request_fkey",
            columnNames: ["request_id"],
            referencedTableName: "recommendation_requests",
            referencedColumnNames: ["id"],
            onDelete: "CASCADE",
          }),
          new TableForeignKey({
            name: "rr_item_fkey",
            columnNames: ["item_id"],
            referencedTableName: "items",
            referencedColumnNames: ["id"],
            onDelete: "CASCADE",
          }),
        ],
        indices: [
          new TableIndex({ name: "ix_rr_request_id", columnNames: ["request_id"] }),
          new TableIndex({ name: "ix_rr_item_id", columnNames: ["item_id"] }),
        ],
      }),
    );

    // interaction_logs.recommendation_request_id (FK → recommendation_requests).
    // The members migration already creates the column; add the FK + index to
    // match the legacy 0006 shape on fresh databases.
    const hadColumn = await queryRunner.hasColumn(
      "interaction_logs",
      "recommendation_request_id",
    );
    if (!hadColumn) {
      await queryRunner.addColumn(
        "interaction_logs",
        new TableColumn({
          name: "recommendation_request_id",
          type: "bigint",
          isNullable: true,
        }),
      );
    }
    const existingFk = await queryRunner.query(
      `SELECT 1 FROM information_schema.table_constraints
       WHERE constraint_name = 'interaction_logs_request_id_fkey' AND table_name = 'interaction_logs'`,
    );
    if (existingFk.length === 0) {
      await queryRunner.createForeignKey(
        "interaction_logs",
        new TableForeignKey({
          name: "interaction_logs_request_id_fkey",
          columnNames: ["recommendation_request_id"],
          referencedTableName: "recommendation_requests",
          referencedColumnNames: ["id"],
          onDelete: "SET NULL",
        }),
      );
    }
    const existingIndex = await queryRunner.query(
      `SELECT 1 FROM pg_indexes WHERE indexname = 'ix_interaction_logs_request_id'`,
    );
    if (existingIndex.length === 0) {
      await queryRunner.createIndex(
        "interaction_logs",
        new TableIndex({
          name: "ix_interaction_logs_request_id",
          columnNames: ["recommendation_request_id"],
        }),
      );
    }
  }

  // fallow-ignore-next-line unused-class-member, complexity -- TypeORM invokes rollback dynamically; each drop is guarded against adopted schemas.
  async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable("recommendation_requests"))) return;
    if (await queryRunner.hasColumn("interaction_logs", "recommendation_request_id")) {
      const existingFk = await queryRunner.query(
        `SELECT 1 FROM information_schema.table_constraints
         WHERE constraint_name = 'interaction_logs_request_id_fkey' AND table_name = 'interaction_logs'`,
      );
      if (existingFk.length > 0) {
        await queryRunner.dropForeignKey("interaction_logs", "interaction_logs_request_id_fkey");
      }
      const existingIndex = await queryRunner.query(
        `SELECT 1 FROM pg_indexes WHERE indexname = 'ix_interaction_logs_request_id'`,
      );
      if (existingIndex.length > 0) {
        await queryRunner.dropIndex("interaction_logs", "ix_interaction_logs_request_id");
      }
    }
    await queryRunner.dropTable("recommendation_results");
    await queryRunner.dropTable("recommendation_request_selected_keywords");
    await queryRunner.dropTable("recommendation_requests");
  }
}
