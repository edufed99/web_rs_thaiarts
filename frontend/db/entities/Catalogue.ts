import { EntitySchema } from "typeorm";

export interface CatalogueContext {
  id: number;
  name: string;
  groupName: string;
  description: string;
}

export interface TaxonomyNode {
  id: number;
  name: string;
  level: number;
  parentId: number | null;
}

export interface CatalogueKeyword {
  id: number;
  name: string;
  taxonomyNodeId: number | null;
}

export interface CatalogueItem {
  id: number;
  artifactItemId: number;
  name: string;
  description: string;
  categoryGroup: string;
  performanceType: string;
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
    groupName: { name: "group_name", type: String, length: 255, default: "" },
    description: { type: "text", default: "" },
  },
});

export const TaxonomyNodeEntity = new EntitySchema<TaxonomyNode>({
  name: "TaxonomyNode",
  tableName: "taxonomy_nodes",
  columns: {
    id: { type: "bigint", primary: true, generated: "increment" },
    name: { type: String, length: 255 },
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
    description: { type: "text", default: "" },
    categoryGroup: { name: "category_group", type: String, length: 255, default: "" },
    performanceType: { name: "performance_type", type: String, length: 255, default: "" },
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
