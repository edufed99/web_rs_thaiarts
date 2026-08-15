import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex, TableUnique } from "typeorm";

/**
 * One-time email recovery tokens for the password-reset flow (issue #6).
 *
 * Only the SHA-256 hash of the raw token is stored; the raw token travels in
 * the reset email and is never persisted. The table already exists on
 * databases adopted from the legacy Alembic history (revision
 * ``0011_email_password_reset``), so creation is guarded like every other
 * TypeORM migration in this project.
 */
export class CreatePasswordResetTokens1787200000000 implements MigrationInterface {
  // fallow-ignore-next-line unused-class-member -- TypeORM invokes this dynamically.
  name = "CreatePasswordResetTokens1787200000000";

  // fallow-ignore-next-line unused-class-member -- TypeORM invokes this dynamically.
  async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable("password_reset_tokens")) return;
    await queryRunner.createTable(new Table({
      name: "password_reset_tokens",
      columns: [
        { name: "id", type: "bigserial", isPrimary: true },
        { name: "user_id", type: "bigint" },
        { name: "token_hash", type: "varchar", length: "64" },
        { name: "expires_at", type: "timestamptz" },
        { name: "used_at", type: "timestamptz", isNullable: true },
        { name: "created_at", type: "timestamptz", default: "CURRENT_TIMESTAMP" },
      ],
      foreignKeys: [new TableForeignKey({
        columnNames: ["user_id"],
        referencedTableName: "users",
        referencedColumnNames: ["id"],
        onDelete: "CASCADE",
      })],
      indices: [
        new TableIndex({ name: "ix_password_reset_tokens_user_id", columnNames: ["user_id"] }),
        new TableIndex({ name: "ix_password_reset_tokens_expires_at", columnNames: ["expires_at"] }),
      ],
      uniques: [new TableUnique({ name: "uq_password_reset_tokens_token_hash", columnNames: ["token_hash"] })],
    }));
  }

  // fallow-ignore-next-line unused-class-member -- TypeORM invokes rollback dynamically.
  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable("password_reset_tokens")) {
      await queryRunner.dropTable("password_reset_tokens");
    }
  }
}
