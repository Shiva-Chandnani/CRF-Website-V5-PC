// =============================================================================
// CRF Product Catalogue — Supabase data loader
// =============================================================================
// Replace the two placeholders below with your Supabase project URL and the
// anon public key (Project Settings → API). Both are safe to expose; the
// catalogue tables are protected by Row-Level Security (public read,
// authenticated write).
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://fzgsogdceptjvuahukbn.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ6Z3NvZ2RjZXB0anZ1YWh1a2JuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2MTM3NTUsImV4cCI6MjA5NDE4OTc1NX0.OnVVRW9X79ab730VqNqO_zYrpW2YhuWGteGUxVkfkrA';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// -----------------------------------------------------------------------------
// Browsing — drill from category down to product
// -----------------------------------------------------------------------------

export async function getCategories() {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .order('display_order');
  if (error) throw error;
  return data;
}

export async function getSubcategoriesFor(categoryId) {
  const { data, error } = await supabase
    .from('subcategories')
    .select('*')
    .eq('category_id', categoryId)
    .order('display_order');
  if (error) throw error;
  return data;
}

export async function getItemTypesFor(subcategoryId) {
  const { data, error } = await supabase
    .from('item_types')
    .select('*')
    .eq('subcategory_id', subcategoryId)
    .eq('status', 'active')
    .order('display_order');
  if (error) throw error;
  return data;
}

// Returns [{ price, fabric_types: {...} }, ...] — fabric types offered for
// this item type, with the price applicable to THIS item type.
export async function getFabricTypesFor(itemTypeId) {
  const { data, error } = await supabase
    .from('item_type_fabrics')
    .select('price, fabric_types(*)')
    .eq('item_type_id', itemTypeId);
  if (error) throw error;
  return data;
}

// All products (item_type × design) for a given fabric type within a given
// item type. Returns the customer-facing rows from v_products.
export async function getProductsFor(itemTypeId, fabricTypeId) {
  const { data, error } = await supabase
    .from('v_products')
    .select('*')
    .eq('item_type_id', itemTypeId)
    .eq('fabric_type_id', fabricTypeId)
    .order('design_name');
  if (error) throw error;
  return data;
}

export async function getProduct(productId) {
  const { data, error } = await supabase
    .from('v_products')
    .select('*')
    .eq('product_id', productId)
    .single();
  if (error) throw error;
  return data;
}

export async function getPhotosFor(fabricDesignId) {
  const { data, error } = await supabase
    .from('fabric_design_photos')
    .select('*')
    .eq('fabric_design_id', fabricDesignId)
    .order('display_order');
  if (error) throw error;
  return data;
}

export async function getItemTypePhotos(itemTypeId) {
  const { data, error } = await supabase
    .from('item_type_photos')
    .select('*')
    .eq('item_type_id', itemTypeId)
    .order('display_order');
  if (error) throw error;
  return data;
}

// -----------------------------------------------------------------------------
// Search / filter — any combination of filters on v_products
// -----------------------------------------------------------------------------

// filters: {
//   categoryId, subcategoryId, itemTypeId, fabricTypeId, fabricNumber,
//   pattern, color, season, minPrice, maxPrice, availability
// }
export async function searchProducts(filters = {}) {
  let q = supabase.from('v_products').select('*');

  if (filters.categoryId) q = q.eq('category_id', filters.categoryId);
  if (filters.subcategoryId) q = q.eq('subcategory_id', filters.subcategoryId);
  if (filters.itemTypeId) q = q.eq('item_type_id', filters.itemTypeId);
  if (filters.fabricTypeId) q = q.eq('fabric_type_id', filters.fabricTypeId);
  if (filters.fabricNumber) q = q.eq('fabric_number', filters.fabricNumber);
  if (filters.pattern) q = q.eq('pattern', filters.pattern);
  if (filters.availability) q = q.eq('availability', filters.availability);
  if (filters.color) q = q.contains('color', [filters.color]);
  if (filters.season) q = q.contains('item_season', [filters.season]);
  if (filters.minPrice != null) q = q.gte('price', filters.minPrice);
  if (filters.maxPrice != null) q = q.lte('price', filters.maxPrice);

  const { data, error } = await q.order('display_name');
  if (error) throw error;
  return data;
}

// -----------------------------------------------------------------------------
// Ranked search (Phase 3) — server-side via the search_products RPC.
// productSearch: query + optional structured filters (shop page, combined AND).
// quickSearch:   query only, capped (header typeahead overlay).
// Both return the same v_products row shape searchProducts returns.
// -----------------------------------------------------------------------------
export async function productSearch(query, filters = {}) {
  const q = (query || '').trim();
  if (!q) return searchProducts(filters); // empty query → existing filter-only path
  const { data, error } = await supabase.rpc('search_products', {
    search_query:     q,
    p_category_id:    filters.categoryId    ?? null,
    p_subcategory_id: filters.subcategoryId ?? null,
    p_fabric_type_id: filters.fabricTypeId  ?? null,
    p_pattern:        filters.pattern       ?? null,
    p_color:          filters.color         ?? null,
  });
  if (error) throw error;
  return data;
}

export async function quickSearch(query, limit = 6) {
  const q = (query || '').trim();
  if (!q) return [];
  const { data, error } = await supabase.rpc('search_products', { search_query: q });
  if (error) throw error;
  return data.slice(0, limit);
}

// -----------------------------------------------------------------------------
// Image URL helpers
// -----------------------------------------------------------------------------

export function fabricImageUrl(path, { width } = {}) {
  if (!path) return null;
  const builder = supabase.storage.from('crf-fabrics');
  return width
    ? builder.getPublicUrl(path, { transform: { width } }).data.publicUrl
    : builder.getPublicUrl(path).data.publicUrl;
}

export function productImageUrl(path, { width } = {}) {
  if (!path) return null;
  const builder = supabase.storage.from('crf-products');
  return width
    ? builder.getPublicUrl(path, { transform: { width } }).data.publicUrl
    : builder.getPublicUrl(path).data.publicUrl;
}
