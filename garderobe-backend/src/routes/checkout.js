const express = require("express");
const store = require("../lib/store");
const { createCheckoutSession } = require("../lib/stripe");

const router = express.Router();

// POST /api/checkout
// body: { items: [{ productId, name, price, qty, cjVid }], email? }
//
// Let op: we vragen hier GEEN verzendadres meer op — Stripe Checkout doet
// dat zelf tijdens het betalen (nodig voor Stripe Tax om het juiste
// btw-tarief te bepalen). Het adres komt pas binnen via de webhook nadat
// de klant heeft betaald; zie routes/webhookStripe.js.
router.post("/checkout", async (req, res) => {
  try {
    const { items, email } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Winkelmandje is leeg." });
    }
    for (const item of items) {
      if (!item.cjVid) {
        return res.status(400).json({
          error: `Product "${item.name}" mist een cjVid (CJ variant-ID) — nodig om later bij CJ te kunnen bestellen.`,
        });
      }
    }

    const totalAmount = items.reduce((sum, i) => sum + i.price * i.qty, 0);

    const order = store.createOrder({ items, shipping: null, email, totalAmount });

    const session = await createCheckoutSession({
      orderId: order.id,
      items,
      email,
    });

    store.updateOrder(order.id, { stripeSessionId: session.id });

    res.json({
      orderId: order.id,
      checkoutUrl: session.url,
    });
  } catch (err) {
    console.error("Checkout error:", err);
    res.status(500).json({ error: "Er ging iets mis bij het starten van de betaling." });
  }
});

// GET /api/orders/:id  — voor de frontend om orderstatus te tonen na terugkeer van Stripe
router.get("/orders/:id", (req, res) => {
  const order = store.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "Order niet gevonden." });
  res.json(order);
});

module.exports = router;
