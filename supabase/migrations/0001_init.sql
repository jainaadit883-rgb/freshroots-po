-- Reference data
create table if not exists distributors (
  id text primary key,
  name text not null,
  region text,
  status text not null default 'Active'
);

create table if not exists skus (
  id text primary key,
  name text not null,
  category text,
  perishability text not null check (perishability in ('High', 'Low')),
  standard_reorder_qty int not null check (standard_reorder_qty > 0),
  uom text not null default 'Units',
  distributor_id text references distributors (id)
);

create table if not exists weekly_sales (
  sku_id text not null references skus (id),
  week text not null,
  units_sold int not null check (units_sold >= 0),
  primary key (sku_id, week)
);
create index if not exists weekly_sales_week_idx on weekly_sales (week desc);

create table if not exists inventory (
  sku_id text primary key references skus (id),
  location text,
  units_on_hand int not null check (units_on_hand >= 0),
  as_of_date date not null
);

create table if not exists calendar (
  year_month text primary key,
  is_festival_month boolean not null
);

-- Purchase orders
create table if not exists purchase_orders (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  distributor_id text not null references distributors (id),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'received')),
  reject_reason text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  received_at timestamptz,
  zoho_status text not null default 'not_connected'
    check (zoho_status in ('not_connected', 'queued', 'sent')),
  zoho_ref text
);
create index if not exists purchase_orders_status_idx on purchase_orders (status);
-- At most one open draft per distributor, even if two plan runs overlap.
create unique index if not exists one_pending_po_per_distributor
  on purchase_orders (distributor_id) where status = 'pending';

create table if not exists po_lines (
  po_id uuid not null references purchase_orders (id) on delete cascade,
  sku_id text not null references skus (id),
  recommended_qty int not null check (recommended_qty >= 0),
  qty int not null check (qty >= 0),
  action text not null check (action in ('REORDER_NOW', 'REORDER_SOON')),
  snapshot jsonb not null,
  primary key (po_id, sku_id)
);

create table if not exists meta (
  key text primary key,
  value text not null
);

-- Receiving a PO adds its quantities to stock in one transaction.
create or replace function receive_po(p_id uuid) returns boolean
language plpgsql as $$
begin
  update purchase_orders
     set status = 'received', received_at = now()
   where id = p_id and status = 'approved';
  if not found then
    return false;
  end if;
  update inventory i
     set units_on_hand = i.units_on_hand + l.qty, as_of_date = current_date
    from po_lines l
   where l.po_id = p_id and i.sku_id = l.sku_id;
  return true;
end;
$$;

-- The app talks to Supabase from the server with the service role key.
-- RLS stays on with no policies, so the public anon key can read nothing.
alter table distributors enable row level security;
alter table skus enable row level security;
alter table weekly_sales enable row level security;
alter table inventory enable row level security;
alter table calendar enable row level security;
alter table purchase_orders enable row level security;
alter table po_lines enable row level security;
alter table meta enable row level security;
