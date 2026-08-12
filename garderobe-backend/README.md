# Garderobe backend — checkout → Stripe → CJ Dropshipping

Backend order-flow: de klant betaalt via Stripe Checkout (met automatische
btw-berekening via Stripe Tax), en zodra de betaling binnen is, wordt er
automatisch een fulfillment-order bij CJ Dropshipping aangemaakt.

## De flow

```
Klant vult winkelmandje + adres in
        │
        ▼
POST /api/checkout            (jouw frontend roept dit aan)
   → maakt lokale order aan (status: pending)
   → maakt Stripe Checkout Session aan (met automatic_tax)
   → geeft checkoutUrl terug
        │
        ▼
Klant wordt doorgestuurd naar Stripe Checkout, betaalt (iDEAL/creditcard/etc),
Stripe berekent en toont automatisch de juiste btw
        │
        ▼
Stripe stuurt webhook  →  POST /api/webhooks/stripe
   → we verifiëren de handtekening en lezen het event
   → bij checkout.session.completed: lokale order → status "paid"
   → we roepen CJ's createOrderV3 aan  → status "cj_created"
        │
        ▼
CJ verwerkt & verstuurt het pakket, stuurt op termijn tracking door
   → POST /api/webhooks/cj  (als je dit in je CJ-dashboard instelt)
   → we slaan trackNumber/trackingProvider op, status → "shipped"
```

## Automatische productcatalogus (geen handmatige curatie)

`GET /api/catalog?section=dames|heren|accessoires` geeft automatisch de
trending producten uit die sectie terug:

- We matchen CJ's categorieboom op naam ("Women's Clothing" → dames,
  "Men's Clothing" → heren, alles met accessoires/jewelry/bag/belt/etc. in
  de naam → accessoires). Zie `SECTION_MATCHERS` in `src/lib/cjCatalog.js`
  als je dit wilt bijstellen.
- We vragen CJ's eigen `productFlag=0` (Trending products) op, gesorteerd
  op populariteit, gefilterd op geverifieerde voorraad.
- Resultaten worden **een week** gecachet (`data/cj-trending-cache.json`).
  Zo krijgt elk getoond product de tijd om te "ademen" voordat de lijst
  ververst. Tussentijds verversen kan met
  `getTrendingProducts(section, { force: true })`.
- `GET /api/catalog/:pid` haalt de varianten (maat/kleur + het `vid` dat
  je nodig hebt bij checkout) van één product op.
- Verkoopprijs = CJ-inkoopprijs × `PRICE_MARKUP_MULTIPLIER` (in `.env`,
  standaard 1.6 = 60% marge).

## Handmatige facturen (Stripe Invoicing)

`POST /api/invoices/manual` maakt en verstuurt een Stripe-factuur buiten de
normale Checkout-flow om — handig voor een los B2B-order dat je zelf
afhandelt, of een correctiefactuur.

```json
{
  "email": "klant@bedrijf.nl",
  "name": "Klant Bedrijfsnaam",
  "items": [{ "name": "Wollen Overjas", "price": 199.0, "qty": 3 }],
  "note": "Wholesale order augustus"
}
```

**Let op:** deze route heeft nog geen authenticatie. Voeg voordat je live
gaat een check toe (bv. een admin-token in de header), anders kan in
theorie iedereen die de URL kent facturen namens jouw Stripe-account
versturen.

## Setup

```bash
npm install
cp .env.example .env
```

Vul in `.env` in:

- **STRIPE_SECRET_KEY** — Stripe Dashboard → Developers → API keys. Begin
  met de `sk_test_...` sleutel.
- **STRIPE_WEBHOOK_SECRET** — Stripe Dashboard → Developers → Webhooks →
  jouw endpoint → Signing secret. Lokaal testen: installeer de Stripe CLI
  en run `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
  — die geeft een tijdelijke `whsec_...` in de terminal.
- **Stripe Tax activeren**: eenmalig in het Dashboard onder "Tax" —
  zonder deze stap berekent `automatic_tax` geen btw, ook niet als de
  code het aanvraagt.
- **CJ_API_KEY** — CJ personal center → API tab → "Add API".
- **BASE_URL** — publiek bereikbare URL van deze backend (voor de
  webhook-registratie bij Stripe).
- **FRONTEND_SUCCESS_URL / FRONTEND_CANCEL_URL** — waar de klant naartoe
  gaat na (mislukte) betaling.

Start de server:

```bash
npm start
```

## Stripe webhook lokaal instellen

```bash
stripe login
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Dit print een `whsec_...` — zet die in `.env` als `STRIPE_WEBHOOK_SECRET`.
In productie maak je in plaats daarvan een webhook-endpoint aan in het
Stripe Dashboard, wijzend naar `https://<jouw-domein>/api/webhooks/stripe`,
en gebruik je de signing secret die dáár getoond wordt.

## Wat je zelf nog moet koppelen

1. **Frontend ↔ backend**: `garderobe-store.jsx` haalt live
   `/api/catalog?section=...` op. Zet `API_BASE` (of `VITE_API_BASE` in
   het Vite-project) op je backend-URL.
2. **Verzendadres**: Stripe Checkout vraagt zelf het verzendadres uit
   (nodig voor Stripe Tax) — je hoeft dus niet meer zelf een adresformulier
   te bouwen vóór de checkout-aanroep, in tegenstelling tot de eerdere
   Mollie-opzet.
3. **CJ webhook instellen**: in je CJ-dashboard onder Webhooks, geef
   `https://<jouw-domein>/api/webhooks/cj` op.
4. **CJ-tegoed**: `payType: 2` in `cjClient.js` betekent dat de order
   betaald wordt vanuit jouw CJ-balans.
5. **Van test naar productie**: vervang de JSON-bestandsopslag in
   `src/lib/store.js` door een echte database zodra je live gaat.
6. **Stripe Connect**: bewust weggelaten. Connect is voor marktplaatsen
   waarbij andere partijen zelf een Stripe-account bij jouw platform
   aanmaken en automatisch een deel van elke betaling ontvangen — dat
   past niet bij CJ als leverancier (CJ heeft geen Stripe-account bij
   jou en wordt apart, via je CJ-tegoed, betaald). Mocht je ooit echte
   externe verkopers toelaten die zelf hun producten aanbieden, is dát
   het moment om Connect alsnog toe te voegen.

## Naar GitHub

```bash
git init
git add .
git commit -m "Initial commit: Garderobe backend"
git branch -M main
git remote add origin https://github.com/<jouw-gebruikersnaam>/garderobe-backend.git
git push -u origin main
```

## Hosten (Railway)

1. railway.app → login met GitHub → New Project → Deploy from GitHub repo
   → selecteer `garderobe-backend`.
2. Onder "Variables": voeg alle variabelen uit `.env.example` toe met je
   echte waarden.
3. Onder "Settings" → "Networking": genereer een publiek domein.
4. Zet dat domein in Stripe Dashboard → Webhooks als endpoint-URL
   (`https://<domein>/api/webhooks/stripe`), en kopieer de daar getoonde
   signing secret naar `STRIPE_WEBHOOK_SECRET` in Railway's Variables.
5. Zet hetzelfde domein in je CJ-dashboard onder Webhooks
   (`https://<domein>/api/webhooks/cj`).
6. Gebruik dit domein als `VITE_API_BASE` in je frontend.

Let op: bestand-gebaseerde opslag in `src/lib/store.js` is niet
gegarandeerd persistent tussen Railway-deploys — voor productie is een
echte database de volgende stap.

## Testen zonder echt geld

- Stripe: gebruik je `sk_test_...` sleutel en Stripe's testkaartnummers
  (bv. 4242 4242 4242 4242) om testbetalingen te simuleren.
- CJ: zet `isSandbox: 1` in het orderpayload in `cjClient.js` tijdens het
  testen — dan doet CJ alsof, zonder echte verzending of kosten.
