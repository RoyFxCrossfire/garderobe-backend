// Client voor de CJ Dropshipping API (api2.0).
// Regelt: access-token ophalen, cachen, verversen, en orders aanmaken.
//
// Belangrijk: CJ-Access-Token leeft ~15 dagen, Refresh-Token ~180 dagen.
// We slaan beide lokaal op en verversen automatisch als de access token
// bijna verloopt. Dit bestand draait alleen op de backend — de tokens
// mogen nooit naar de frontend/browser gestuurd worden.

const fs = require("fs");
const path = require("path");
const axios = require("axios");

const CJ_BASE = "https://developers.cjdropshipping.com/api2.0/v1";
const TOKEN_PATH = path.join(__dirname, "..", "..", "data", "cj-tokens.json");

function loadTokens() {
  if (!fs.existsSync(TOKEN_PATH)) return null;
  const raw = fs.readFileSync(TOKEN_PATH, "utf-8").trim();
  return raw ? JSON.parse(raw) : null;
}

function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// CJ staat maar 1 aanvraag per seconde toe op hun authenticatie-endpoints
// ("QPS limit is 1 time/1second"). Als meerdere delen van onze code
// tegelijk een token nodig hebben (bv. de "nieuw binnen"-route die alle
// secties parallel opvraagt), zou elk apart een login-aanvraag doen en
// elkaars limiet overschrijden. Deze retry-wrapper vangt een 429 op en
// probeert het na een korte pauze automatisch opnieuw.
async function postWithRetry(url, body, { retries = 3, delayMs = 1200 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await axios.post(url, body);
    } catch (err) {
      const isRateLimited = err.response?.status === 429;
      if (!isRateLimited || attempt === retries) throw err;
      await sleep(delayMs * attempt); // elke poging iets langer wachten
    }
  }
}

async function fetchNewAccessToken() {
  const { data } = await postWithRetry(`${CJ_BASE}/authentication/getAccessToken`, {
    apiKey: process.env.CJ_API_KEY,
  });
  if (!data.result) throw new Error(`CJ auth mislukt: ${data.message}`);
  saveTokens(data.data);
  return data.data;
}

async function refreshAccessToken(refreshToken) {
  const { data } = await postWithRetry(`${CJ_BASE}/authentication/refreshAccessToken`, {
    refreshToken,
  });
  if (!data.result) {
    // Refresh token is ook verlopen/ongeldig -> volledig opnieuw inloggen
    return fetchNewAccessToken();
  }
  saveTokens(data.data);
  return data.data;
}

// Zorgt dat er nooit twee token-aanvragen tegelijk onderweg zijn: als er al
// een ophaal-actie loopt, krijgen latere aanroepers dezelfde promise terug
// in plaats van zelf nog een keer bij CJ aan te kloppen.
let inFlightTokenFetch = null;

async function getValidAccessToken() {
  if (inFlightTokenFetch) return inFlightTokenFetch;

  const run = async () => {
    let tokens = loadTokens();

    if (!tokens) {
      tokens = await fetchNewAccessToken();
      return tokens.accessToken;
    }

    const expiry = new Date(tokens.accessTokenExpiryDate).getTime();
    const oneDayMs = 24 * 60 * 60 * 1000;

    if (Date.now() > expiry - oneDayMs) {
      // Bijna verlopen (of al verlopen) -> ververs voor we hem gebruiken
      tokens = await refreshAccessToken(tokens.refreshToken);
    }

    return tokens.accessToken;
  };

  inFlightTokenFetch = run();
  try {
    return await inFlightTokenFetch;
  } finally {
    inFlightTokenFetch = null;
  }
}

// Maakt een order aan bij CJ nadat de klant succesvol heeft betaald.
// `order` komt uit onze eigen store: { id, items, shipping, email }
// items[i] moet een `cjVid` bevatten (CJ variant-ID van het gekozen product+maat/kleur).
async function createCjOrder(order) {
  const accessToken = await getValidAccessToken();

  const payload = {
    orderNumber: order.id, // koppel CJ-order aan onze eigen order-id
    shippingCustomerName: order.shipping.name,
    shippingCountryCode: order.shipping.countryCode, // bv. "NL"
    shippingCountry: order.shipping.country,
    shippingProvince: order.shipping.province || order.shipping.city,
    shippingCity: order.shipping.city,
    shippingAddress: order.shipping.address1,
    shippingAddress2: order.shipping.address2 || "",
    shippingZip: order.shipping.postalCode,
    shippingPhone: order.shipping.phone || "",
    email: order.email,
    houseNumber: order.shipping.houseNumber || "",
    remark: `Garderobe order ${order.id}`,
    logisticName: process.env.CJ_LOGISTIC_NAME || "CJPacket Ordinary",
    fromCountryCode: process.env.CJ_FROM_COUNTRY_CODE || "CN",
    platform: "Api",
    payType: 2, // 2 = betaal direct vanuit CJ-balans (jouw eigen CJ-tegoed, niet de klant)
    orderFlow: 1,
    products: order.items.map((item) => ({
      vid: item.cjVid,
      quantity: item.qty,
      storeLineItemId: `${order.id}-${item.productId}`,
    })),
  };

  const { data } = await axios.post(`${CJ_BASE}/shopping/order/createOrderV3`, payload, {
    headers: {
      "CJ-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
  });

  if (!data.result) {
    throw new Error(`CJ order aanmaken mislukt: ${data.message}`);
  }

  return data.data; // bevat o.a. orderId, orderStatus, cjPayUrl
}

module.exports = { getValidAccessToken, createCjOrder };
