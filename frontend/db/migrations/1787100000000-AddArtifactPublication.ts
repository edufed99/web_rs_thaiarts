import { MigrationInterface, QueryRunner, Table, TableForeignKey } from "typeorm";

/**
 * Artifact Publication state (issue #8).
 *
 * The offline pipeline rebuilds artifacts (catalog.parquet + embeddings)
 * from the catalogue; the Private Model Service scores from those
 * artifacts. An explicit Artifact Publication is the workflow that
 * declares which rebuilt build the running model service is serving and
 * when it took effect.
 *
 * Two pieces of state:
 *
 * 1. ``items.published_at`` — timestamptz, nullable, defaults to NOW().
 *    NULL means "this row's content changed after the last publication
 *    and is therefore unavailable to personalized scoring until an
 *    explicit Artifact Publication succeeds". Admin catalogue mutations
 *    set it to NULL; a successful publication restores it to NOW() for
 *    every pending row.
 * 2. ``artifact_publications`` — append-only audit rows. Each successful
 *    publication records the build identity reported by the Private
 *    Model Service, the number of items it covered, the acting admin,
 *    and an optional note.
 */
export class AddArtifactPublication1787100000000 implements MigrationInterface {
  // fallow-ignore-next-line unused-class-member -- TypeORM invokes this dynamically.
  name = "AddArtifactPublication1787100000000";

  // fallow-ignore-next-line unused-class-member -- TypeORM invokes this dynamically.
  async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable("artifact_publications")) return;
    await queryRunner.createTable(
      new Table({
        name: "artifact_publications",
        columns: [
          { name: "id", type: "bigserial", isPrimary: true },
          { name: "build_id", type: "varchar", length: "64", isNullable: false },
          { name: "published_at", type: "timestamptz", default: "CURRENT_TIMESTAMP" },
          { name: "item_count", type: "integer", default: "0" },
          { name: "created_by", type: "bigint", isNullable: false },
          { name: "note", type: "varchar", length: "255", default: "''" },
        ],
        foreignKeys: [
          new TableForeignKey({
            columnNames: ["created_by"],
            referencedTableName: "users",
            referencedColumnNames: ["id"],
            onDelete: "RESTRICT",
          }),
        ],
      }),
    );
    await ensureItemColumn(queryRunner);
    await ensurePublishedIndex(queryRunner);
  }

  // fallow-ignore-next-line unused-class-member -- TypeORM invokes this dynamically.
  async down(queryRunner: QueryRunner): Promise<void> {
    await dropPublishedIndex(queryRunner);
    await dropItemColumn(queryRunner);
    if (await queryRunner.hasTable("artifact_publications")) {
      await queryRunner.dropTable("artifact_publications");
    }
  }
}

async function ensureItemColumn(queryRunner: QueryRunner): Promise<void> {
  if (await queryRunner.hasColumn("items", "published_at")) return;
  await queryRunner.query(
    "ALTER TABLE items ADD COLUMN published_at timestamptz DEFAULT CURRENT_TIMESTAMP",
  );
}

async function ensurePublishedIndex(queryRunner: QueryRunner): Promise<void> {
  if (await indexExists(queryRunner)) return;
  await queryRunner.query("CREATE INDEX ix_items_published_at ON items (published_at)");
}

async function dropPublishedIndex(queryRunner: QueryRunner): Promise<void> {
  if (!(await indexExists(queryRunner))) return;
  await queryRunner.query("DROP INDEX ix_items_published_at");
}

async function dropItemColumn(queryRunner: QueryRunner): Promise<void> {
  if (!(await queryRunner.hasColumn("items", "published_at"))) return;
  await queryRunner.query("ALTER TABLE items DROP COLUMN published_at");
}

async function indexExists(queryRunner: QueryRunner): Promise<boolean> {
  const rows = await queryRunner.query(
    "SELECT 1 FROM pg_indexes WHERE tablename = 'items' AND indexname = 'ix_items_published_at'",
  );
  return Boolean(rows && rows.length > 0);
}
