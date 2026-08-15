import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex, TableUnique } from "typeorm";

export class CreateMembersAndSessions1786939200000 implements MigrationInterface {
  // fallow-ignore-next-line unused-class-member -- TypeORM invokes this dynamically.
  name = "CreateMembersAndSessions1786939200000";

  // fallow-ignore-next-line unused-class-member -- TypeORM invokes this dynamically.
  async up(queryRunner: QueryRunner): Promise<void> {
    await this.users(queryRunner);
    await this.profiles(queryRunner);
    await this.sessions(queryRunner);
    await this.stateTable(queryRunner, "likes", "uq_likes_user_item", "ix_likes_user_key");
    await this.stateTable(queryRunner, "saved_items", "uq_saved_items_user_item", "ix_saved_items_user_key");
    await this.ratings(queryRunner);
    await this.interactions(queryRunner);
  }

  private async users(q: QueryRunner): Promise<void> {
    if (await q.hasTable("users")) return;
    await q.createTable(new Table({ name: "users", columns: [
      { name: "id", type: "bigserial", isPrimary: true },
      { name: "username", type: "varchar", length: "120", isUnique: true },
      { name: "email", type: "varchar", length: "320", default: "''" },
      { name: "password_hash", type: "varchar", length: "255" },
      { name: "google_subject_id", type: "varchar", length: "255", isNullable: true, isUnique: true },
      { name: "auth_provider", type: "varchar", length: "32", default: "'password'" },
      { name: "email_verified", type: "boolean", default: "false" },
      { name: "display_name", type: "varchar", length: "120", default: "''" },
      { name: "is_admin", type: "boolean", default: "false" },
      { name: "created_at", type: "timestamptz", default: "CURRENT_TIMESTAMP" },
      { name: "last_login_at", type: "timestamptz", isNullable: true },
    ] }));
  }

  private async profiles(q: QueryRunner): Promise<void> {
    if (await q.hasTable("accounts_userprofile")) return;
    await q.createTable(new Table({ name: "accounts_userprofile", columns: [
      { name: "id", type: "bigserial", isPrimary: true },
      { name: "user_id", type: "bigint", isUnique: true },
      { name: "display_name", type: "varchar", length: "150", default: "''" },
      { name: "role", type: "varchar", length: "20", default: "'user'" },
      { name: "user_group", type: "varchar", length: "100", default: "'user'" },
      { name: "experience_level", type: "varchar", length: "20", default: "'none'" },
      { name: "avatar_url", type: "text", default: "''" },
      { name: "bio", type: "text", default: "''" },
      { name: "consent_accepted", type: "boolean", default: "false" },
      { name: "consent_version", type: "varchar", length: "40", default: "''" },
      { name: "consent_accepted_at", type: "timestamptz", isNullable: true },
      { name: "consent_withdrawn_at", type: "timestamptz", isNullable: true },
      { name: "created_at", type: "timestamptz", default: "CURRENT_TIMESTAMP" },
      { name: "updated_at", type: "timestamptz", default: "CURRENT_TIMESTAMP" },
    ], foreignKeys: [new TableForeignKey({ columnNames: ["user_id"], referencedTableName: "users", referencedColumnNames: ["id"], onDelete: "CASCADE" })] }));
  }

  private async sessions(q: QueryRunner): Promise<void> {
    if (await q.hasTable("user_sessions")) return;
    await q.createTable(new Table({ name: "user_sessions", columns: [
      { name: "id", type: "bigserial", isPrimary: true },
      { name: "user_id", type: "bigint" },
      { name: "token_hash", type: "varchar", length: "64", isUnique: true },
      { name: "expires_at", type: "timestamptz" },
      { name: "created_at", type: "timestamptz", default: "CURRENT_TIMESTAMP" },
      { name: "last_seen_at", type: "timestamptz", default: "CURRENT_TIMESTAMP" },
    ], foreignKeys: [new TableForeignKey({ columnNames: ["user_id"], referencedTableName: "users", referencedColumnNames: ["id"], onDelete: "CASCADE" })], indices: [
      new TableIndex({ name: "ix_user_sessions_user_id", columnNames: ["user_id"] }),
      new TableIndex({ name: "ix_user_sessions_expires_at", columnNames: ["expires_at"] }),
    ] }));
  }

  private async stateTable(q: QueryRunner, name: string, unique: string, index: string): Promise<void> {
    if (await q.hasTable(name)) return;
    await q.createTable(new Table({ name, columns: [
      { name: "id", type: "bigserial", isPrimary: true },
      { name: "user_key", type: "varchar", length: "150" },
      { name: "item_id", type: "bigint" },
      { name: "created_at", type: "timestamptz", default: "CURRENT_TIMESTAMP" },
    ], uniques: [new TableUnique({ name: unique, columnNames: ["user_key", "item_id"] })], indices: [new TableIndex({ name: index, columnNames: ["user_key"] })], foreignKeys: [new TableForeignKey({ columnNames: ["item_id"], referencedTableName: "items", referencedColumnNames: ["id"], onDelete: "CASCADE" })] }));
  }

  private async ratings(q: QueryRunner): Promise<void> {
    if (await q.hasTable("ratings")) return;
    await q.createTable(new Table({ name: "ratings", columns: [
      { name: "id", type: "bigserial", isPrimary: true }, { name: "user_key", type: "varchar", length: "150" },
      { name: "item_id", type: "bigint" }, { name: "rating", type: "smallint" },
      { name: "created_at", type: "timestamptz", default: "CURRENT_TIMESTAMP" }, { name: "updated_at", type: "timestamptz", default: "CURRENT_TIMESTAMP" },
    ], uniques: [new TableUnique({ name: "uq_ratings_user_item", columnNames: ["user_key", "item_id"] })], indices: [new TableIndex({ name: "ix_ratings_user_key", columnNames: ["user_key"] })], foreignKeys: [new TableForeignKey({ columnNames: ["item_id"], referencedTableName: "items", referencedColumnNames: ["id"], onDelete: "CASCADE" })] }));
    await q.query("ALTER TABLE ratings ADD CONSTRAINT ck_ratings_value CHECK (rating BETWEEN 1 AND 5)");
  }

  private async interactions(q: QueryRunner): Promise<void> {
    if (await q.hasTable("interaction_logs")) return;
    await q.createTable(new Table({ name: "interaction_logs", columns: [
      { name: "id", type: "bigserial", isPrimary: true }, { name: "user_key", type: "varchar", length: "150" },
      { name: "item_id", type: "bigint", isNullable: true }, { name: "action_type", type: "varchar", length: "40" },
      { name: "metadata_json", type: "text", default: "''" }, { name: "recommendation_request_id", type: "bigint", isNullable: true },
      { name: "created_at", type: "timestamptz", default: "CURRENT_TIMESTAMP" },
    ], indices: [new TableIndex({ name: "ix_interaction_logs_user_key", columnNames: ["user_key"] }), new TableIndex({ name: "ix_interaction_logs_created_at", columnNames: ["created_at"] })], foreignKeys: [new TableForeignKey({ columnNames: ["item_id"], referencedTableName: "items", referencedColumnNames: ["id"], onDelete: "SET NULL" })] }));
  }

  // fallow-ignore-next-line unused-class-member, complexity -- TypeORM invokes rollback dynamically; table checks protect adopted Alembic schemas.
  async down(q: QueryRunner): Promise<void> {
    if (await q.hasTable("alembic_version")) {
      if (await q.hasTable("user_sessions")) await q.dropTable("user_sessions");
      return;
    }
    for (const table of ["user_sessions", "interaction_logs", "ratings", "saved_items", "likes", "accounts_userprofile", "users"]) {
      if (await q.hasTable(table)) await q.dropTable(table);
    }
  }
}
