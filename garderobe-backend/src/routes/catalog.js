const express = require("express");
const {
  getTaxonomy,
  getGenderProducts,
  getGroupProducts,
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

// GET /api/catalog?section=dames&group=Bottoms&force=true
// Without `group`: the whole gender's catalog, sorted by popularity.
// With `group`: only that sub-category (matches the taxonomy doc).
router.get("/catalog", async (req, res) => {
  try {
    const section = req.query.section;
    if (!VALID_SECTIONS.includes(section)) {
      return res.status(400).json({ error: `section must be one of ${VALID_SECTIONS.join(", ")}` });
    }

    const wantsForce = checkForceKey(req, res);
    if (wantsForce === null) return; // response already sent

    const products = req.query.group
      ? await getGroupProducts(section, req.query.group, { force: wantsForce })
      : await getGenderProducts(section, { force: wantsForce });

    res.json({ section, group: req.query.group || null, products });
  } catch (err) {
    console.error("Catalog error:", err);
    res.status(500).json({ error: "Could not load the product catalog." });
  }
});

// GET /api/catalog/new?force=true
// Homepage feed: "new arrivals" (CJ's productFlag=1), mixed from both
// genders. Placed ABOVE /catalog/:pid so Express doesn't treat "new" as a
// :pid value.
router.get("/catalog/new", async (req, res) => {
  try {
    const wantsForce = checkForceKey(req, res);
    if (wantsForce === null) return;

    // Sequential, not parallel — CJ rate-limits some endpoints to 1
    // request/second, so fetching both genders at once can trigger 429s.
    const perSection = [];
    for (const section of VALID_SECTIONS) {
      const products = await getNewProducts(section, { size: 8, force: wantsForce });
      perSection.push(products.map((p) => ({ ...p, section })));
    }

    const products = perSection.flat().sort((a, b) => (b.listedNum || 0) - (a.listedNum || 0));
    res.json({ products });
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
