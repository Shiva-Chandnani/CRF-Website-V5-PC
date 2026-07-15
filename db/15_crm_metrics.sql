-- Phase 5 — staff CRM lightweight metrics. Staff-only aggregate tiles + 12-month series.
begin;
create or replace function public.crm_metrics()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result json;
begin
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select json_build_object(
    'total_customers', (select count(*) from public.profiles where role = 'customer'),
    'new_this_month',  (select count(*) from public.profiles
                          where role = 'customer' and created_at >= date_trunc('month', now())),
    'paid_orders',     (select count(*) from public.orders where status = 'paid'),
    'revenue_thb',     (select coalesce(sum(total_thb), 0) from public.orders where status = 'paid'),
    'aov_thb',         (select case when count(*) = 0 then 0
                          else round(coalesce(sum(total_thb),0)::numeric / count(*)) end
                          from public.orders where status = 'paid'),
    'by_month', (
      select coalesce(json_agg(row_to_json(m) order by m.month), '[]'::json)
      from (
        select to_char(d.month, 'YYYY-MM') as month,
          (select count(*) from public.profiles p
             where p.role = 'customer' and date_trunc('month', p.created_at) = d.month) as new_customers,
          (select coalesce(sum(o.total_thb),0) from public.orders o
             where o.status = 'paid' and date_trunc('month', o.created_at) = d.month) as revenue_thb
        from generate_series(date_trunc('month', now()) - interval '11 months',
                             date_trunc('month', now()), interval '1 month') as d(month)
      ) m
    )
  ) into result;
  return result;
end;
$$;
revoke all on function public.crm_metrics() from public;
grant execute on function public.crm_metrics() to authenticated;
commit;
