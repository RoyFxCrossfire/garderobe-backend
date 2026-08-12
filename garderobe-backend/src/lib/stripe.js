// Stripe-client voor Payments + Tax. Vervangt de eerdere Mollie-integratie.
//
// We gebruiken Stripe Checkout Sessions (mode: "payment") met
// automatic_tax ingeschakeld — Stripe Tax berekent dan zelf de juiste
// btw op basis van het (door de klant ingevulde) verzendadres, i.p.v.
// dat jij zelf btw-tarieven per land moet bijhouden.

const Stripe = require("stripe");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

async function createCheckoutSession({ orderId, items, email }) {
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: email || undefined,
    line_items: items.map((item) => ({
      quantity: item.qty,
      price_data: {
        currency: "eur",
        unit_amount: Math.round(item.price * 100), // Stripe rekent in centen
        product_data: { name: item.name },
        tax_behavior: "exclusive", // prijs is excl. btw; Stripe Tax telt 'm erbij op
      },
    })),
    automatic_tax: { enabled: true },
    // Stripe Tax heeft een adres nodig om het juiste tarief te bepalen;
    // dit vraagt het verzendadres netjes uit in de Checkout-pagina zelf.
    shipping_address_collection: {
      allowed_countries: ["NL", "BE", "DE", "FR", "LU"],
    },
    success_url: `${process.env.FRONTEND_SUCCESS_URL}?order=${orderId}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.FRONTEND_CANCEL_URL || process.env.FRONTEND_SUCCESS_URL}?order=${orderId}&cancelled=1`,
    metadata: { orderId },
  });
  return session;
}

async function getCheckoutSession(sessionId) {
  return stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["total_details.breakdown"],
  });
}

// Verifieert dat een binnenkomende webhook-payload echt van Stripe komt.
// `rawBody` moet de ONGEPARSTE request body zijn (zie server.js voor de
// express.raw() instelling op deze specifieke route).
function constructWebhookEvent(rawBody, signatureHeader) {
  return stripe.webhooks.constructEvent(
    rawBody,
    signatureHeader,
    process.env.STRIPE_WEBHOOK_SECRET
  );
}

module.exports = { stripe, createCheckoutSession, getCheckoutSession, constructWebhookEvent };
