"""HTTP integration tests with mock Auth and an isolated SQLite business-logic store.
This does not test Supabase or the PostgreSQL adapter against a live server."""
import os, json, tempfile, sqlite3, urllib.request, urllib.error, threading, unittest, importlib.util
from pathlib import Path
from unittest.mock import patch
import server
from pgstore import translate

class TeamTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory();p=Path(cls.tmp.name)/'kaiser-crm.db'
        os.environ['CRM_PUBLIC_URL']='https://crm.test';os.environ['KAISER_CRM_DATA_DIR']=cls.tmp.name
        spec=importlib.util.spec_from_file_location('isolated',server.ROOT/'START-KAISER-CRM.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.init_db()
        def db():
            c=sqlite3.connect(p,timeout=10);c.row_factory=sqlite3.Row;c.execute('PRAGMA foreign_keys=ON');return c
        with db() as c:c.execute("INSERT INTO crm_members(name) VALUES ('Helferin')")
        cls.patchers=[patch.object(server,'Store',db),patch.object(server.m,'db',db),patch.object(server,'auth_login',lambda e,p:(e,3600)),patch.object(server,'access',lambda u: {'member_id':1,'role':'admin','name':'Ivan'} if u=='admin@test.de' else {'member_id':2,'role':'staff','name':'Helferin'} if u=='staff@test.de' else None)]
        for x in cls.patchers:x.start()
        cls.server=server.ThreadingHTTPServer(('127.0.0.1',0),server.TeamHandler);threading.Thread(target=cls.server.serve_forever,daemon=True).start();cls.url='http://127.0.0.1:'+str(cls.server.server_port)
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close()
        for x in cls.patchers:x.stop()
        cls.tmp.cleanup()
    def req(self,path,payload=None,cookie=None,origin='https://crm.test'):
        headers={'Content-Type':'application/json','Origin':origin}
        if cookie:headers['Cookie']=cookie
        rq=urllib.request.Request(self.url+path,headers=headers,data=json.dumps(payload).encode() if payload is not None else None)
        try:r=urllib.request.urlopen(rq)
        except urllib.error.HTTPError as e:r=e
        with r:
            raw=r.read();return r.status,json.loads(raw) if r.headers.get('Content-Type','').startswith('application/json') else raw,r.headers
    def login(self,email):
        status,_,headers=self.req('/api/login',{'email':email,'password':'test'});self.assertEqual(status,200);self.assertIn('HttpOnly',headers['Set-Cookie']);self.assertIn('Secure',headers['Set-Cookie']);return headers['Set-Cookie'].split(';')[0]
    def test_two_accounts_shared_workflow(self):
        admin=self.login('admin@test.de');staff=self.login('staff@test.de')
        _,a,_=self.req('/api/crm',cookie=admin);_,b,_=self.req('/api/crm',cookie=staff)
        self.assertEqual(a['session']['role'],'admin');self.assertEqual(b['session']['member_id'],2)
        status,res,_=self.req('/api/crm',{'op':'company','values':{'name':'Team Test'},'actor_id':1,'revision':b['revision']},staff);self.assertEqual(status,200);cid=res['id']
        _,fresh,_=self.req('/api/crm',cookie=admin);self.assertTrue(any(c['id']==cid for c in fresh['companies']));self.assertEqual(json.loads(fresh['activities'][-1]['metadata'])['actor_id'],2)
        status,_,_=self.req('/api/crm',{'op':'company','values':{'name':'Stale'},'actor_id':1,'revision':a['revision']},admin);self.assertEqual(status,409)
        status,_,_=self.req('/api/crm',{'op':'conversation','values':{'company_id':cid,'kind':'call','result':'Später melden','sales_status':'followup','planning':'plan','title':'Rückruf','task_kind':'call','due_date':'2030-12-05','owner_id':2},'revision':fresh['revision']},admin);self.assertEqual(status,200)
        _,b,_=self.req('/api/crm',cookie=staff);t=next(t for t in b['tasks'] if t['company_id']==cid);self.assertEqual(t['owner_id'],2)
        status,_,_=self.req('/api/crm',{'op':'task_status','id':t['id'],'values':{'status':'done'},'revision':b['revision']},staff);self.assertEqual(status,200)
        _,a,_=self.req('/api/crm',cookie=admin);self.assertEqual(next(v for v in a['tasks'] if v['id']==t['id'])['status'],'done')
    def test_security_guards(self):
        self.assertEqual(self.req('/api/crm')[0],401)
        self.assertEqual(self.req('/data/kaiser-crm.db')[0],404)
        self.assertEqual(self.req('/cloud/server.py')[0],404)
        self.assertEqual(self.req('/api/login',{'email':'admin@test.de','password':'test'},origin='https://evil.test')[0],403)
        self.assertEqual(self.req('/api/login',{'email':'unapproved@test.de','password':'test'})[0],403)
        staff=self.login('staff@test.de');self.assertEqual(self.req('/api/backup',cookie=staff)[0],403)
        self.assertEqual(self.req('/api/crm',{'op':'member','values':{'name':'fake'}},staff)[0],403)
        self.assertEqual(self.req('/api/crm-restore',{},staff)[0],403)
        self.assertEqual(self.req('/api/import/parse',{},staff)[0],403)
        self.assertEqual(self.req('/api/logout',{},staff)[0],200);self.assertEqual(self.req('/api/crm',cookie=staff)[0],401)
    def test_static_cloud(self):
        admin=self.login('admin@test.de');r,page,_=self.req('/',cookie=admin);self.assertEqual(r,200);self.assertIn(b'V9.9 CLOUD',page)
        r,page,_=self.req('/login.html');self.assertEqual(r,200);self.assertIn(b'Ein Datenstand',page)
    def test_pwa_public_assets_and_no_crm_cache(self):
        status,raw,headers=self.req('/manifest.webmanifest');self.assertEqual(status,200)
        manifest=json.loads(raw);self.assertEqual(manifest['display'],'standalone');self.assertEqual(manifest['start_url'],'/')
        for path in ('/sw.js','/install.js','/icon-192.png','/icon-512.png','/Kaiser-CRM-Windows.zip'):
            code,body,headers=self.req(path);self.assertEqual(code,200);self.assertTrue(body)
        self.assertEqual(self.req('/api/crm')[0],401)
        self.assertIn('no-store',self.req('/api/crm')[2]['Cache-Control'])
    def test_sql_translation(self):self.assertEqual(translate("SELECT '?' WHERE id=?"),"SELECT '?' WHERE id=%s")

if __name__=='__main__':unittest.main()
