const express = require("express");
const { getTrendingProducts, getNewProducts, getProductVariants } = require("../lib/cjCatalog");

const router = express.Router();

const VALID_SECTIONS = ["dames", "heren", "accessoires"];

// GET /api/catalog?section=dames&force=true
// Geeft de automatisch-trending producten voor die sectie terug (gecachet
// voor een week). `force=true` negeert de cache en haalt direct verse data
// op bij CJ — handig na een wijziging in de categorie-matching, zonder dat
// je een hele week hoeft te wachten. Beveiligd met een simpele sleutel
// zodat niet iedereen zomaar jouw CJ-quotum kan opsouperen door dit
// herhaaldelijk aan te roepen.
router.get("/catalog", async (req, res) => {
  try {
    const section = req.query.section;
    if (!VALID_SECTIONS.includes(section)) {
      return res.status(400).json({ error: `section moet één van ${VALID_SECTIONS.join(", ")} zijn` });
    }

    const wantsForce = req.query.force === "true";
    if (wantsForce && req.query.key !== process.env.ADMIN_REFRESH_KEY) {
      return res.status(403).json({ error: "Ongeldige of ontbrekende key voor force-refresh." });
    }

    const products = await getTrendingProducts(section, { force: wantsForce });
    res.json({ section, products });
  } catch (err) {
    console.error("Catalog error:", err);
    res.status(500).json({ error: "Kon productcatalogus niet ophalen." });
  }
});

// GET /api/catalog/new?force=true
// Homepage-feed: "nieuw binnen" producten (CJ's productFlag=1), gemixt uit
// alle drie de secties. Let op: deze route staat BOVEN /catalog/:pid zodat
// Express "new" niet per ongeluk als een :pid-waarde interpreteert.
router.get("/catalog/new", async (req, res) => {
  try {
    const wantsForce = req.query.force === "true";
    if (wantsForce && req.query.key !== process.env.ADMIN_REFRESH_KEY) {
      return res.status(403).json({ error: "Ongeldige of ontbrekende key voor force-refresh." });
    }

    const perSection = await Promise.all(
      VALID_SECTIONS.map((section) =>
        getNewProducts(section, { size: 8, force: wantsForce }).then((products) =>
          products.map((p) => ({ ...p, section }))
        )
      )
    );

    // Mix de secties door elkaar i.p.v. ze achter elkaar te plakken, en
    // sorteer op populariteit zodat de beste "nieuw"-producten bovenaan staan.
    const products = perSection.flat().sort((a, b) => (b.listedNum || 0) - (a.listedNum || 0));

    res.json({ products });
  } catch (err) {
    console.error("New arrivals error:", err);
    res.status(500).json({ error: "Kon nieuwe producten niet ophalen." });
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
