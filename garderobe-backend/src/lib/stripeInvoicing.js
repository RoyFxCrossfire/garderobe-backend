// Stripe Invoicing — voor handmatige/B2B-facturen, los van de normale
// Checkout-flow (bv. een wholesale-order die je zelf per e-mail regelt,
// of een correctiefactuur). Dit stuurt Stripe's eigen gehoste factuur
// (met betaallink) naar de klant.

const { stripe } = require("./stripe");

async function findOrCreateCustomer({ email, name }) {
  const existing = await stripe.customers.list({ email, limit: 1 });
  if (existing.data.length > 0) return existing.data[0];
  return stripe.customers.create({ email, name });
}

// items: [{ name, price, qty }]
async function createManualInvoice({ email, name, items, note, daysUntilDue = 7 }) {
  const customer = await findOrCreateCustomer({ email, name });

  for (const item of items) {
    await stripe.invoiceItems.create({
      customer: customer.id,
      currency: "eur",
      description: item.name,
      quantity: item.qty,
      unit_amount: Math.round(item.price * 100),
      tax_behavior: "exclusive",
    });
  }

  const invoice = await stripe.invoices.create({
    customer: customer.id,
    collection_method: "send_invoice",
    days_until_due: daysUntilDue,
    automatic_tax: { enabled: true },
    description: note || undefined,
  });

  const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
  await stripe.invoices.sendInvoice(finalized.id);

  return finalized; // bevat o.a. hosted_invoice_url en invoice_pdf
}

module.exports = { createManualInvoice };
