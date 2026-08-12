const express = require("express");
const { getTrendingProducts, getProductVariants } = require("../lib/cjCatalog");

const router = express.Router();

const VALID_SECTIONS = ["dames", "heren", "accessoires"];

// GET /api/catalog?section=dames
// Geeft de automatisch-trending producten voor die sectie terug (gecachet).
router.get("/catalog", async (req, res) => {
  try {
    const section = req.query.section;
    if (!VALID_SECTIONS.includes(section)) {
      return res.status(400).json({ error: `section moet één van ${VALID_SECTIONS.join(", ")} zijn` });
    }
    const products = await getTrendingProducts(section);
    res.json({ section, products });
  } catch (err) {
    console.error("Catalog error:", err);
    res.status(500).json({ error: "Kon productcatalogus niet ophalen." });
  }
});

// GET /api/catalog/:pid  — details + varianten (nodig om cjVid te krijgen voor checkout)
router.get("/catalog/:pid", async (req, res) => {
  try {
    const product = await getProductVariants(req.params.pid);
    res.json(product);
  } catch (err) {
    console.error("Product detail error:", err);
    res.status(500).json({ error: "Kon productdetails niet ophalen." });
  }
});

module.exports = router;
