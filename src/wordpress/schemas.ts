import { z } from 'zod';

/**
 * WordPress REST 回應的 schema。
 *
 * 只列我們真的會讀的欄位。Zod 預設會把多出來的欄位丟掉，所以站台裝了新外掛、
 * 多回了一堆欄位也不會壞；但**我們要的欄位不見或型別變了就會立刻炸**，
 * 這正是要的——WordPress 或外掛改版時要在讀取當下發現，不要等到發布出錯。
 *
 * 欄位名稱與型別都是對著 www.remusplus.com 的真實回應寫的。
 */

/** 標題、內容這類欄位在 REST 裡是 { raw, rendered } 的形狀。 */
const RenderedField = z.object({
  raw: z.string().optional(),
  rendered: z.string().optional(),
});

export const WordPressUserSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  slug: z.string(),
  /** 只有 context=edit 才會有。 */
  roles: z.array(z.string()).optional(),
});

export type WordPressUser = z.infer<typeof WordPressUserSchema>;

export const PostTypeSchema = z.object({
  slug: z.string(),
  name: z.string(),
  /** REST 端點用的名字，不一定等於 slug。 */
  rest_base: z.string(),
  taxonomies: z.array(z.string()).default([]),
  /**
   * context=edit 才有。值**不一定是布林**——WordPress 會把註冊時給的功能參數
   * 原樣帶出來，例如正式站的 post 是 `{"editor":[{"notes":true}]}`。
   * 只用「這個鍵在不在」判斷有沒有支援，不要假設型別。
   */
  supports: z.record(z.string(), z.unknown()).optional(),
});

export type PostType = z.infer<typeof PostTypeSchema>;

/** WordPress 不支援的功能是整個不出現，不是給 false；仍然防一手。 */
export function supportsFeature(type: PostType, feature: string): boolean {
  const value = type.supports?.[feature];
  return value !== undefined && value !== false;
}

/** /wp/v2/types 回的是以 slug 為鍵的物件，不是陣列。 */
export const PostTypesSchema = z.record(z.string(), PostTypeSchema);

export const TaxonomySchema = z.object({
  slug: z.string(),
  name: z.string(),
  rest_base: z.string(),
  types: z.array(z.string()).default([]),
  hierarchical: z.boolean().default(false),
});

export type Taxonomy = z.infer<typeof TaxonomySchema>;

export const TaxonomiesSchema = z.record(z.string(), TaxonomySchema);

export const TermSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  slug: z.string(),
  parent: z.number().int().default(0),
  count: z.number().int().default(0),
});

export type Term = z.infer<typeof TermSchema>;

export const TermListSchema = z.array(TermSchema);

/**
 * 文章。`date_gmt` 與 `modified_gmt` 是首頁保護與遠端變動偵測的依據
 * （計畫 §8.4）：發布前重讀一次，跟上次載入的值不一樣就代表別人改過。
 */
export const PostSchema = z.object({
  id: z.number().int(),
  status: z.string(),
  link: z.string(),
  slug: z.string(),
  title: RenderedField,
  content: RenderedField,
  excerpt: RenderedField.optional(),
  featured_media: z.number().int().default(0),
  date_gmt: z.string().nullable(),
  modified_gmt: z.string().nullable(),
});

export type Post = z.infer<typeof PostSchema>;

export const MediaSchema = z.object({
  id: z.number().int(),
  source_url: z.string(),
  mime_type: z.string(),
  media_type: z.string(),
  alt_text: z.string().default(''),
  title: RenderedField,
});

export type Media = z.infer<typeof MediaSchema>;
