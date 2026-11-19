-- Run after 01_SCHEMA.sql. No 02_RUNTIME_ROLE.sql needed for Pages.
-- Internal tables stay private; only trusted Pages Functions call these RPCs.
BEGIN;
GRANT USAGE ON SCHEMA kaiser_crm TO service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA kaiser_crm TO service_role;
GRANT INSERT, UPDATE ON kaiser_crm.companies,kaiser_crm.contacts,kaiser_crm.deals,kaiser_crm.tasks,kaiser_crm.appointments,kaiser_crm.projects,kaiser_crm.activities,kaiser_crm.crm_members,kaiser_crm.imports TO service_role;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA kaiser_crm TO service_role;
CREATE OR REPLACE FUNCTION kaiser_crm.pages_snapshot() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog,kaiser_crm AS $$
 SELECT jsonb_build_object(
 'companies',coalesce((SELECT jsonb_agg(to_jsonb(c) || jsonb_build_object('do_not_contact', CASE WHEN c.do_not_contact=1 OR EXISTS(SELECT 1 FROM deals d WHERE d.company_id=c.id AND d.do_not_contact=1) THEN 1 ELSE 0 END) ORDER BY c.id) FROM companies c),'[]'::jsonb),
 'contacts',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM contacts t),'[]'::jsonb),
 'deals',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM deals t),'[]'::jsonb),
 'tasks',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM tasks t),'[]'::jsonb),
 'appointments',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM appointments t),'[]'::jsonb),
 'projects',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM projects t),'[]'::jsonb),
 'activities',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM activities t),'[]'::jsonb),
 'crm_members',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM crm_members t),'[]'::jsonb))
$$;
CREATE OR REPLACE FUNCTION kaiser_crm.pages_identity(p_uid uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog,kaiser_crm AS $$
 SELECT jsonb_build_object('member_id',m.id,'role',a.role,'name',m.name) FROM account_access a JOIN crm_members m ON m.id=a.member_id WHERE a.user_id=p_uid AND a.active AND m.active=1
$$;
CREATE OR REPLACE FUNCTION public.kaiser_pages_read(p_uid uuid,p_backup boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog,kaiser_crm AS $$
DECLARE ident jsonb; snap jsonb;
BEGIN
 ident:=kaiser_crm.pages_identity(p_uid); IF ident IS NULL THEN RAISE EXCEPTION 'CRM_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 snap:=kaiser_crm.pages_snapshot();
 IF p_backup THEN
  IF ident->>'role'<>'admin' THEN RAISE EXCEPTION 'CRM_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('version','9.9.1','created_at',now(),'tables',snap||jsonb_build_object('settings',coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM settings t),'[]'::jsonb),'imports',coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM imports t),'[]'::jsonb),'agent_runs',coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM agent_runs t),'[]'::jsonb)));
 END IF;
 RETURN snap||jsonb_build_object('revision',md5(snap::text),'version','9.9.1','session',ident);
END $$;
CREATE OR REPLACE FUNCTION public.kaiser_pages_apply(p_uid uuid,p_revision text,p_patches jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog,kaiser_crm AS $$
DECLARE ident jsonb; snap jsonb; p jsonb; t text; act text; vals jsonb; rid bigint; cols text; expr text; n integer;
BEGIN
 -- Serialize writes from all Pages instances. Match migration lock.
 PERFORM pg_advisory_xact_lock(741923001);
 ident:=kaiser_crm.pages_identity(p_uid); IF ident IS NULL THEN RAISE EXCEPTION 'CRM_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 snap:=kaiser_crm.pages_snapshot(); IF p_revision IS DISTINCT FROM md5(snap::text) THEN RAISE EXCEPTION 'CRM_CONFLICT' USING ERRCODE='40001'; END IF;
 IF jsonb_typeof(p_patches)<>'array' OR jsonb_array_length(p_patches)>3000 THEN RAISE EXCEPTION 'CRM_INVALID_PATCH'; END IF;
 FOR p IN SELECT value FROM jsonb_array_elements(p_patches) LOOP
  t:=p->>'table'; act:=p->>'action'; vals:=p->'values'; rid:=(p->>'id')::bigint;
  IF t IS NULL OR t NOT IN ('companies','contacts','deals','tasks','appointments','projects','activities','crm_members','imports') OR act IS NULL OR act NOT IN ('insert','update') OR rid IS NULL OR rid<=0 OR jsonb_typeof(vals) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'CRM_INVALID_PATCH'; END IF;
  IF t IN ('crm_members','imports') AND ident->>'role'<>'admin' THEN RAISE EXCEPTION 'CRM_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
  IF t='activities' AND act<>'insert' THEN RAISE EXCEPTION 'CRM_INVALID_PATCH'; END IF;
  IF t='activities' THEN vals:=jsonb_set(vals,'{metadata}',to_jsonb(((coalesce((vals->>'metadata')::jsonb,'{}'::jsonb))||jsonb_build_object('actor_id',ident->'member_id','actor_name',ident->'name'))::text)); END IF;
  IF act='insert' THEN vals:=vals||jsonb_build_object('id',rid); ELSE vals:=vals-'id'; END IF;
  -- Only columns that actually belong to the explicitly permitted private table.
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(vals) AS k(name) WHERE NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('kaiser_crm.'||t) AND a.attname=k.name AND a.attnum>0 AND NOT a.attisdropped)) THEN RAISE EXCEPTION 'CRM_INVALID_COLUMN'; END IF;
  SELECT string_agg(format('%I',k),',' ORDER BY k),string_agg(format('r.%I',k),',' ORDER BY k) INTO cols,expr FROM jsonb_object_keys(vals) AS x(k);
  IF cols IS NULL THEN RAISE EXCEPTION 'CRM_EMPTY_PATCH'; END IF;
  IF act='insert' THEN
   EXECUTE format('INSERT INTO kaiser_crm.%I (%s) SELECT %s FROM jsonb_populate_record(NULL::kaiser_crm.%I,$1) r',t,cols,expr,t) USING vals;
   PERFORM setval(pg_get_serial_sequence('kaiser_crm.'||t,'id'),greatest(rid,nextval(pg_get_serial_sequence('kaiser_crm.'||t,'id'))),true);
  ELSE
   EXECUTE format('UPDATE kaiser_crm.%I SET (%s)=(SELECT %s FROM jsonb_populate_record(NULL::kaiser_crm.%I,$1) r) WHERE id=$2',t,cols,expr,t) USING vals,rid;
   GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'CRM_CONFLICT' USING ERRCODE='40001'; END IF;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION kaiser_crm.pages_identity(uuid),kaiser_crm.pages_snapshot() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION kaiser_crm.pages_identity(uuid),kaiser_crm.pages_snapshot() TO service_role;
REVOKE ALL ON FUNCTION public.kaiser_pages_read(uuid,boolean),public.kaiser_pages_apply(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kaiser_pages_read(uuid,boolean),public.kaiser_pages_apply(uuid,text,jsonb) TO service_role;
COMMIT;
