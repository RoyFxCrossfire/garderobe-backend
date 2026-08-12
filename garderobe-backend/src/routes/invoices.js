const express = require("express");
const { createManualInvoice } = require("../lib/stripeInvoicing");

const router = express.Router();

// POST /api/invoices/manual
// Voor facturen buiten de normale Checkout-flow om (bv. een los B2B-order
// dat je zelf per e-mail afhandelt, of een correctiefactuur).
//
// LET OP: deze route heeft nog geen authenticatie — voeg voordat je live
// gaat een check toe (bv. een admin-token) zodat niet zomaar iedereen
// facturen namens jouw Stripe-account kan versturen.
//
// body: { email, name, items: [{ name, price, qty }], note? }
router.post("/invoices/manual", async (req, res) => {
  try {
    const { email, name, items, note } = req.body;
    if (!email || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "email en items zijn verplicht." });
    }

    const invoice = await createManualInvoice({ email, name, items, note });

    res.json({
      invoiceId: invoice.id,
      hostedInvoiceUrl: invoice.hosted_invoice_url,
      pdfUrl: invoice.invoice_pdf,
      status: invoice.status,
    });
  } catch (err) {
    console.error("Factuur aanmaken mislukt:", err);
    res.status(500).json({ error: "Kon factuur niet aanmaken." });
  }
});

module.exports = router;
