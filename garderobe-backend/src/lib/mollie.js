// Mollie-client: maakt de betaling aan die de klant op jouw site doet
// (iDEAL, creditcard, etc). Dit is losstaand van de CJ-betaling — de klant
// betaalt jou via Mollie, en jij betaalt apart je CJ-tegoed aan voor de
// kostprijs + verzending.

const { createMollieClient } = require("@mollie/api-client");

const mollieClient = createMollieClient({ apiKey: process.env.MOLLIE_API_KEY });

async function createPayment({ orderId, amount, description, email }) {
  const payment = await mollieClient.payments.create({
    amount: {
      currency: "EUR",
      value: amount.toFixed(2), // Mollie wil een string met 2 decimalen, bv. "49.95"
    },
    description,
    redirectUrl: `${process.env.FRONTEND_SUCCESS_URL}?order=${orderId}`,
    webhookUrl: `${process.env.BASE_URL}/api/webhooks/mollie`,
    metadata: { orderId },
    ...(email ? { billingEmail: email } : {}),
  });
  return payment;
}

async function getPayment(paymentId) {
  return mollieClient.payments.get(paymentId);
}

module.exports = { createPayment, getPayment };
