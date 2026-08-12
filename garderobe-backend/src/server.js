require("dotenv").config();
const express = require("express");
const checkoutRoutes = require("./routes/checkout");
const webhookRoutes = require("./routes/webhooks");
const catalogRoutes = require("./routes/catalog");

const app = express();

// express.json() parseert alleen content-type application/json, dus de
// Mollie-webhook (die x-www-form-urlencoded stuurt en zijn eigen parser
// declareert in webhooks.js) wordt hierdoor niet geraakt.
app.use("/api", express.json());
app.use("/api", checkoutRoutes);
app.use("/api", webhookRoutes);
app.use("/api", catalogRoutes);

app.get("/health", (_req, res) => res.json({ ok: true }));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Garderobe backend draait op http://localhost:${port}`);
});
