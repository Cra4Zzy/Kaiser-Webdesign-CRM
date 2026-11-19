"""Export a checked copy of a local CRM DB to one private SQL migration file.
Never put the resulting SQL file in GitHub or any public folder.
"""
import argparse, base64, json, tempfile
from pathlib import Path
from contextlib import closing
from migrate import source, TABLES

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('sqlite_db',type=Path);ap.add_argument('output',type=Path);a=ap.parse_args()
    if not a.sqlite_db.is_file():ap.error('SQLite-Datei nicht gefunden')
    if a.output.exists():ap.error('Zieldatei existiert bereits. Bitte neuen Dateinamen wählen.')
    # Prevent the typical accidental commit into this repository.
    repo=Path(__file__).resolve().parents[1]
    if a.output.resolve().is_relative_to(repo):ap.error('Ausgabe außerhalb des CRM-Codeordners speichern!')
    with tempfile.TemporaryDirectory() as tmp, closing(source(a.sqlite_db,tmp)) as db:
        counts={t:db.execute('SELECT count(*) FROM '+t).fetchone()[0] for t in TABLES}
        parts=['-- VERTRAULICH: Kundendaten. Ausschließlich im richtigen Supabase-Projekt ausführen.','BEGIN;','SELECT pg_advisory_xact_lock(741923001);','SET LOCAL search_path TO kaiser_crm, pg_catalog;']
        checks=' OR '.join('EXISTS(SELECT 1 FROM '+t+')' for t in [*TABLES,'migration_state','account_access'])
        parts.append("DO $$ BEGIN IF "+checks+" THEN RAISE EXCEPTION 'CRM-Zieldatenbank ist nicht leer. Kein Überschreiben.'; END IF; END $$;")
        for t in TABLES:
            rows=[dict(r) for r in db.execute('SELECT * FROM '+t)]
            if rows:
                cols=list(rows[0]);names=','.join('"'+c.replace('"','""')+'"' for c in cols)
                encoded=base64.b64encode(json.dumps(rows,ensure_ascii=False,allow_nan=False).encode()).decode()
                parts.append(f"INSERT INTO {t} ({names}) SELECT {names} FROM jsonb_populate_recordset(NULL::{t}, convert_from(decode('{encoded}','base64'),'UTF8')::jsonb);")
            if t!='settings':parts.append(f"SELECT setval(pg_get_serial_sequence('kaiser_crm.{t}','id'),COALESCE(MAX(id),1),COUNT(*)>0) FROM {t};")
            parts.append(f"DO $$ BEGIN IF (SELECT count(*) FROM {t}) <> {counts[t]} THEN RAISE EXCEPTION 'Anzahl stimmt nicht: {t}'; END IF; END $$;")
        parts+=['INSERT INTO migration_state(id) VALUES (1);','COMMIT;']
        a.output.write_text('\n'.join(parts)+'\n',encoding='utf-8')
    print('Datenbestand geprüft:',counts,'\nPrivate SQL-Datei erstellt:',a.output)
if __name__=='__main__':main()
