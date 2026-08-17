import { MigrationInterface, QueryRunner, Table } from "typeorm";

export class CreateApplicationStatus1723708800000 implements MigrationInterface {
  // fallow-ignore-next-line unused-class-member -- TypeORM invokes this dynamically.
  name = "CreateApplicationStatus1723708800000";

  // fallow-ignore-next-line unused-class-member -- TypeORM invokes this dynamically.
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "application_status",
        columns: [
          { name: "key", type: "varchar", length: "64", isPrimary: true },
          { name: "value", type: "varchar", length: "255" },
          { name: "updated_at", type: "timestamptz", default: "CURRENT_TIMESTAMP" },
        ],
      }),
    );
  }

  // fallow-ignore-next-line unused-class-member -- TypeORM invokes this dynamically.
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("application_status");
  }
}
