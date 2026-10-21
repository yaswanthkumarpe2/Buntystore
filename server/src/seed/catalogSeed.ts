import { ProductModel } from "../models";
import { CATALOG } from "./catalog";

/** Adds any catalogue product that is missing (by slug). Never changes or removes existing ones. */
export async function ensureCatalog(): Promise<number> {
  const existing = new Set((await ProductModel.find({}, { slug: 1 }).lean()).map((p) => p.slug));
  const missing = CATALOG.filter((p) => !existing.has(p.slug));
  if (missing.length) await ProductModel.insertMany(missing);
  return missing.length;
}
