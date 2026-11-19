# Kaiser CRM V9.9 CLOUD – Supabase-Vorbereitung

## Was du bekommst
Die V9.7-Oberfläche und Kernlogik, ergänzt um einen gemeinsamen Team-Server, Supabase Auth, PostgreSQL-Tabellen und eine automatische Aktualisierung (alle 4 Sekunden, sofern kein Formular bearbeitet wird). Zwei Rollen: `admin` und `staff`. Beide sehen denselben Firmen-, Aufgaben-, Kontakt-, Vertriebs- und Projektbestand. Nur Administratoren können den vollständigen Datenexport und Excel-Import ausführen; Konten werden momentan in Supabase verwaltet. Kein Selbstregistrierungsformular. Mitarbeiterinnen brauchen keinen Supabase-Dashboard-Zugang.

Die lokale V9.7 bleibt bis zur erfolgreichen Umstellung dein produktives System. Diese ZIP enthält absichtlich KEINE Kundendatenbank, keine Zugangsdaten und keinen alten Windows-Starter. Die Cloud-Oberfläche befindet sich in `cloud/web/`; der Server ist `cloud/server.py`. Die Anwendung benötigt zusätzlich zu Supabase einen dauerhaft erreichbaren Python-/Docker-Host mit HTTPS. Sie ist nicht als reine statische GitHub-Pages-Webseite lauffähig. Anschließend kannst du sie als Browser-App oder Desktop-Verknüpfung öffnen. Eine Windows-EXE ist nicht Bestandteil dieses Pakets.

## 1 – Neues Supabase-Projekt anlegen
- Separates Projekt für Kaiser CRM (nicht die Abate-App-Datenbank verwenden). Möglichst EU-Region wählen.
- In Authentication die E-Mail-/Passwort-Anmeldung aktivieren, offene Registrierung deaktivieren. Unter Users deine eigene Benutzerin/deinen eigenen Benutzer und später deine Mitarbeiterin anlegen (bereits bestätigt, mit starken individuellen Passwörtern). Auth-UUIDs notieren. Passwörter nicht per Chat weitergeben.
- SQL Editor öffnen und `cloud/01_SCHEMA.sql` einmalig vollständig ausführen. Die CRM-Tabellen liegen im privaten Schema `kaiser_crm`; dieses nicht in den Data API exposed schemas eintragen. RLS ist zusätzlich aktiviert. Das Skript bricht bei bereits vorhandenem Schema ab; nicht erneut ausführen.
- `cloud/02_RUNTIME_ROLE.sql` einmalig ausführen; der dedizierten Datenbankrolle `kaiser_crm_app` ein starkes eigenes Passwort setzen. Die Rolle ist nur für den Team-Backend-Server, nicht für die Mitarbeiterin.

## 2 – Bestehende Daten übernehmen
**Wichtig:** Die aktuell auf deinem Rechner verwendete `kaiser-crm.db` verwenden, NICHT automatisch die alte Datei aus einer früheren Download-ZIP. Vor Migration das lokale CRM schließen und sichern; nach erfolgreicher Migration nicht parallel lokal weiterarbeiten.

Python 3.12+ installieren. Terminal im entpackten Team-Paket öffnen:

```powershell
py -m pip install -r requirements-cloud.txt
py cloud/migrate.py "C:\Pfad\zur\aktuellen\data\kaiser-crm.db"
```

Die erste Ausführung ist eine Vorschau: Sie erstellt eine temporäre Kopie, aktualisiert alte Schemafelder und prüft Fremdschlüssel, Datenbankintegrität und Anzahl der Datensätze. Das Original wird nicht bearbeitet. Für die eigentliche Migration den Supabase-Admin-Connection-String aus Dashboard > Connect (Session pooler, falls nur IPv4 verfügbar), das CA-Zertifikat und das Passwort lokal als Umgebungsvariablen setzen. URL-Sonderzeichen im Passwort percent-encodieren. Nicht in die Dateien schreiben oder in ein Repository committen.

```powershell
$env:DATABASE_URL = 'POSTGRES-ADMIN-CONNECTION-STRING'
$env:PGSSLMODE = 'verify-full'
$env:PGSSLROOTCERT = 'C:\Pfad\zum\passenden\CA-Zertifikat.crt'
py cloud/migrate.py "C:\Pfad\zur\aktuellen\data\kaiser-crm.db" --apply
Remove-Item Env:DATABASE_URL
```

Die Migration ist transaktional, prüft die Anzahl pro Tabelle und bricht ab, wenn die Zieldatenbank nicht leer ist. Nach erfolgreicher Migration IDs und Datensätze im SQL Editor prüfen. Es wird kein automatischer Merge zweier bereits produktiver Datenbestände angeboten.

## 3 – Persönliche Teamkonten zuordnen
`cloud/03_TEAMKONTEN.sql` enthält die Vorlagen. Erst die bestehenden Teamprofile anzeigen lassen. Deine Auth-UUID dem richtigen bestehenden CRM-Profil zuordnen (`admin`); die Mitarbeiterin als neues Profil oder einem passenden vorhandenen Profil zuordnen (`staff`). Die UUIDs stammen aus Supabase Authentication > Users. SQL-Kommentare in der Vorlage bewusst freigeben und Platzhalter ersetzen. Die Zugangssperre kann über `active=false` im privaten Schema `account_access` erfolgen; sie wird bei jedem neuen API-Aufruf geprüft. Offene Browseransichten können bis zum nächsten Aufruf noch bereits geladene Daten anzeigen.

## 4 – Team-Server bereitstellen
Einen Python-/Docker-Host mit HTTPS und durchgehender Verfügbarkeit auswählen, z. B. ein privates Container-Hosting in der EU oder einen eigenen VPS hinter einem HTTPS-Reverse-Proxy. Für erste Einrichtung **eine** Serverinstanz betreiben, da Login-Sitzungen und Importvorschauen noch im Arbeitsspeicher dieser Instanz liegen. Keine direkte Veröffentlichung des internen HTTP-Ports.

Die `Dockerfile` ist vorbereitet. Im Hosting-Backend die Variablen aus `cloud/config.example.env` als Secrets/Umgebungsvariablen konfigurieren:
- `SUPABASE_URL`: Projekt-URL
- `SUPABASE_PUBLISHABLE_KEY`: Publishable Key (kein Secret-/Service-Role-Key)
- `DATABASE_URL`: Session-Pooler-Verbindung des dedizierten DB-Benutzers `kaiser_crm_app.PROJECT_REF` oder direkte Verbindung als `kaiser_crm_app`, je nach Host. Host, Port und Projekt-Ref aus dem Connect-Dialog übernehmen; Passwort der eigenen Rolle verwenden.
- `CRM_PUBLIC_URL`: öffentlich erreichbare Adresse mit HTTPS, genau wie im Browser (z. B. `https://crm.example.de`).
- `PGSSLMODE=verify-full`, `PGSSLROOTCERT`: CA-Zertifikat des gewählten DB-Endpunkts als Datei auf dem Host verfügbar machen. Nicht auf eine unverschlüsselte Verbindung zurückfallen.
- `TZ=Europe/Berlin`, `PORT=8080` (oder vom Hosting zugewiesener Port).

Healthcheck `/healthz`; keine Kundendaten im Healthcheck. Das Produktiv-Startkommando ist `python cloud/server.py`. Der Container verwendet nur die zentralen Daten, keine lokale Kopie. Browser-Cookies sind HttpOnly, Secure und SameSite=Strict. Sitzungen enden spätestens nach einer Stunde, bei Serverneustart muss man sich neu anmelden. Keine Secret Keys im Browser. Die Authentifizierung erfolgt serverseitig; der bei Schreibanfragen übermittelte `actor_id` wird immer durch das Benutzerkonto ersetzt. Registrierte Auth-Konten ohne CRM-Freigabe erhalten keine Daten.

## 5 – Vor Livebetrieb prüfen (Pflicht)
1. Admin- und Mitarbeiter-Login in zwei getrennten Browserprofilen aufrufen.
2. Ohne Login muss `/api/crm` 401 zurückgeben; nicht freigegebene Konten dürfen nicht anmelden.
3. Admin legt eine Testfirma an. Mitarbeiterin sieht sie ohne manuelles Neuladen in wenigen Sekunden.
4. Mitarbeiterin dokumentiert Gespräch, setzt Nachfassen, plant Aufgabe. Admin sieht Änderungen und korrekten Namen im Verlauf.
5. Aufgabe abschließen, Archiv kontrollieren. Zwei Browser bearbeiten gleichzeitig: der zweite Schreibvorgang mit veralteter Revision muss auf Abgleich hinweisen.
6. Mitarbeiterin darf keinen Backup-/CSV-Export, Import und keine Kontenverwaltung über die API ausführen. Mitarbeiterzugang testweise sperren und nachprüfen.
7. Supabase-Datenbanksicherung/Restore-Verfahren, Auftragsverarbeitung, Rollenvergabe, Datenschutz und Hosting prüfen. Die bestehende Oberfläche zeigt persönliche Geschäfts-/Kontaktdaten allen zugelassenen Teammitgliedern; kein Mandanten- oder Firmenfilter nach individuellen Berechtigungen.
8. Nach erfolgreicher Prüfung lokale V9.7 archivieren. Ab dann nur noch die Team-Version für Änderungen nutzen.

## Synchronisation und Grenzen
- Automatische Abfrage etwa alle 4 Sekunden im sichtbaren Tab, kein Supabase-WebSocket-Abonnement. Offene Formulare werden nicht überschrieben. Ein globaler Revisionsabgleich verhindert, dass ein älterer Stand ungeprüft gespeichert wird; bei Konflikt müssen Änderungen geprüft werden.
- Der bestehende Workflow bleibt serverseitig in Python. Die PostgreSQL-Anbindung adaptiert dessen SQL-Befehle. Alle Team-Zugriffe gehen durch den zentralen Server; RLS beschränkt den separaten DB-Zugriff zusätzlich auf die Backend-Rolle. Alle zugelassenen Mitarbeiter sehen die gemeinsamen CRM-Daten einschließlich Auftragswerten. Falls das nicht gewünscht ist, Rechte vor Livebetrieb erweitern.
- Kein Offline-Schreibbetrieb, keine automatische Daten-Wiederherstellung in der Team-Oberfläche. Backups sind admin-only; Wiederherstellung extern durch die Administration. Ein Backup enthält fachliche Daten, aber keine Auth-Benutzer und keine Passwörter. Die Auth-Kontenzuordnung separat sichern.
- Kein Passwort-zurücksetzen-Frontend, keine Einladungen aus dem CRM. Supabase-Administration für Anlage, Passwortänderung und Freigabe verwenden. Keine dauerhaften Windows-Installationsprogramme in dieser Vorbereitung.
- 31 vorhandene V9.7-Tests liefen erfolgreich, außerdem vier Team-HTTP-Tests mit simuliertem Auth und isolierter SQLite-Testdatenbank (gemeinsamer Arbeitsablauf, Rechte, statisches Team-Frontend und SQL-Platzhalter). Migrationsvorschau der mitgelieferten V9.7-Datei: 125 Firmen, 57 Kontakte, 125 Vertriebsdatensätze, 195 Verlaufseinträge, 3 Projekte, 18 Importe, 12 Einstellungen und 1 Teamprofil nach Schema-Upgrade. Aktueller Rechnerbestand kann abweichen.
- Kein echtes Supabase-Projekt, PostgreSQL-Treiber und keine Live-Hosting-Umgebung standen für die Ausführung zur Verfügung. Docker-Build, PostgreSQL-Adapter, Supabase-Login, SQL-Richtlinien und Browser-Echtbetrieb am tatsächlichen Projekt sind noch vor Livebetrieb zu prüfen. Keine produktive Freigabe bis dahin.

Offizielle Referenzen: https://supabase.com/docs/guides/database/connecting-to-postgres und https://supabase.com/docs/guides/database/postgres/roles
