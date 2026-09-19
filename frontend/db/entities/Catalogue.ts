import { EntitySchema } from "typeorm";

export interface CatalogueContext {
  id: number;
  name: string;
  nameEn?: string | null;
  groupName: string;
  description: string;
  descriptionEn?: string | null;
}

export interface TaxonomyNode {
  id: number;
  name: string;
  nameEn?: string | null;
  level: number;
  parentId: number | null;
}

export interface CatalogueKeyword {
  id: number;
  name: string;
  nameEn?: string | null;
  taxonomyNodeId: number | null;
}

export interface CatalogueItem {
  id: number;
  artifactItemId: number;
  name: string;
  nameEn?: string | null;
  description: string;
  descriptionEn?: string | null;
  categoryGroup: string;
  categoryGroupEn?: string | null;
  performanceType: string;
  performanceTypeEn?: string | null;
  performersCount: number | null;
  durationMinutes: number | null;
  priceText: string;
  imageUrl: string;
  videoUrl: string;
  isActive: boolean;
  /**
   * When the last explicit Artifact Publication covered this row's
   * content. NULL marks the item as edited after the published build —
   * visible in browsing, but unavailable to personalized scoring until
   * the next publication succeeds.
   */
  publishedAt: Date | null;
}

export interface ItemContextLink {
  id: number;
  itemId: number;
  contextId: number;
  validityStatus: string;
}

export interface ItemKeywordLink {
  id: number;
  itemId: number;
  keywordId: number;
  source: string;
}

export const CatalogueContextEntity = new EntitySchema<CatalogueContext>({
  name: "CatalogueContext",
  tableName: "contexts",
  columns: {
    id: { type: "bigint", primary: true, generated: "increment" },
    name: { type: String, length: 255, unique: true },
    nameEn: { name: "name_en", type: String, length: 255, nullable: true },
    groupName: { name: "group_name", type: String, length: 255, default: "" },
    description: { type: "text", default: "" },
    descriptionEn: { name: "description_en", type: "text", nullable: true },
  },
});

export const TaxonomyNodeEntity = new EntitySchema<TaxonomyNode>({
  name: "TaxonomyNode",
  tableName: "taxonomy_nodes",
  columns: {
    id: { type: "bigint", primary: true, generated: "increment" },
    name: { type: String, length: 255 },
    nameEn: { name: "name_en", type: String, length: 255, nullable: true },
    level: { type: "smallint" },
    parentId: { name: "parent_id", type: "bigint", nullable: true },
  },
});

export const CatalogueKeywordEntity = new EntitySchema<CatalogueKeyword>({
  name: "CatalogueKeyword",
  tableName: "keywords",
  columns: {
    id: { type: "bigint", primary: true, generated: "increment" },
    name: { type: String, length: 255, unique: true },
    nameEn: { name: "name_en", type: String, length: 255, nullable: true },
    taxonomyNodeId: { name: "taxonomy_node_id", type: "bigint", nullable: true },
  },
});

export const CatalogueItemEntity = new EntitySchema<CatalogueItem>({
  name: "CatalogueItem",
  tableName: "items",
  columns: {
    id: { type: "bigint", primary: true, generated: "increment" },
    artifactItemId: {
      name: "artifact_item_id",
      type: "bigint",
      unique: true,
    },
    name: { type: String, length: 255, unique: true },
    nameEn: { name: "name_en", type: String, length: 255, nullable: true },
    description: { type: "text", default: "" },
    descriptionEn: { name: "description_en", type: "text", nullable: true },
    categoryGroup: { name: "category_group", type: String, length: 255, default: "" },
    categoryGroupEn: { name: "category_group_en", type: String, length: 255, nullable: true },
    performanceType: { name: "performance_type", type: String, length: 255, default: "" },
    performanceTypeEn: { name: "performance_type_en", type: String, length: 255, nullable: true },
    performersCount: { name: "performers_count", type: "bigint", nullable: true },
    durationMinutes: { name: "duration_minutes", type: "bigint", nullable: true },
    priceText: { name: "price_text", type: String, length: 255, default: "" },
    imageUrl: { name: "image_url", type: String, length: 500, default: "" },
    videoUrl: { name: "video_url", type: String, length: 500, default: "" },
    isActive: { name: "is_active", type: Boolean, default: true },
    publishedAt: { name: "published_at", type: "timestamptz", nullable: true },
  },
  indices: [
    {
      name: "ix_items_artifact_item_id",
      columns: ["artifactItemId"],
      unique: true,
    },
  ],
});

export const ItemContextEntity = new EntitySchema<ItemContextLink>({
  name: "ItemContext",
  tableName: "item_contexts",
  columns: {
    id: { type: "bigint", primary: true, generated: "increment" },
    itemId: { name: "item_id", type: "bigint" },
    contextId: { name: "context_id", type: "bigint" },
    validityStatus: { name: "validity_status", type: String, length: 30, default: "valid" },
  },
});

export const ItemKeywordEntity = new EntitySchema<ItemKeywordLink>({
  name: "ItemKeyword",
  tableName: "item_keywords",
  columns: {
    id: { type: "bigint", primary: true, generated: "increment" },
    itemId: { name: "item_id", type: "bigint" },
    keywordId: { name: "keyword_id", type: "bigint" },
    source: { type: String, length: 100, default: "" },
  },
});

export const catalogueEntities = [
  CatalogueContextEntity,
  TaxonomyNodeEntity,
  CatalogueKeywordEntity,
  CatalogueItemEntity,
  ItemContextEntity,
  ItemKeywordEntity,
];
