# Garderobe backend — checkout → Mollie → CJ Dropshipping

Dit is de backend order-flow: de klant betaalt via Mollie op jouw site, en zodra
de betaling binnen is, wordt er automatisch een fulfillment-order bij CJ
Dropshipping aangemaakt.

## De flow

```
Klant vult winkelmandje + adres in
        │
        ▼
POST /api/checkout            (jouw frontend roept dit aan)
   → maakt lokale order aan (status: pending)
   → maakt Mollie-betaling aan
   → geeft checkoutUrl terug
        │
        ▼
Klant wordt doorgestuurd naar Mollie, betaalt (iDEAL/creditcard/etc)
        │
        ▼
Mollie stuurt webhook  →  POST /api/webhooks/mollie
   → wij vragen de actuele betaalstatus op bij Mollie
   → als betaald: lokale order → status "paid"
   → wij roepen CJ's createOrderV3 aan  → status "cj_created"
        │
        ▼
CJ verwerkt & verstuurt het pakket, stuurt op termijn tracking door
   → POST /api/webhooks/cj  (als je dit in je CJ-dashboard instelt)
   → wij slaan trackNumber/trackingProvider op, status → "shipped"
```

## Setup

```bash
npm install
cp .env.example .env
```

Vul in `.env` in:

- **MOLLIE_API_KEY** — Mollie Dashboard → Ontwikkelaars → API-sleutels. Begin met de `test_...` sleutel.
- **CJ_API_KEY** — CJ personal center → API tab → "Add API". Formaat: `CJUserNum@api@...`
- **BASE_URL** — publiek bereikbare URL van deze backend. Mollie kan niet naar
  `localhost` webhooken; gebruik lokaal `ngrok http 3000` (of Cloudflare Tunnel)
  en zet die tijdelijke URL hier neer tijdens het testen.
- **FRONTEND_SUCCESS_URL** — waar de klant naartoe gaat ná betaling op jouw site.

Start de server:

```bash
npm start
```

## Wat je zelf nog moet koppelen

1. **Frontend → `/api/checkout`**: in de winkelwagen-drawer die ik eerder
   heb gebouwd (`garderobe-store.jsx`), moet de "Naar afrekenen"-knop een
   `POST /api/checkout` doen met de cart-items (elk met een `cjVid` — dat
   haal je op via CJ's Product-API bij het importeren van je catalogus) en
   het ingevulde verzendadres, en vervolgens doorsturen naar de
   `checkoutUrl` die terugkomt.
2. **CJ webhook instellen**: in je CJ-dashboard onder Webhooks, geef
   `https://<jouw-domein>/api/webhooks/cj` op zodat trackingupdates
   automatisch binnenkomen. De exacte veldnamen in de payload kun je
   verifiëren zodra je de eerste test-webhook ontvangt — pas
   `src/routes/webhooks.js` daarop aan indien nodig.
3. **CJ-tegoed**: `payType: 2` in `cjClient.js` betekent dat de order
   betaald wordt vanuit jouw CJ-balans. Zorg dat je CJ-account voldoende
   saldo heeft, of wijzig naar `payType: 1` als je liever elke keer
   handmatig/via een aparte pagina betaalt.
4. **Van test naar productie**: vervang de JSON-bestandsopslag in
   `src/lib/store.js` door een echte database zodra je live gaat — dit
   bestand is puur om de flow te kunnen testen zonder een database op te
   hoeven zetten.

## Naar GitHub

```bash
git init
git add .
git commit -m "Initial commit: Garderobe backend"
git branch -M main
git remote add origin https://github.com/<jouw-gebruikersnaam>/garderobe-backend.git
git push -u origin main
```

(Maak eerst een lege repo aan op github.com — zonder README/gitignore
aan te vinken, anders krijg je een merge-conflict bij de eerste push.)

## Hosten (Railway)

1. Ga naar railway.app, log in met je GitHub-account.
2. "New Project" → "Deploy from GitHub repo" → selecteer `garderobe-backend`.
3. Railway herkent Node.js automatisch en runt `npm install` + `npm start`.
4. Onder "Variables": voeg alle variabelen uit `.env.example` toe met je
   echte waarden (MOLLIE_API_KEY, CJ_API_KEY, etc). **BASE_URL** zet je
   pas nadat Railway een domein heeft toegekend (stap 5) — die heb je
   nodig voor de Mollie-webhook-URL.
5. Onder "Settings" → "Networking": klik "Generate Domain" voor een
   publieke `https://garderobe-backend-production.up.railway.app` URL.
   Vul die in als `BASE_URL` in de Variables (stap 4) en redeploy.
6. Zet in je CJ-dashboard onder Webhooks de URL
   `https://<jouw-railway-domein>/api/webhooks/cj` in.
7. Gebruik dezelfde Railway-domein-URL als `VITE_API_BASE` in je frontend
   (zie garderobe-frontend README).

Let op: de bestand-gebaseerde opslag in `src/lib/store.js` werkt op
Railway, maar Railway's bestandssysteem is niet garandeerd persistent
tussen deploys — voor productie is een echte database (bv. Railway's
ingebouwde PostgreSQL-add-on) de volgende stap.

## Testen zonder echt geld

- Mollie: gebruik je `test_...` API-sleutel, dan kun je testbetalingen
  simuleren in hun betaalscherm.
- CJ: zet `isSandbox: 1` in het orderpayload in `cjClient.js` tijdens het
  testen — dan doet CJ alsof, zonder echte verzending of kosten.
