import type { MigrationInterface, QueryRunner } from "typeorm";

export class FixAyutthayaPerformanceType1787300000000 implements MigrationInterface {
  // fallow-ignore-next-line unused-class-member -- TypeORM invokes this dynamically.
  name = "FixAyutthayaPerformanceType1787300000000";

  // fallow-ignore-next-line unused-class-member -- TypeORM invokes this dynamically.
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE items
      SET performance_type = 'การแสดง ระบำ รำ ฟ้อน'
      WHERE name = 'ระบำอยุธยา' AND performance_type = 'การแสดงสร้างสรรค์'
    `);
  }

  // fallow-ignore-next-line unused-class-member -- TypeORM invokes this dynamically.
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE items
      SET performance_type = 'การแสดงสร้างสรรค์'
      WHERE name = 'ระบำอยุธยา' AND performance_type = 'การแสดง ระบำ รำ ฟ้อน'
    `);
  }
}
