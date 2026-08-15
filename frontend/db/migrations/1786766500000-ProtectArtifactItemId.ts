import type { MigrationInterface, QueryRunner } from "typeorm";

export class ProtectArtifactItemId1786766500000 implements MigrationInterface {
  // fallow-ignore-next-line unused-class-member -- TypeORM invokes this dynamically.
  name = "ProtectArtifactItemId1786766500000";

  // fallow-ignore-next-line unused-class-member -- TypeORM invokes this dynamically.
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE FUNCTION reject_items_artifact_item_id_update()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.artifact_item_id IS DISTINCT FROM OLD.artifact_item_id THEN
          RAISE EXCEPTION 'items.artifact_item_id is immutable once assigned'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_items_artifact_item_id_immutable
      BEFORE UPDATE OF artifact_item_id ON items
      FOR EACH ROW
      EXECUTE FUNCTION reject_items_artifact_item_id_update()
    `);
  }

  // fallow-ignore-next-line unused-class-member -- TypeORM invokes this dynamically.
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DROP TRIGGER trg_items_artifact_item_id_immutable ON items",
    );
    await queryRunner.query("DROP FUNCTION reject_items_artifact_item_id_update() ");
  }
}
