const express = require("express");
const store = require("../lib/store");

const router = express.Router();

// CJ stuurt (indien geconfigureerd in je CJ-dashboard onder Webhooks) updates
// over orderstatus en tracking. Pas de payload-vorm aan zodra je de exacte
// structuur uit jouw CJ-dashboard hebt gezien — dit is de gedocumenteerde vorm.
router.post("/webhooks/cj", async (req, res) => {
  try {
    const { cjOrderId, orderStatus, trackNumber, trackingProvider } = req.body;

    const order = store.findByCjOrderId(cjOrderId);
    if (!order) {
      console.warn(`Geen lokale order gevonden voor CJ order ${cjOrderId}`);
      return res.sendStatus(200);
    }

    store.updateOrder(order.id, {
      status: orderStatus === "DELIVERED" ? "delivered" : "shipped",
      trackNumber: trackNumber || order.trackNumber,
      trackingProvider: trackingProvider || order.trackingProvider,
    });

    res.sendStatus(200);
  } catch (err) {
    console.error("CJ webhook error:", err);
    res.sendStatus(500);
  }
});

module.exports = router;
