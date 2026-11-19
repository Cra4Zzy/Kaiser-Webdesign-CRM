"""Small PostgreSQL adapter for existing V9 commands; no database secrets in browser."""
import os,re
TABLES=('crm_members','companies','contacts','deals','tasks','appointments','projects','activities','imports','settings','agent_runs')

def connection():
    import psycopg
    from psycopg.rows import dict_row
    # URL remains server-side. Require encrypted transport; verify CA when configured.
    return psycopg.connect(os.environ['DATABASE_URL'], sslmode=os.getenv('PGSSLMODE','verify-full'), connect_timeout=10, row_factory=dict_row, prepare_threshold=None)

class Result:
    def __init__(self,cur=None, id=None, rows=None):
        self.cur=cur; self.lastrowid=id; self.rows=rows
    def fetchone(self): return (self.rows[0] if self.rows else None) if self.rows is not None else self.cur.fetchone()
    def fetchall(self): return self.rows if self.rows is not None else self.cur.fetchall()
    def __iter__(self): return iter(self.rows if self.rows is not None else self.cur)

def translate(sql):
    # Existing queries use '?' placeholders; do not change quoted text.
    parts=re.split(r"('(?:''|[^'])*')",sql)
    return ''.join(p if i%2 else p.replace('?', '%s') for i,p in enumerate(parts))

class Store:
    def __enter__(self):
        self.con=connection()
        try:
            self.con.execute('SET LOCAL search_path TO kaiser_crm, pg_catalog')
            self.con.execute('SET LOCAL lock_timeout = \'10s\'')
            self.con.execute('SET LOCAL statement_timeout = \'30s\'')
            # All application reads and writes share the same transaction-scoped lock.
            # Ensures coherent snapshots and optimistic revision checks across instances.
            self.con.execute('SELECT pg_advisory_xact_lock(741923001)')
            return self
        except Exception: self.con.close();raise
    def __exit__(self,typ,val,tb):
        try:
            if typ: self.con.rollback()
            else: self.con.commit()
        finally: self.con.close()
    def commit(self): self.con.commit()
    def rollback(self): self.con.rollback()
    @property
    def in_transaction(self): return True
    def execute(self,sql,params=()):
        if sql.strip().upper() in ('BEGIN','BEGIN IMMEDIATE'): return Result(rows=[])
        m=re.fullmatch(r'PRAGMA table_info\((\w+)\)',sql,re.I)
        if m:
            return Result(self.con.execute('SELECT column_name AS name FROM information_schema.columns WHERE table_schema=%s AND table_name=%s',('kaiser_crm',m[1])))
        sql=translate(sql)
        m=re.match(r'\s*INSERT\s+INTO\s+(\w+)\s*\(',sql,re.I)
        if m and m[1] in TABLES and m[1]!='settings' and 'RETURNING' not in sql.upper():
            cur=self.con.execute(sql.rstrip(';')+' RETURNING id',params);return Result(id=cur.fetchone()['id'])
        return Result(self.con.execute(sql,params))
