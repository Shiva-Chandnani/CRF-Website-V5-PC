# Supabase Setup

One-time setup for the CRF product catalogue backend.

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) and sign in.
2. **New project** → name `crf-catalogue` → pick a region close to Bangkok (e.g. `ap-southeast-1` Singapore) → set a strong DB password (save it somewhere) → **Create**.
3. Wait ~2 min for provisioning.

## 2. Run the schema

1. Open the project → **SQL Editor** → **New query**.
2. Paste the contents of [schema.sql](schema.sql) → **Run**.
3. New query → paste [seed.sql](seed.sql) → **Run**.

Expect zero errors. To verify:

```sql
select count(*) from categories;   -- 7
select count(*) from v_products;   -- 9 (after seed)
```

## 3. Create the Storage buckets

1. **Storage** → **New bucket** → name `crf-fabrics` → **Public bucket** ✓ → Create.
2. Same again → name `crf-products` → **Public bucket** ✓ → Create.

## 4. Upload the example images (optional smoke test)

Inside `crf-fabrics`:

```
WL-1101/01.jpg      ← any image will do for the test
WL-1101/02.jpg
WL-1102/01.jpg
WL-1103/01.jpg
```

(Paths must match the `image_path` values in [seed.sql](seed.sql) line 60+.)

## 5. Get your project keys

**Project Settings → API**:

- **Project URL** — looks like `https://xxxxxxxx.supabase.co`
- **anon public** key — long JWT starting with `eyJ…`

Both are safe to expose in client-side code; RLS protects writes.

## 6. Wire up the frontend

Open [../js/data-loader.js](../js/data-loader.js) and replace the two placeholders at the top:

```js
const SUPABASE_URL  = 'https://YOUR-PROJECT.supabase.co';
const SUPABASE_ANON = 'YOUR-ANON-KEY';
```

## 7. Create an admin user (for writes)

**Authentication → Users → Add user** → use your own email + a password.

Only logged-in users can write to the catalogue tables — anonymous browsers can only read.

## Verification

```bash
# Public read works without auth (replace URL+key):
curl "https://YOUR-PROJECT.supabase.co/rest/v1/v_products?select=product_id,display_name,price&limit=5" \
  -H "apikey: YOUR-ANON-KEY"
```

Should return JSON array of products.

## Day-to-day workflow

See the **Adding & Removing Products** and **Admin Workflow** sections of the plan: `~/.claude/plans/ok-so-i-want-unified-bubble.md`.

Quick reference:

| You want to… | Steps |
|---|---|
| Add a new fabric design | Storage upload → 1 row in `fabric_designs` → 1+ rows in `fabric_design_photos` |
| Change the price of Cavani Wool suits | Edit `item_type_fabrics` row `(formal-suit-2-piece, cavani-wool)` |
| Add a new fabric type | 1 row in `fabric_types` → N rows in `item_type_fabrics` |
| Mark a design out of stock | Edit `fabric_designs.availability` → `out_of_stock` |
| Discontinue an item type | Edit `item_types.status` → `archived` |
