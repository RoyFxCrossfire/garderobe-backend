require("dotenv").config();
const express = require("express");
const checkoutRoutes = require("./routes/checkout");
const webhookStripeRoutes = require("./routes/webhookStripe");
const webhookCjRoutes = require("./routes/webhookCj");
const catalogRoutes = require("./routes/catalog");
const invoiceRoutes = require("./routes/invoices");

const app = express();

// BELANGRIJK: de Stripe-webhook heeft de RAUWE request body nodig om de
// handtekening te verifiëren (constructWebhookEvent in lib/stripe.js).
// Daarom mounten we hem apart, met express.raw() i.p.v. express.json() —
// zodra express.json() een keer over de body heen is gegaan, is de rauwe
// vorm weg en klopt Stripe's handtekeningcheck niet meer. Deze route moet
// vóór de algemene express.json() hieronder blijven staan.
app.use(
  "/api/webhooks/stripe",
  express.raw({ type: "application/json" }),
  webhookStripeRoutes
);

app.use("/api", express.json());
app.use("/api", checkoutRoutes);
app.use("/api", webhookCjRoutes);
app.use("/api", catalogRoutes);
app.use("/api", invoiceRoutes);

app.get("/health", (_req, res) => res.json({ ok: true }));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Garderobe backend draait op http://localhost:${port}`);
});
