// =============================================================================
// CRF Product Catalogue — TypeScript types
// Mirrors db/schema.sql. Used for IDE autocomplete in JS files via JSDoc
// (no build step required):
//
//     /** @type {import('./schema').Product} */
//     const p = await getProduct(id);
// =============================================================================

export type Pattern =
  | 'solid'
  | 'pinstripe'
  | 'chalk-stripe'
  | 'check'
  | 'windowpane'
  | 'herringbone'
  | 'houndstooth'
  | 'glen-plaid'
  | 'twill'
  | 'other';

export type Availability =
  | 'in_stock'
  | 'low_stock'
  | 'made_to_order'
  | 'out_of_stock';

export type ItemStatus = 'active' | 'draft' | 'archived';

export type Season = 'all-season' | 'spring' | 'summer' | 'autumn' | 'winter';

export type Occasion =
  | 'formal'
  | 'business'
  | 'casual'
  | 'wedding'
  | 'black-tie'
  | 'resort';

export interface Category {
  id: string;
  name: string;
  description: string | null;
  display_order: number;
  hero_image: string | null;
  created_at: string;
  updated_at: string;
}

export interface Subcategory {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  display_order: number;
  hero_image: string | null;
  created_at: string;
  updated_at: string;
}

export interface ItemType {
  id: string;
  subcategory_id: string;
  name: string;
  description: string | null;
  season: Season[];
  occasion: Occasion[];
  status: ItemStatus;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface FabricType {
  id: string;
  brand: string;
  family: string;
  display_name: string;        // generated: brand + ' : ' + family
  description: string | null;
  composition: string | null;
  weight_gsm: number | null;
  origin: string | null;
  season: Season[];
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface FabricDesign {
  id: string;
  fabric_type_id: string;
  fabric_number: string;       // unique, format: ^(WL|LN|CT|SLK|TWD|BLD)-\d{4,}$
  name: string;
  color: string[];
  pattern: Pattern;
  availability: Availability;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface ItemTypeFabric {
  item_type_id: string;
  fabric_type_id: string;
  price: number;               // THB
}

export interface FabricDesignPriceOverride {
  item_type_id: string;
  fabric_design_id: string;
  price: number;               // THB
}

export interface FabricDesignPhoto {
  id: number;
  fabric_design_id: string;
  image_path: string;          // path inside the crf-fabrics bucket
  alt_text: string | null;
  is_primary: boolean;
  display_order: number;
  created_at: string;
}

export interface ItemTypePhoto {
  id: number;
  item_type_id: string;
  image_path: string;          // path inside the crf-products bucket
  alt_text: string | null;
  is_primary: boolean;
  display_order: number;
  created_at: string;
}

// The customer-facing product row from v_products view
export interface Product {
  product_id: string;          // '{item_type_id}__{fabric_design_id}'
  item_type_id: string;
  item_type_name: string;
  subcategory_id: string;
  category_id: string;
  fabric_type_id: string;
  fabric_brand: string;
  fabric_family: string;
  fabric_type_name: string;    // 'Cavani : Wool'
  fabric_design_id: string;
  design_name: string;
  fabric_number: string;
  color: string[];
  pattern: Pattern;
  availability: Availability;
  price: number;
  has_design_override: boolean;
  primary_photo_path: string | null;
  display_name: string;        // 'Cavani : Wool — Black Pinstripe — Formal Suit Two Piece'
  item_status: ItemStatus;
  item_season: Season[];
  item_occasion: Occasion[];
  fabric_season: Season[];
}

export interface ProductFilters {
  categoryId?: string;
  subcategoryId?: string;
  itemTypeId?: string;
  fabricTypeId?: string;
  fabricNumber?: string;
  pattern?: Pattern;
  color?: string;
  season?: Season;
  minPrice?: number;
  maxPrice?: number;
  availability?: Availability;
}

export interface NewsletterSubscriberRow {
  email: string;
  profile_id: string | null;
  source: string;
  opted_in_at: string;
  unsubscribed_at: string | null;
  created_at: string;
}
