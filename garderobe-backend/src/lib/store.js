// Lichtgewicht bestand-gebaseerde opslag voor orders.
// Prototype-niveau: prima om de flow te testen. Voor productie: vervang dit
// door een echte database (bv. PostgreSQL) zodat je gelijktijdige writes,
// backups en query's netjes kunt afhandelen.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DB_PATH = path.join(__dirname, "..", "..", "data", "orders.json");

function readAll() {
  if (!fs.existsSync(DB_PATH)) return {};
  const raw = fs.readFileSync(DB_PATH, "utf-8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function writeAll(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function createOrder({ items, shipping, email, totalAmount }) {
  const id = crypto.randomUUID();
  const orders = readAll();
  orders[id] = {
    id,
    status: "pending", // pending -> paid -> cj_created -> shipped -> delivered | failed
    items,
    shipping,
    email,
    totalAmount,
    molliePaymentId: null,
    cjOrderId: null,
    trackNumber: null,
    trackingProvider: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeAll(orders);
  return orders[id];
}

function getOrder(id) {
  const orders = readAll();
  return orders[id] || null;
}

function findByMolliePaymentId(paymentId) {
  const orders = readAll();
  return Object.values(orders).find((o) => o.molliePaymentId === paymentId) || null;
}

function findByCjOrderId(cjOrderId) {
  const orders = readAll();
  return Object.values(orders).find((o) => o.cjOrderId === cjOrderId) || null;
}

function updateOrder(id, patch) {
  const orders = readAll();
  if (!orders[id]) throw new Error(`Order ${id} bestaat niet`);
  orders[id] = { ...orders[id], ...patch, updatedAt: new Date().toISOString() };
  writeAll(orders);
  return orders[id];
}

module.exports = {
  createOrder,
  getOrder,
  findByMolliePaymentId,
  findByCjOrderId,
  updateOrder,
};
