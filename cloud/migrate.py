"""One-time migration from a COPY of the latest local SQLite DB. Never overwrites cloud data."""
import argparse, importlib.util, os, sqlite3, tempfile, shutil, sys
from contextlib import closing
from pathlib import Path
from pgstore import connection,TABLES
ROOT=Path(__file__).resolve().parents[1]

def source(path,tmp):
    dst=Path(tmp)/'kaiser-crm.db'
    with closing(sqlite3.connect(f'{path.resolve().as_uri()}?mode=ro',uri=True)) as src, closing(sqlite3.connect(dst)) as out:src.backup(out)
    os.environ['KAISER_CRM_DATA_DIR']=str(tmp)
    sys.path.insert(0,str(ROOT))
    spec=importlib.util.spec_from_file_location('legacy',ROOT/'START-KAISER-CRM.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.init_db()
    c=sqlite3.connect(dst);c.row_factory=sqlite3.Row
    if c.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or c.execute('PRAGMA foreign_key_check').fetchall():raise ValueError('Lokale Datenbank enthält Integritätsfehler.')
    return c

def main():
    ap=argparse.ArgumentParser();ap.add_argument('sqlite_db',type=Path);ap.add_argument('--apply',action='store_true');a=ap.parse_args()
    if not a.sqlite_db.is_file():ap.error('SQLite-Datei nicht gefunden')
    with tempfile.TemporaryDirectory() as tmp, closing(source(a.sqlite_db,tmp)) as local:
        counts={t:local.execute('SELECT count(*) FROM '+t).fetchone()[0] for t in TABLES}
        print('Quelle geprüft:',counts)
        if not a.apply: print('Nur Vorschau. Mit --apply einmalig in leere Cloud-DB übertragen.');return
        with connection() as db:
            db.execute('SELECT pg_advisory_xact_lock(741923001)');db.execute('SET LOCAL search_path TO kaiser_crm, pg_catalog')
            if db.execute('SELECT 1 FROM migration_state WHERE id=1').fetchone() or any(db.execute('SELECT 1 FROM '+t+' LIMIT 1').fetchone() for t in TABLES):raise RuntimeError('Cloud-Datenbank ist nicht leer. Kein Überschreiben erlaubt.')
            for t in TABLES:
                rows=local.execute('SELECT * FROM '+t).fetchall()
                for r in rows:
                    cols=list(r.keys());db.execute('INSERT INTO '+t+' ('+','.join(cols)+') VALUES ('+','.join(['%s']*len(cols))+')',tuple(r))
                if t!='settings':db.execute("SELECT setval(pg_get_serial_sequence(%s,'id'),COALESCE(MAX(id),1),COUNT(*)>0) FROM "+t,('kaiser_crm.'+t,))
                n=db.execute('SELECT count(*) AS n FROM '+t).fetchone()['n']
                if n!=counts[t]:raise RuntimeError('Abweichung bei '+t)
            db.execute('INSERT INTO migration_state(id) VALUES (1)')
        print('Cloud-Migration atomar abgeschlossen. Originaldatei unverändert.')
if __name__=='__main__': main()
