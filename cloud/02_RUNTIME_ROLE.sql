-- Einmalig im Supabase SQL Editor nach 01_SCHEMA.sql ausführen.
-- Setze anschließend ein eigenes starkes Passwort für die LOGIN-Rolle.
BEGIN;
CREATE ROLE kaiser_crm_app LOGIN NOINHERIT;
GRANT USAGE ON SCHEMA kaiser_crm TO kaiser_crm_app;
GRANT SELECT, INSERT, UPDATE ON kaiser_crm.companies, kaiser_crm.contacts, kaiser_crm.deals, kaiser_crm.tasks, kaiser_crm.appointments, kaiser_crm.projects, kaiser_crm.activities, kaiser_crm.crm_members, kaiser_crm.imports TO kaiser_crm_app;
GRANT SELECT ON kaiser_crm.settings, kaiser_crm.agent_runs, kaiser_crm.account_access, kaiser_crm.migration_state TO kaiser_crm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA kaiser_crm TO kaiser_crm_app;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['companies','contacts','deals','tasks','appointments','projects','activities','crm_members','imports'] LOOP
    EXECUTE format('CREATE POLICY app_read ON kaiser_crm.%I FOR SELECT TO kaiser_crm_app USING (true)',t);
    EXECUTE format('CREATE POLICY app_insert ON kaiser_crm.%I FOR INSERT TO kaiser_crm_app WITH CHECK (true)',t);
    EXECUTE format('CREATE POLICY app_update ON kaiser_crm.%I FOR UPDATE TO kaiser_crm_app USING (true) WITH CHECK (true)',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['settings','agent_runs','account_access','migration_state'] LOOP
    EXECUTE format('CREATE POLICY app_read ON kaiser_crm.%I FOR SELECT TO kaiser_crm_app USING (true)',t);
  END LOOP;
END $$;
COMMIT;
-- Passwort separat setzen: ALTER ROLE kaiser_crm_app PASSWORD 'EIGENES_STARKES_PASSWORT';
