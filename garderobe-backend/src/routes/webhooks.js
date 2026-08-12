const express = require("express");
const store = require("../lib/store");
const mollie = require("../lib/mollie");
const cj = require("../lib/cjClient");

const router = express.Router();

// Mollie stuurt bij elke statuswijziging een POST met alleen { id: "tr_xxx" }.
// Wij moeten zelf de actuele status terugvragen — vertrouw nooit de payload zelf.
router.post(
  "/webhooks/mollie",
  express.urlencoded({ extended: false }),
  async (req, res) => {
    try {
      const paymentId = req.body.id;
      if (!paymentId) return res.sendStatus(400);

      const payment = await mollie.getPayment(paymentId);
      const order = store.findByMolliePaymentId(paymentId);
      if (!order) {
        console.warn(`Geen lokale order gevonden voor Mollie-betaling ${paymentId}`);
        return res.sendStatus(200); // toch 200, anders blijft Mollie retryen
      }

      if (payment.isPaid() && order.status === "pending") {
        store.updateOrder(order.id, { status: "paid" });

        // Betaling binnen -> plaats de order bij CJ voor fulfillment
        try {
          const cjResult = await cj.createCjOrder(order);
          store.updateOrder(order.id, {
            status: "cj_created",
            cjOrderId: cjResult.orderId,
          });
        } catch (cjErr) {
          // Betaling was geslaagd maar CJ-order mislukte: dit moet je zelf
          // oppikken (bv. via alerting) en evt. handmatig plaatsen bij CJ.
          console.error(`CJ order aanmaken mislukt voor order ${order.id}:`, cjErr.message);
          store.updateOrder(order.id, { status: "cj_failed" });
        }
      } else if (payment.isCanceled() || payment.isExpired() || payment.isFailed()) {
        store.updateOrder(order.id, { status: "failed" });
      }

      res.sendStatus(200);
    } catch (err) {
      console.error("Mollie webhook error:", err);
      res.sendStatus(500);
    }
  }
);

// CJ stuurt (indien geconfigureerd in je CJ-dashboard onder Webhooks) updates
// over orderstatus en tracking. Pas de payload-vorm aan zodra je de exacte
// structuur uit jouw CJ-dashboard hebt gezien — dit is de gedocumenteerde vorm.
router.post("/webhooks/cj", express.json(), async (req, res) => {
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

    // Hier zou je bv. een e-mail met track&trace naar de klant kunnen sturen.

    res.sendStatus(200);
  } catch (err) {
    console.error("CJ webhook error:", err);
    res.sendStatus(500);
  }
});

module.exports = router;
