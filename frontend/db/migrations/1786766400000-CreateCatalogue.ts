import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
  TableUnique,
} from "typeorm";

export class CreateCatalogue1786766400000 implements MigrationInterface {
  // fallow-ignore-next-line unused-class-member -- TypeORM invokes this dynamically.
  name = "CreateCatalogue1786766400000";

  // fallow-ignore-next-line unused-class-member -- TypeORM invokes this dynamically.
  async up(queryRunner: QueryRunner): Promise<void> {
    await this.createContexts(queryRunner);
    await this.createTaxonomy(queryRunner);
    await this.createKeywords(queryRunner);
    await this.createItems(queryRunner);
    await this.createItemContexts(queryRunner);
    await this.createItemKeywords(queryRunner);
  }

  private async createContexts(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable("contexts")) return;
    await queryRunner.createTable(
      new Table({
        name: "contexts",
        columns: [
          { name: "id", type: "bigserial", isPrimary: true },
          { name: "name", type: "varchar", length: "255", isNullable: false, isUnique: true },
          { name: "group_name", type: "varchar", length: "255", default: "''" },
          { name: "description", type: "text", default: "''" },
        ],
      }),
    );
  }

  private async createTaxonomy(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable("taxonomy_nodes")) return;
    await queryRunner.createTable(
      new Table({
        name: "taxonomy_nodes",
        columns: [
          { name: "id", type: "bigserial", isPrimary: true },
          { name: "name", type: "varchar", length: "255" },
          { name: "level", type: "smallint" },
          { name: "parent_id", type: "bigint", isNullable: true },
        ],
        foreignKeys: [
          new TableForeignKey({
            columnNames: ["parent_id"],
            referencedTableName: "taxonomy_nodes",
            referencedColumnNames: ["id"],
            onDelete: "SET NULL",
          }),
        ],
      }),
    );
  }

  private async createKeywords(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable("keywords")) return;
    await queryRunner.createTable(
      new Table({
        name: "keywords",
        columns: [
          { name: "id", type: "bigserial", isPrimary: true },
          { name: "name", type: "varchar", length: "255", isUnique: true },
          { name: "taxonomy_node_id", type: "bigint", isNullable: true },
        ],
        foreignKeys: [
          new TableForeignKey({
            columnNames: ["taxonomy_node_id"],
            referencedTableName: "taxonomy_nodes",
            referencedColumnNames: ["id"],
            onDelete: "SET NULL",
          }),
        ],
      }),
    );
  }

  private async createItems(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable("items")) return;
    await queryRunner.createTable(
      new Table({
        name: "items",
        columns: [
          { name: "id", type: "bigserial", isPrimary: true },
          { name: "artifact_item_id", type: "bigint" },
          { name: "name", type: "varchar", length: "255", isUnique: true },
          { name: "description", type: "text", default: "''" },
          { name: "category_group", type: "varchar", length: "255", default: "''" },
          { name: "performance_type", type: "varchar", length: "255", default: "''" },
          { name: "performers_count", type: "bigint", isNullable: true },
          { name: "duration_minutes", type: "bigint", isNullable: true },
          { name: "price_text", type: "varchar", length: "255", default: "''" },
          { name: "image_url", type: "varchar", length: "500", default: "''" },
          { name: "video_url", type: "varchar", length: "500", default: "''" },
          { name: "is_active", type: "boolean", default: "true" },
        ],
        uniques: [
          new TableUnique({
            name: "uq_items_artifact_item_id",
            columnNames: ["artifact_item_id"],
          }),
        ],
        indices: [
          new TableIndex({
            name: "ix_items_artifact_item_id",
            columnNames: ["artifact_item_id"],
            isUnique: true,
          }),
        ],
      }),
    );
  }

  private async createItemContexts(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable("item_contexts")) return;
    await queryRunner.createTable(
      new Table({
        name: "item_contexts",
        columns: [
          { name: "id", type: "bigserial", isPrimary: true },
          { name: "item_id", type: "bigint" },
          { name: "context_id", type: "bigint" },
          { name: "validity_status", type: "varchar", length: "30", default: "'valid'" },
        ],
        foreignKeys: [
          new TableForeignKey({
            columnNames: ["item_id"],
            referencedTableName: "items",
            referencedColumnNames: ["id"],
            onDelete: "CASCADE",
          }),
          new TableForeignKey({
            columnNames: ["context_id"],
            referencedTableName: "contexts",
            referencedColumnNames: ["id"],
            onDelete: "CASCADE",
          }),
        ],
      }),
    );
  }

  private async createItemKeywords(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable("item_keywords")) return;
    await queryRunner.createTable(
      new Table({
        name: "item_keywords",
        columns: [
          { name: "id", type: "bigserial", isPrimary: true },
          { name: "item_id", type: "bigint" },
          { name: "keyword_id", type: "bigint" },
          { name: "source", type: "varchar", length: "100", default: "''" },
        ],
        foreignKeys: [
          new TableForeignKey({
            columnNames: ["item_id"],
            referencedTableName: "items",
            referencedColumnNames: ["id"],
            onDelete: "CASCADE",
          }),
          new TableForeignKey({
            columnNames: ["keyword_id"],
            referencedTableName: "keywords",
            referencedColumnNames: ["id"],
            onDelete: "CASCADE",
          }),
        ],
      }),
    );
  }

  // fallow-ignore-next-line unused-class-member -- TypeORM invokes this dynamically.
  async down(queryRunner: QueryRunner): Promise<void> {
    // A database adopted from the historical FastAPI/Alembic deployment owns
    // these pre-existing tables and must never lose them during a TypeORM
    // rollback. Clean TypeORM-created development databases have no Alembic
    // marker and can be reversed normally.
    if (await queryRunner.hasTable("alembic_version")) return;
    for (const table of [
      "item_keywords",
      "item_contexts",
      "items",
      "keywords",
      "taxonomy_nodes",
      "contexts",
    ]) {
      if (await queryRunner.hasTable(table)) await queryRunner.dropTable(table);
    }
  }
}
