const express = require("express");
const {
  getTaxonomy,
  getGenderProducts,
  getGroupProducts,
  getGroupProductsByLeaf,
  getNewProducts,
  getProductVariants,
} = require("../lib/cjCatalog");

const router = express.Router();

const VALID_SECTIONS = ["dames", "heren"];

function checkForceKey(req, res) {
  const wantsForce = req.query.force === "true";
  if (wantsForce && req.query.key !== process.env.ADMIN_REFRESH_KEY) {
    res.status(403).json({ error: "Invalid or missing key for force-refresh." });
    return null;
  }
  return wantsForce;
}

// GET /api/taxonomy?section=dames
// Returns the sub-category group labels for a section (e.g. "Tops & Sets",
// "Bottoms", "Accessories"), so the frontend can render tabs without us
// hardcoding the list in two places.
router.get("/taxonomy", (req, res) => {
  const section = req.query.section;
  if (!VALID_SECTIONS.includes(section)) {
    return res.status(400).json({ error: `section must be one of ${VALID_SECTIONS.join(", ")}` });
  }
  const taxonomy = getTaxonomy(section);
  res.json({ section, groups: taxonomy ? Object.keys(taxonomy) : [] });
});

// GET /api/catalog?section=dames&group=Bottoms&offset=0&limit=24&force=true
// Without `group`: the whole gender's catalog, sorted by popularity.
// With `group`: only that sub-category (matches the taxonomy doc).
// offset/limit slice a larger cached pool — used for infinite scroll, so
// scrolling further doesn't need extra CJ calls, just a slice of what's
// already cached.
router.get("/catalog", async (req, res) => {
  try {
    const section = req.query.section;
    if (!VALID_SECTIONS.includes(section)) {
      return res.status(400).json({ error: `section must be one of ${VALID_SECTIONS.join(", ")}` });
    }

    const wantsForce = checkForceKey(req, res);
    if (wantsForce === null) return; // response already sent

    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const limit = Math.min(48, Math.max(1, parseInt(req.query.limit, 10) || 24));

    const allProducts = req.query.group
      ? await getGroupProducts(section, req.query.group, { force: wantsForce })
      : await getGenderProducts(section, { force: wantsForce });

    const products = allProducts.slice(offset, offset + limit);

    res.json({
      section,
      group: req.query.group || null,
      products,
      total: allProducts.length,
      hasMore: offset + limit < allProducts.length,
    });
  } catch (err) {
    console.error("Catalog error:", err);
    res.status(500).json({ error: "Could not load the product catalog." });
  }
});

// GET /api/catalog/leaves?section=dames&group=Tops%20%26%20Sets&force=true
// Returns the group's products pre-sorted into one labeled section per
// exact taxonomy leaf (e.g. "Women's Camis", "Jumpsuits", "Lady Dresses"),
// matching your spec doc's structure instead of one mixed grid.
router.get("/catalog/leaves", async (req, res) => {
  try {
    const section = req.query.section;
    const group = req.query.group;
    if (!VALID_SECTIONS.includes(section)) {
      return res.status(400).json({ error: `section must be one of ${VALID_SECTIONS.join(", ")}` });
    }
    if (!group) {
      return res.status(400).json({ error: "group is required" });
    }

    const wantsForce = checkForceKey(req, res);
    if (wantsForce === null) return;

    const leaves = await getGroupProductsByLeaf(section, group, { force: wantsForce });
    res.json({ section, group, leaves });
  } catch (err) {
    console.error("Leaves error:", err);
    res.status(500).json({ error: "Could not load this category's sub-sections." });
  }
});

// GET /api/catalog/new?offset=0&limit=24&force=true
// Homepage feed: "new arrivals" (CJ's productFlag=1), mixed from both
// genders, with the same offset/limit slicing for infinite scroll. Placed
// ABOVE /catalog/:pid so Express doesn't treat "new" as a :pid value.
router.get("/catalog/new", async (req, res) => {
  try {
    const wantsForce = checkForceKey(req, res);
    if (wantsForce === null) return;

    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const limit = Math.min(48, Math.max(1, parseInt(req.query.limit, 10) || 24));

    // Sequential, not parallel — CJ rate-limits some endpoints to 1
    // request/second, so fetching both genders at once can trigger 429s.
    const perSection = [];
    for (const section of VALID_SECTIONS) {
      const products = await getNewProducts(section, { force: wantsForce });
      perSection.push(products.map((p) => ({ ...p, section })));
    }

    const allProducts = perSection.flat().sort((a, b) => (b.listedNum || 0) - (a.listedNum || 0));
    const products = allProducts.slice(offset, offset + limit);

    res.json({ products, total: allProducts.length, hasMore: offset + limit < allProducts.length });
  } catch (err) {
    console.error("New arrivals error:", err);
    res.status(500).json({ error: "Could not load new arrivals." });
  }
});

// GET /api/catalog/:pid — details + variants (needed to get the cjVid for checkout)
router.get("/catalog/:pid", async (req, res) => {
  try {
    const product = await getProductVariants(req.params.pid);
    res.json(product);
  } catch (err) {
    console.error("Product detail error:", err);
    res.status(500).json({ error: "Could not load product details." });
  }
});

module.exports = router;
