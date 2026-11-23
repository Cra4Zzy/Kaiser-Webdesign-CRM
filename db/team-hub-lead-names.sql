-- Add company and lead names to historical and future chat events; no data changes.
create or replace function public.kaiser_team_hub_read(p_uid uuid, p_before bigint default null)
returns jsonb language plpgsql set search_path to 'pg_catalog','kaiser_crm' as $$
declare ident jsonb; messages jsonb; claims jsonb; more boolean;
begin
 ident:=kaiser_crm.pages_identity(p_uid);
 if ident is null then raise exception 'CRM_ACCESS_DENIED' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb)
 into messages from (
   select m.id,m.member_id,m.sender_name,m.body,m.kind,m.deal_id,m.company_id,m.created_at,
          coalesce(c.name,'') as company_name,coalesce(d.title,'') as deal_title
   from kaiser_crm.team_messages m
   left join kaiser_crm.deals d on d.id=m.deal_id
   left join kaiser_crm.companies c on c.id=coalesce(m.company_id,d.company_id)
   where p_before is null or m.id < p_before
   order by m.id desc limit 60
 ) t;
 select exists(
   select 1 from kaiser_crm.team_messages
   where (p_before is null or id < p_before)
   and id < coalesce((select min((z->>'id')::bigint) from jsonb_array_elements(messages) z),0)
 ) into more;
 select coalesce(jsonb_agg(jsonb_build_object(
   'deal_id',l.deal_id,'company_id',d.company_id,'member_id',l.member_id,
   'name',l.member_name,'purpose',l.purpose,'mine',l.user_id=p_uid,'lease_until',l.lease_until,
   'company_name',c.name,'deal_title',d.title
 ) order by l.updated_at desc),'[]'::jsonb)
 into claims from kaiser_crm.lead_claims l
 join kaiser_crm.deals d on d.id=l.deal_id
 join kaiser_crm.companies c on c.id=d.company_id
 where l.lease_until>now();
 return jsonb_build_object('messages',messages,'claims',claims,
   'has_older',coalesce(more,false),'member_id',(ident->>'member_id')::bigint);
end $$;
revoke all on function public.kaiser_team_hub_read(uuid,bigint) from public, anon, authenticated;
grant execute on function public.kaiser_team_hub_read(uuid,bigint) to service_role;
