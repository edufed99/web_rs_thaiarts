import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from "typeorm";

export class AddBilingualCatalogueColumns1787400000000 implements MigrationInterface {
  // fallow-ignore-next-line unused-class-member -- TypeORM invokes this dynamically.
  name = "AddBilingualCatalogueColumns1787400000000";

  // fallow-ignore-next-line unused-class-member -- TypeORM invokes this dynamically.
  async up(queryRunner: QueryRunner): Promise<void> {
    // items
    if (!(await queryRunner.hasColumn("items", "name_en"))) {
      await queryRunner.addColumn(
        "items",
        new TableColumn({ name: "name_en", type: "varchar", length: "255", isNullable: true }),
      );
    }
    const itemsTable = await queryRunner.getTable("items");
    const hasNameEnIndex = itemsTable?.indices.some((idx) => idx.name === "ix_items_name_en");
    if (!hasNameEnIndex) {
      await queryRunner.createIndex(
        "items",
        new TableIndex({ name: "ix_items_name_en", columnNames: ["name_en"] }),
      );
    }
    if (!(await queryRunner.hasColumn("items", "description_en"))) {
      await queryRunner.addColumn(
        "items",
        new TableColumn({ name: "description_en", type: "text", isNullable: true }),
      );
    }
    if (!(await queryRunner.hasColumn("items", "category_group_en"))) {
      await queryRunner.addColumn(
        "items",
        new TableColumn({ name: "category_group_en", type: "varchar", length: "255", isNullable: true }),
      );
    }
    if (!(await queryRunner.hasColumn("items", "performance_type_en"))) {
      await queryRunner.addColumn(
        "items",
        new TableColumn({ name: "performance_type_en", type: "varchar", length: "255", isNullable: true }),
      );
    }

    // contexts
    if (!(await queryRunner.hasColumn("contexts", "name_en"))) {
      await queryRunner.addColumn(
        "contexts",
        new TableColumn({ name: "name_en", type: "varchar", length: "255", isNullable: true }),
      );
    }
    if (!(await queryRunner.hasColumn("contexts", "description_en"))) {
      await queryRunner.addColumn(
        "contexts",
        new TableColumn({ name: "description_en", type: "text", isNullable: true }),
      );
    }

    // keywords
    if (!(await queryRunner.hasColumn("keywords", "name_en"))) {
      await queryRunner.addColumn(
        "keywords",
        new TableColumn({ name: "name_en", type: "varchar", length: "255", isNullable: true }),
      );
    }

    // taxonomy_nodes
    if (!(await queryRunner.hasColumn("taxonomy_nodes", "name_en"))) {
      await queryRunner.addColumn(
        "taxonomy_nodes",
        new TableColumn({ name: "name_en", type: "varchar", length: "255", isNullable: true }),
      );
    }
  }

  // fallow-ignore-next-line unused-class-member -- TypeORM invokes this dynamically.
  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable("items")) {
      const itemsTable = await queryRunner.getTable("items");
      const hasIndex = itemsTable?.indices.some((idx) => idx.name === "ix_items_name_en");
      if (hasIndex) {
        await queryRunner.dropIndex("items", "ix_items_name_en");
      }
      if (await queryRunner.hasColumn("items", "performance_type_en")) {
        await queryRunner.dropColumn("items", "performance_type_en");
      }
      if (await queryRunner.hasColumn("items", "category_group_en")) {
        await queryRunner.dropColumn("items", "category_group_en");
      }
      if (await queryRunner.hasColumn("items", "description_en")) {
        await queryRunner.dropColumn("items", "description_en");
      }
      if (await queryRunner.hasColumn("items", "name_en")) {
        await queryRunner.dropColumn("items", "name_en");
      }
    }
    if (await queryRunner.hasTable("contexts")) {
      if (await queryRunner.hasColumn("contexts", "description_en")) {
        await queryRunner.dropColumn("contexts", "description_en");
      }
      if (await queryRunner.hasColumn("contexts", "name_en")) {
        await queryRunner.dropColumn("contexts", "name_en");
      }
    }
    if (await queryRunner.hasTable("keywords") && (await queryRunner.hasColumn("keywords", "name_en"))) {
      await queryRunner.dropColumn("keywords", "name_en");
    }
    if (await queryRunner.hasTable("taxonomy_nodes") && (await queryRunner.hasColumn("taxonomy_nodes", "name_en"))) {
      await queryRunner.dropColumn("taxonomy_nodes", "name_en");
    }
  }
}
