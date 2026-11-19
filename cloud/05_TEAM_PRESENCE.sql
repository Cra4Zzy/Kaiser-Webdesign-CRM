-- einmal im bestehenden Kaiser-CRM-Projekt ausführen. Keine CRM-Daten ändern.
BEGIN;
CREATE TABLE IF NOT EXISTS kaiser_crm.team_presence (
  user_id uuid PRIMARY KEY REFERENCES kaiser_crm.account_access(user_id) ON DELETE CASCADE,
  last_seen timestamptz NOT NULL
);
ALTER TABLE kaiser_crm.team_presence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON kaiser_crm.team_presence FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON kaiser_crm.team_presence TO service_role;
CREATE OR REPLACE FUNCTION public.kaiser_team_presence(p_uid uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, kaiser_crm AS $$
DECLARE ident jsonb; people jsonb;
BEGIN
  ident := kaiser_crm.pages_identity(p_uid);
  IF ident IS NULL THEN
    RAISE EXCEPTION 'CRM_ACCESS_DENIED' USING ERRCODE='42501';
  END IF;
  INSERT INTO kaiser_crm.team_presence(user_id,last_seen)
  VALUES (p_uid, now())
  ON CONFLICT (user_id) DO UPDATE SET last_seen=EXCLUDED.last_seen
  WHERE team_presence.last_seen < now() - interval '20 seconds';
  DELETE FROM kaiser_crm.team_presence
  WHERE last_seen < now() - interval '90 seconds';
  IF ident->>'role' <> 'admin' THEN
    RETURN jsonb_build_object('admin',false);
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'name',m.name,'self',a.user_id=p_uid
  ) ORDER BY (a.user_id=p_uid) DESC,m.name,m.id),'[]'::jsonb)
  INTO people
  FROM kaiser_crm.team_presence p
  JOIN kaiser_crm.account_access a ON a.user_id=p.user_id
  JOIN kaiser_crm.crm_members m ON m.id=a.member_id
  WHERE p.last_seen >= now() - interval '90 seconds'
    AND a.active AND m.active=1;
  RETURN jsonb_build_object('admin',true,'online',people);
END;
$$;
REVOKE ALL ON FUNCTION public.kaiser_team_presence(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kaiser_team_presence(uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
