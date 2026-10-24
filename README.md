# Freshroots Orders

A one-screen approval queue for purchase orders. Raghav's five forecasting rules turn sales and stock into draft POs, one per distributor. The approver opens the page, adjusts quantities if needed, and approves or rejects.

## How an order moves

```
Daily plan (cron) or "Check for new orders"
        ↓
Pending PO per distributor        ← what the approver sees first
   ├─ Reject (with a reason)      → snoozed for 3 days, can be reopened
   └─ Approve                     → "waiting for Zoho"  (undo until Zoho has it)
            ↓
      Mark received               → stock goes up, order leaves "on order"
```

Stock on an approved order counts as "on order", and a product with an open order is not proposed again until it is received.

## Planning rules (`lib/engine.ts`)

- 4-week average more than 20% above the 12-week average: high demand, order 1.5× the standard quantity.
- Stock under 6 weeks of demand: reorder now. Over 14 weeks: hold back.
- High-perishability products use 3 to 4 weeks instead.
- October, November and March add 25% to demand before any check.

## Run it

```bash
npm install
cp .env.example .env.local   # fill in APPROVER_PASSWORD, SESSION_SECRET, CRON_SECRET
npm run dev
npm test
```

With no Supabase variables set the app runs on the built-in sample data (`data/seed`), and decisions live in memory only.

## Supabase

1. Create a project.
2. In the SQL editor run `supabase/migrations/0001_init.sql`, `supabase/migrations/0002_zoho.sql`, then `supabase/seed.sql`.
3. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API) on Vercel.

The app only talks to Supabase from the server. Row level security is on with no policies, so the public anon key can read nothing.

To refresh the seed after editing the CSVs in `data/seed`, run `npm run seed:build`.

## Keeping it awake

Vercel does not put production sites to sleep. A free Supabase project does pause after about a week without activity. `vercel.json` runs `/api/cron/daily` every day at 06:00 IST, which refreshes the draft orders and queries the database. `/api/health` also queries the database, so an uptime monitor pointed at it works too.

## Zoho Inventory

When you approve an order, the app creates it in Zoho Inventory as a **draft** purchase order with the same PO number, so it can be reviewed and issued in Zoho. If Zoho is down or something is missing, the approval still stands, History shows "Zoho failed" with the reason, and **Retry Zoho** sends it again. Retrying never creates a duplicate: if Zoho already has that PO number it is marked as sent.

Matching rules (create these in Zoho first):

- A **vendor** with exactly the distributor's name, for example `NutriFlow Distributors`.
- An **item** whose SKU is the SKU ID (`SKU001`), or whose name is exactly the product name. The item's purchase rate is used as the price.

Connect it:

1. Open the Zoho API console for your region (India: api-console.zoho.in) and create a **Self Client**.
2. Generate a code with the scopes `ZohoInventory.purchaseorders.CREATE,ZohoInventory.purchaseorders.READ,ZohoInventory.contacts.READ,ZohoInventory.items.READ`. The code expires after a few minutes.
3. Run `node scripts/connect-zoho.mjs`. It asks for the Client ID, Client Secret, Organization ID and the code, checks them against Zoho Inventory, and saves all five Zoho settings in Vercel. Secrets are typed in the terminal and never printed.
4. Find the Organization ID in Zoho Inventory under Settings, then Organization Profile.
5. Redeploy.
6. Run `supabase/migrations/0002_zoho.sql` once in the Supabase SQL editor.

Orders approved before Zoho was connected get a **Send to Zoho** button in History.

## Environment

| Variable | Purpose |
| --- | --- |
| `APPROVER_PASSWORD` | Password for the approver |
| `SESSION_SECRET` | Signs the login cookie (24+ characters) |
| `CRON_SECRET` | Lets Vercel Cron call `/api/cron/daily` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Database (optional until connected) |
| `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ORG_ID`, `ZOHO_DC` | Zoho Inventory (optional until connected) |
