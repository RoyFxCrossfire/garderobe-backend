const express = require("express");
const store = require("../lib/store");
const mollie = require("../lib/mollie");

const router = express.Router();

// POST /api/checkout
// body: {
//   items: [{ productId, name, price, qty, cjVid }],
//   shipping: { name, address1, address2, city, province, postalCode, country, countryCode, phone, houseNumber },
//   email
// }
router.post("/checkout", async (req, res) => {
  try {
    const { items, shipping, email } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Winkelmandje is leeg." });
    }
    if (!shipping || !shipping.countryCode || !shipping.address1) {
      return res.status(400).json({ error: "Verzendgegevens ontbreken of zijn onvolledig." });
    }
    for (const item of items) {
      if (!item.cjVid) {
        return res.status(400).json({
          error: `Product "${item.name}" mist een cjVid (CJ variant-ID) — nodig om later bij CJ te kunnen bestellen.`,
        });
      }
    }

    const totalAmount = items.reduce((sum, i) => sum + i.price * i.qty, 0);

    const order = store.createOrder({ items, shipping, email, totalAmount });

    const payment = await mollie.createPayment({
      orderId: order.id,
      amount: totalAmount,
      description: `Garderobe bestelling ${order.id.slice(0, 8)}`,
      email,
    });

    store.updateOrder(order.id, { molliePaymentId: payment.id });

    res.json({
      orderId: order.id,
      checkoutUrl: payment.getCheckoutUrl(),
    });
  } catch (err) {
    console.error("Checkout error:", err);
    res.status(500).json({ error: "Er ging iets mis bij het starten van de betaling." });
  }
});

// GET /api/orders/:id  — voor de frontend om orderstatus te tonen na terugkeer van Mollie
router.get("/orders/:id", (req, res) => {
  const order = store.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "Order niet gevonden." });
  res.json(order);
});

module.exports = router;
