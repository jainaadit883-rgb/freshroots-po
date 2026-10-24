-- Adds a "failed" Zoho state and a place to keep the error message, so a failed push can be retried.
alter table purchase_orders add column if not exists zoho_error text;

alter table purchase_orders drop constraint if exists purchase_orders_zoho_status_check;
alter table purchase_orders
  add constraint purchase_orders_zoho_status_check
  check (zoho_status in ('not_connected', 'queued', 'sent', 'failed'));
