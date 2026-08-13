// Haalt producten op bij CJ Dropshipping — trending/nieuw/sub-categorie
// feeds — met caching zodat we niet bij elke bezoeker CJ live bevragen.
//   1. Categorieboom  -> ververst elke 7 dagen (verandert zelden)
//   2. Productlijsten -> ververst elke week (of eerder via force=true)

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { getValidAccessToken, cjRequest } = require("./cjClient");

const CJ_BASE = "https://developers.cjdropshipping.com/api2.0/v1";
const CATEGORY_CACHE_PATH = path.join(__dirname, "..", "..", "data", "cj-category-cache.json");
const PRODUCTS_CACHE_PATH = path.join(__dirname, "..", "..", "data", "cj-products-cache.json");

const CATEGORY_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const PRODUCTS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

const MARKUP = Number(process.env.PRICE_MARKUP_MULTIPLIER || 1.6);

// Keywords to match CJ's category tree onto our two genders. CJ's
// category ID's are opaque GUIDs that can differ, so we match on name.
//
// Important: gender matchers explicitly exclude anything that also matches
// the accessory keywords. Without that exclusion, a CJ category like
// "Men's Accessories" would match BOTH "heren" (contains "Men") and
// "accessories" (contains "Accessories"), flooding the men's clothing
// list with belts/watches/jewelry instead of actual clothing.
const ACCESSORY_KEYWORDS = /access|jewelry|jewellery|bag|belt|sunglasses|watch|hat|scarf|wallet/i;

const GENDER_MATCHERS = {
  dames: (oneCategoryName, twoCategoryName) =>
    /women/i.test(oneCategoryName) && !ACCESSORY_KEYWORDS.test(`${oneCategoryName} ${twoCategoryName}`),
  heren: (oneCategoryName, twoCategoryName) =>
    /men/i.test(oneCategoryName) &&
    !/women/i.test(oneCategoryName) &&
    !ACCESSORY_KEYWORDS.test(`${oneCategoryName} ${twoCategoryName}`),
};

// Sub-category taxonomy per gender, straight from the site's spec doc.
// Each group label (e.g. "Tops & Sets") maps to a list of CJ level-3
// category names we search for within that gender's branch of the tree.
const TAXONOMY = {
  dames: {
    "Tops & Sets": [
      "Ladies Short Sleeve",
      "Women's Camis",
      "Women's Vests",
      "Women's Short-Sleeved Shirts",
      "Women's Long-Sleeved Shirts",
      "Blouses & Shirts",
      "Women's Hoodies & Sweatshirts",
      "Jumpsuits",
      "Rompers",
      "Lady Dresses",
      "Sweaters",
      "Suits & Sets",
    ],
    Bottoms: ["Leggings", "Skirts", "Woman Jeans", "Woman Shorts", "Pants & Capris", "Wide Leg Pants"],
    "Outerwear & Jackets": [
      "Blazers",
      "Wool & Blend",
      "Women's Padded Jackets",
      "Woman Trench",
      "Basic Jacket",
      "Leather & Suede",
      "Real Fur",
    ],
    Accessories: [
      "Scarves & Wraps",
      "Face mask",
      "Belts & Cummerbunds",
      "Woman Gloves & Mittens",
      "Woman Socks",
      "Woman Hats & Caps",
    ],
  },
  heren: {
    "T-Shirts": ["Geometric", "Men's Long-Sleeved", "Striped", "Solid", "3D", "Print"],
    Bottoms: ["Pajama Sets", "Man Shorts", "Cargo Pants", "Man Jeans", "Harem Pants", "Casual Pants", "Sweatpants"],
    "Outerwear & Jackets": [
      "Suits & Blazer",
      "Men's Sweaters",
      "Genuine Leather",
      "Man Trench",
      "Men's Shirts",
      "Men's Jackets",
      "Men's Suits",
      "Man Hoodies & Sweatshirts",
      "Wool & Blends",
      "Parkas",
      "Down Jackets",
    ],
    "Underwear & Loungewear": [
      "Men's Sleep & Lounge",
      "Shorts",
      "Briefs",
      "Robes",
      "Man Pajamas Sets",
      "Boxers",
      "Long Johns",
    ],
    Accessories: ["Socks", "Men's Ties", "Scarves", "Man Gloves & Mittens", "Skullies & Beanies", "Belts"],
  },
};

// CJ's own category assignment isn't always accurate — a garden tool can
// end up filed under a clothing category on their end. As a safety net, we
// ALSO check the actual product name for clothing-relevant keywords, and
// drop anything that doesn't match. This is deliberately broader/simpler
// than the exact taxonomy leaf names above (real product titles say things
// like "Casual Long Sleeve Blouse", not the exact CJ category label).
const NAME_KEYWORDS = {
  dames: {
    "Tops & Sets": [
      "t-shirt", "tshirt", "tee", "shirt", "blouse", "top", "cami", "tank",
      "vest", "hoodie", "sweatshirt", "jumpsuit", "romper", "dress", "sweater",
      "suit", "sleeve", "pullover", "knit",
    ],
    Bottoms: ["legging", "skirt", "jean", "short", "pant", "trouser", "capri"],
    "Outerwear & Jackets": ["blazer", "jacket", "coat", "trench", "wool", "leather", "suede", "fur", "parka"],
    Accessories: ["scarf", "mask", "belt", "glove", "mitten", "sock", "hat", "cap"],
  },
  heren: {
    "T-Shirts": ["t-shirt", "tshirt", "tee", "shirt", "sleeve", "top"],
    Bottoms: ["pajama", "short", "cargo", "jean", "harem", "pant", "trouser", "sweatpant"],
    "Outerwear & Jackets": [
      "blazer", "sweater", "leather", "trench", "shirt", "jacket", "suit",
      "hoodie", "sweatshirt", "wool", "parka", "coat", "pullover", "knit",
    ],
    "Underwear & Loungewear": ["sleep", "lounge", "short", "brief", "robe", "pajama", "boxer", "long john"],
    Accessories: ["sock", "tie", "scarf", "glove", "mitten", "beanie", "skull", "belt"],
  },
};

// Flattened whitelist for a whole gender (used by the "All" view and the
// homepage "new arrivals" feed, where we're not filtering to one specific
// sub-category but still want to exclude obviously unrelated products).
function getGenderNameKeywords(section) {
  const groups = NAME_KEYWORDS[section];
  if (!groups) return null;
  return [...new Set(Object.values(groups).flat())];
}

function productNameMatches(name, keywords) {
  if (!keywords) return true; // no filter configured -> don't exclude anything
  const lowerName = (name || "").toLowerCase();
  return keywords.some((k) => lowerName.includes(k));
}

function getTaxonomy(section) {
  return TAXONOMY[section] || null;
}

function readCache(cachePath) {
  if (!fs.existsSync(cachePath)) return null;
  const raw = fs.readFileSync(cachePath, "utf-8").trim();
  return raw ? JSON.parse(raw) : null;
}

function writeCache(cachePath, data) {
  fs.writeFileSync(cachePath, JSON.stringify(data, null, 2));
}

async function getCategoryTree() {
  const cached = readCache(CATEGORY_CACHE_PATH);
  if (cached && Date.now() - cached.fetchedAt < CATEGORY_TTL_MS) {
    return cached.tree;
  }

  const accessToken = await getValidAccessToken();
  const { data } = await cjRequest(() =>
    axios.get(`${CJ_BASE}/product/getCategory`, {
      headers: { "CJ-Access-Token": accessToken },
    })
  );
  if (!data.result) throw new Error(`Failed to fetch category tree: ${data.message}`);

  writeCache(CATEGORY_CACHE_PATH, { fetchedAt: Date.now(), tree: data.data });
  return data.data;
}

// All level-3 category ID's under a gender's branch of the tree.
async function resolveGenderCategoryIds(section) {
  const tree = await getCategoryTree();
  const matcher = GENDER_MATCHERS[section];
  if (!matcher) throw new Error(`Unknown section: ${section}`);

  const ids = [];
  for (const lvl1 of tree) {
    for (const lvl2 of lvl1.categoryFirstList || []) {
      if (!matcher(lvl1.categoryFirstName, lvl2.categorySecondName)) continue;
      for (const lvl3 of lvl2.categorySecondList || []) {
        ids.push(lvl3.categoryId);
      }
    }
  }
  return ids;
}

// Level-3 category ID's within a gender's branch whose name matches one of
// the leaf names for a taxonomy group (e.g. "Bottoms" -> Leggings, Skirts...).
async function resolveGroupCategoryIds(section, groupLabel) {
  const taxonomy = getTaxonomy(section);
  const leafNames = taxonomy?.[groupLabel];
  if (!leafNames) return [];

  const lowerLeaves = leafNames.map((n) => n.toLowerCase());
  const tree = await getCategoryTree();
  const matcher = GENDER_MATCHERS[section];

  const ids = [];
  for (const lvl1 of tree) {
    for (const lvl2 of lvl1.categoryFirstList || []) {
      if (!matcher(lvl1.categoryFirstName, lvl2.categorySecondName)) continue;
      for (const lvl3 of lvl2.categorySecondList || []) {
        const name = (lvl3.categoryName || "").toLowerCase();
        if (lowerLeaves.some((leaf) => name.includes(leaf) || leaf.includes(name))) {
          ids.push(lvl3.categoryId);
        }
      }
    }
  }
  return ids;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function applyMarkup(cjPrice) {
  const price = Number(cjPrice) * MARKUP;
  return Math.round(price * 100) / 100;
}

// Core fetch: given a fixed list of CJ level-3 category ID's, page through
// CJ's product list (up to `maxPages`, 100 per page — CJ's max) until we've
// collected `size` products that actually have a valid price. A lot of CJ
// products don't have a populated sellPrice, so we simply skip those.
async function fetchProductsForCategoryIds(categoryIds, productFlag, { size, force, maxPages, cacheKey, nameKeywords }) {
  const cache = readCache(PRODUCTS_CACHE_PATH) || {};
  const cached = cache[cacheKey];
  if (!force && cached && Date.now() - cached.fetchedAt < PRODUCTS_TTL_MS) {
    return cached.products;
  }

  if (categoryIds.length === 0) {
    console.warn(`No CJ categories resolved for cache key "${cacheKey}"`);
    return [];
  }

  const accessToken = await getValidAccessToken();

  const seenPids = new Set();
  const collected = [];
  let page = 1;

  while (collected.length < size && page <= maxPages) {
    const { data } = await cjRequest(() =>
      axios.get(`${CJ_BASE}/product/listV2`, {
        headers: { "CJ-Access-Token": accessToken },
        params: {
          page,
          size: 100,
          lv3categoryList: categoryIds.slice(0, 50), // CJ limits list length in practice
          ...(productFlag != null ? { productFlag } : {}), // 0 = trending, 1 = new, omitted = whole category
          orderBy: 1,
          sort: "desc",
          verifiedWarehouse: 1,
          startWarehouseInventory: 10,
          features: ["enable_category"],
        },
        paramsSerializer: { indexes: null },
      })
    );

    if (!data.result) throw new Error(`Failed to fetch products: ${data.message}`);

    const rawProducts = (data.data.content || []).flatMap((c) => c.productList || []);
    if (rawProducts.length === 0) break;

    for (const p of rawProducts) {
      if (seenPids.has(p.id)) continue;
      seenPids.add(p.id);

      const rawPrice = toNumber(p.sellPrice) ?? toNumber(p.discountPrice) ?? toNumber(p.nowPrice);
      if (rawPrice === null) continue;

      // CJ's own category assignment can be wrong (e.g. a garden tool
      // filed under a clothing category) — cross-check the actual product
      // name against our keyword whitelist and skip anything that doesn't
      // look like real clothing for this group.
      if (!productNameMatches(p.nameEn, nameKeywords)) continue;

      collected.push({
        pid: p.id,
        name: p.nameEn,
        image: p.bigImage,
        priceFrom: applyMarkup(rawPrice),
        cjPriceFrom: rawPrice,
        listedNum: p.listedNum,
        category: p.threeCategoryName || p.twoCategoryName || p.oneCategoryName || "",
        freeShipping: p.addMarkStatus === 1,
      });
    }

    page++;
  }

  const products = collected.slice(0, size);

  if (products.length < size) {
    console.warn(
      `"${cacheKey}": only found ${products.length}/${size} priced products (searched ${page - 1} page(s)).`
    );
  }

  cache[cacheKey] = { fetchedAt: Date.now(), products };
  writeCache(PRODUCTS_CACHE_PATH, cache);

  return products;
}

// Whole-gender feed (used as the fallback/"all" view on a category page).
// size is deliberately larger than one screenful — the route slices this
// cached pool for infinite scroll instead of hitting CJ again per scroll.
async function getGenderProducts(section, { size = 100, force = false, maxPages = 8 } = {}) {
  const categoryIds = await resolveGenderCategoryIds(section);
  return fetchProductsForCategoryIds(categoryIds, null, {
    size,
    force,
    maxPages,
    cacheKey: `gender:${section}`,
    nameKeywords: getGenderNameKeywords(section),
  });
}

// Sub-category group feed (e.g. section=dames, group="Bottoms").
async function getGroupProducts(section, groupLabel, { size = 100, force = false, maxPages = 8 } = {}) {
  const categoryIds = await resolveGroupCategoryIds(section, groupLabel);
  return fetchProductsForCategoryIds(categoryIds, null, {
    size,
    force,
    maxPages,
    cacheKey: `group:${section}:${groupLabel}`,
    nameKeywords: NAME_KEYWORDS[section]?.[groupLabel] || null,
  });
}

// Homepage "New arrivals" feed — CJ's own "New products" signal (flag 1).
async function getNewProducts(section, { size = 40, force = false, maxPages = 8 } = {}) {
  const categoryIds = await resolveGenderCategoryIds(section);
  return fetchProductsForCategoryIds(categoryIds, 1, {
    size,
    force,
    maxPages,
    cacheKey: `new:${section}`,
    nameKeywords: getGenderNameKeywords(section),
  });
}

// Backward-compatible alias (older frontend builds may still call this name).
async function getTrendingProducts(section, opts) {
  return getGenderProducts(section, opts);
}

// Fetches variants (size/color + the cjVid needed at checkout) for one
// product — only needed once a customer opens a product page.
async function getProductVariants(pid) {
  const accessToken = await getValidAccessToken();
  const { data } = await cjRequest(() =>
    axios.get(`${CJ_BASE}/product/query`, {
      headers: { "CJ-Access-Token": accessToken },
      params: { pid },
    })
  );
  if (!data.result) throw new Error(`Failed to fetch product details: ${data.message}`);

  const p = data.data;
  const variants = (p.variants || []).map((v) => {
    const rawPrice = toNumber(v.variantSellPrice) ?? toNumber(v.variantSugSellPrice);
    return {
      vid: v.vid,
      key: v.variantKey, // e.g. "Black-M"
      image: v.variantImage,
      price: rawPrice !== null ? applyMarkup(rawPrice) : null,
      cjPrice: rawPrice,
    };
  });

  if (variants.length === 0) {
    console.warn(`CJ returned 0 variants for product ${pid} — check whether this pid is still valid.`);
  }

  return {
    pid: p.pid,
    name: p.productNameEn,
    description: p.description,
    images: p.productImageSet || [p.bigImage],
    variants,
  };
}

module.exports = {
  getTaxonomy,
  getGenderProducts,
  getGroupProducts,
  getNewProducts,
  getTrendingProducts,
  getProductVariants,
};
