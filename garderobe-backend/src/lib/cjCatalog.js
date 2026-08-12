// Haalt automatisch trending producten op bij CJ, per sectie (dames/heren/
// accessoires) — geen handmatige curatie nodig. Twee lagen caching zodat we
// niet bij elke paginabezoeker CJ live bevragen, en zodat getoonde producten
// een week de tijd krijgen om te bewijzen of ze aanslaan bij klanten voordat
// de lijst ververst:
//   1. Categorieboom  -> ververst elke 7 dagen (verandert zelden)
//   2. Trending lijst per sectie -> ververst elke 7 dagen

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { getValidAccessToken } = require("./cjClient");

const CJ_BASE = "https://developers.cjdropshipping.com/api2.0/v1";
const CATEGORY_CACHE_PATH = path.join(__dirname, "..", "..", "data", "cj-category-cache.json");
const TRENDING_CACHE_PATH = path.join(__dirname, "..", "..", "data", "cj-trending-cache.json");

const CATEGORY_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dagen
const TRENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week — geef producten tijd om te presteren voordat de lijst ververst

const MARKUP = Number(process.env.PRICE_MARKUP_MULTIPLIER || 1.6);

// Zoekwoorden om CJ's categorieboom te matchen aan onze drie secties.
// CJ's categorie-ID's zijn ondoorzichtige GUID's die kunnen verschillen,
// dus matchen we op naam i.p.v. hardcoded ID's.
//
// Belangrijk: dames/heren sluiten expliciet alles uit dat ook op de
// accessoire-zoekwoorden matcht. Zonder die uitsluiting zou bv. een CJ-
// categorie als "Men's Accessories" zowel bij heren (bevat "Men") als bij
// accessoires (bevat "Accessories") terechtkomen, waardoor de herenlijst
// overspoeld raakt met riemen/horloges/sieraden i.p.v. kleding.
const ACCESSORY_KEYWORDS = /access|jewelry|jewellery|bag|belt|sunglasses|watch|hat|scarf|wallet/i;

const SECTION_MATCHERS = {
  dames: (oneCategoryName, twoCategoryName) =>
    /women/i.test(oneCategoryName) &&
    !ACCESSORY_KEYWORDS.test(`${oneCategoryName} ${twoCategoryName}`),
  heren: (oneCategoryName, twoCategoryName) =>
    /men/i.test(oneCategoryName) &&
    !/women/i.test(oneCategoryName) &&
    !ACCESSORY_KEYWORDS.test(`${oneCategoryName} ${twoCategoryName}`),
  accessoires: (oneCategoryName, twoCategoryName) =>
    ACCESSORY_KEYWORDS.test(`${oneCategoryName} ${twoCategoryName}`),
};

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
  const { data } = await axios.get(`${CJ_BASE}/product/getCategory`, {
    headers: { "CJ-Access-Token": accessToken },
  });
  if (!data.result) throw new Error(`Categorieboom ophalen mislukt: ${data.message}`);

  writeCache(CATEGORY_CACHE_PATH, { fetchedAt: Date.now(), tree: data.data });
  return data.data;
}

// Vertaalt een sectie ("dames"/"heren"/"accessoires") naar een lijst van
// CJ level-3 categoryId's die daaronder vallen.
async function resolveCategoryIds(section) {
  const tree = await getCategoryTree();
  const matcher = SECTION_MATCHERS[section];
  if (!matcher) throw new Error(`Onbekende sectie: ${section}`);

  const ids = [];
  for (const lvl1 of tree) {
    for (const lvl2 of lvl1.categoryFirstList || []) {
      const match = matcher(lvl1.categoryFirstName, lvl2.categorySecondName);
      if (match) {
        for (const lvl3 of lvl2.categorySecondList || []) {
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

// Haalt de trending producten voor één sectie op (met wekelijkse caching,
// zodat een eenmaal getoond product blijft staan totdat de week om is —
// of totdat je force:true gebruikt om handmatig te verversen).
async function getTrendingProducts(section, { size = 24, force = false, maxPages = 6 } = {}) {
  const cache = readCache(TRENDING_CACHE_PATH) || {};
  const cached = cache[section];
  if (!force && cached && Date.now() - cached.fetchedAt < TRENDING_TTL_MS) {
    return cached.products;
  }

  const categoryIds = await resolveCategoryIds(section);
  if (categoryIds.length === 0) {
    console.warn(`Geen CJ-categorieën gevonden voor sectie "${section}"`);
    return [];
  }

  const accessToken = await getValidAccessToken();

  // CJ levert voor een flink deel van de producten geen sellPrice mee
  // (schijnt normaal te zijn voor bepaalde producttypes bij hen). We halen
  // daarom desnoods meerdere pagina's op — elke pagina op CJ's maximum van
  // 100 — totdat we genoeg producten MET geldige prijs hebben verzameld,
  // met een bovengrens (maxPages) zodat we niet oneindig doorzoeken als een
  // categorie structureel weinig geprijsde producten heeft.
  const seenPids = new Set();
  const collected = [];
  let page = 1;

  while (collected.length < size && page <= maxPages) {
    const { data } = await axios.get(`${CJ_BASE}/product/listV2`, {
      headers: { "CJ-Access-Token": accessToken },
      params: {
        page,
        size: 100, // CJ's maximum per pagina
        lv3categoryList: categoryIds.slice(0, 50), // CJ limiteert de lijstlengte in de praktijk
        productFlag: 0, // 0 = Trending products (CJ's eigen big-data signaal)
        orderBy: 1, // sorteer op listing count = populariteit-proxy
        sort: "desc",
        verifiedWarehouse: 1, // alleen geverifieerde voorraad, dus betrouwbaar leverbaar
        startWarehouseInventory: 10, // niet bijna-uitverkocht tonen
        features: ["enable_category"],
      },
      paramsSerializer: { indexes: null }, // arrays als herhaalde query-params, zoals CJ verwacht
    });

    if (!data.result) throw new Error(`Trending producten ophalen mislukt: ${data.message}`);

    const rawProducts = (data.data.content || []).flatMap((c) => c.productList || []);
    if (rawProducts.length === 0) break; // geen resultaten meer op verdere pagina's

    for (const p of rawProducts) {
      if (seenPids.has(p.id)) continue; // voorkom dubbele producten tussen pagina's
      seenPids.add(p.id);

      // Niet elk product heeft een gevulde sellPrice — val dan terug op de
      // andere prijsvelden die CJ soms wel invult.
      const rawPrice = toNumber(p.sellPrice) ?? toNumber(p.discountPrice) ?? toNumber(p.nowPrice);
      if (rawPrice === null) continue; // alleen producten MET geldige prijs bewaren we

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
      `Sectie "${section}": maar ${products.length}/${size} producten met geldige prijs gevonden (na ${page - 1} pagina('s) bij CJ doorzocht).`
    );
  }

  cache[section] = { fetchedAt: Date.now(), products };
  writeCache(TRENDING_CACHE_PATH, cache);

  return products;
}

// Haalt varianten (maat/kleur + het cjVid dat je nodig hebt bij checkout)
// voor één product op — pas nodig zodra de klant een productpagina opent.
async function getProductVariants(pid) {
  const accessToken = await getValidAccessToken();
  const { data } = await axios.get(`${CJ_BASE}/product/query`, {
    headers: { "CJ-Access-Token": accessToken },
    params: { pid },
  });
  if (!data.result) throw new Error(`Productdetails ophalen mislukt: ${data.message}`);

  const p = data.data;
  const variants = (p.variants || []).map((v) => {
    const rawPrice = toNumber(v.variantSellPrice) ?? toNumber(v.variantSugSellPrice);
    return {
      vid: v.vid,
      key: v.variantKey, // bv. "Zwart-M"
      image: v.variantImage,
      price: rawPrice !== null ? applyMarkup(rawPrice) : null,
      cjPrice: rawPrice,
    };
  });

  if (variants.length === 0) {
    console.warn(`CJ gaf 0 varianten terug voor product ${pid} — check of dit pid nog bestaat/geldig is.`);
  }

  return {
    pid: p.pid,
    name: p.productNameEn,
    description: p.description,
    images: p.productImageSet || [p.bigImage],
    variants,
  };
}

module.exports = { getTrendingProducts, getProductVariants };
