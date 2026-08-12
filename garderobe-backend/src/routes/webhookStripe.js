const express = require("express");
const store = require("../lib/store");
const { constructWebhookEvent, getCheckoutSession } = require("../lib/stripe");
const cj = require("../lib/cjClient");

const router = express.Router();

// Let op: dit bestand wordt in server.js gemount als
//   app.use("/api/webhooks/stripe", express.raw({...}), webhookStripeRoutes)
// dus de route hieronder is "/" — niet "/webhooks/stripe" nogmaals, anders
// zou het uiteindelijke pad /api/webhooks/stripe/webhooks/stripe worden.
router.post("/", async (req, res) => {
  let event;
  try {
    event = constructWebhookEvent(req.body, req.headers["stripe-signature"]);
  } catch (err) {
    console.error("Stripe webhook handtekening ongeldig:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      const session = event.data.object;
      const orderId = session.metadata?.orderId;
      const order = orderId && store.getOrder(orderId);

      if (!order) {
        console.warn(`Geen lokale order gevonden voor Stripe-sessie ${session.id}`);
        return res.sendStatus(200);
      }

      if (order.status === "pending") {
        // Haal de sessie nogmaals op (met breakdown) zodat we ook het
        // exacte, door Stripe Tax berekende btw-bedrag kunnen bewaren —
        // én het verzendadres dat Stripe tijdens het afrekenen heeft
        // opgevraagd (dat hadden we bij het aanmaken van de order nog niet).
        const fullSession = await getCheckoutSession(session.id);

        // Stripe geeft het adres terug via shipping_details (indien
        // shipping_address_collection aan stond) met customer_details als
        // fallback. Check bij twijfel de actuele veldnamen in Stripe's
        // Checkout Session API-referentie — dit onderdeel van hun API
        // verandert wel eens.
        const addressSource = fullSession.shipping_details || fullSession.customer_details;
        const shipping = {
          name: addressSource?.name || fullSession.customer_details?.name || "",
          address1: addressSource?.address?.line1 || "",
          address2: addressSource?.address?.line2 || "",
          city: addressSource?.address?.city || "",
          province: addressSource?.address?.state || addressSource?.address?.city || "",
          postalCode: addressSource?.address?.postal_code || "",
          country: addressSource?.address?.country || "",
          countryCode: addressSource?.address?.country || "",
          phone: fullSession.customer_details?.phone || "",
        };

        store.updateOrder(order.id, {
          status: "paid",
          shipping,
          amountPaid: (fullSession.amount_total || 0) / 100,
          taxAmount: (fullSession.total_details?.amount_tax || 0) / 100,
        });

        const updatedOrder = store.getOrder(order.id);

        try {
          const cjResult = await cj.createCjOrder(updatedOrder);
          store.updateOrder(order.id, {
            status: "cj_created",
            cjOrderId: cjResult.orderId,
          });
        } catch (cjErr) {
          console.error(`CJ order aanmaken mislukt voor order ${order.id}:`, cjErr.message);
          store.updateOrder(order.id, { status: "cj_failed" });
        }
      }
    } else if (
      event.type === "checkout.session.expired" ||
      event.type === "checkout.session.async_payment_failed"
    ) {
      const session = event.data.object;
      const orderId = session.metadata?.orderId;
      const order = orderId && store.getOrder(orderId);
      if (order) store.updateOrder(order.id, { status: "failed" });
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Stripe webhook verwerking mislukt:", err);
    res.sendStatus(500);
  }
});

module.exports = router;
