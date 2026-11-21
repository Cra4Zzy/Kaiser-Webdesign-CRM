# Kaiser CRM 9.9.1 PAGES — Cloudflare + Supabase

Cloudflare Pages Functions ersetzen den alten Python-HTTP-Server im Onlinebetrieb. Das bestehende Design, die Navigation und die App-Zieladresse bleiben erhalten. Die Python-Dateien sind nur für die lokale Datenmigration und Referenz enthalten; sie werden nicht bei Pages ausgeführt.

**Status:** lokal getesteter Deployment-Kandidat. Noch keine Produktivfreigabe: SQL-Funktionen und echte Supabase-Authentifizierung müssen im neuen Projekt überprüft werden. Keine Kundendaten oder Schlüssel im Repository.

## 1. GitHub / Cloudflare Pages

- Repository: `Cra4Zzy/Kaiser-Webdesign-CRM`, Branch `main` (privat empfohlen).
- Root Directory: leer oder `/`; Framework: None; Build Command: leer; Build-Ausgabe: `cloud/web`.
- `functions/` und `pages/` liegen im Repository-Stamm und werden beim Pages-Deployment erkannt. Nur `cloud/web` ist öffentlich auslieferbar. _routes.json beschränkt Functions auf `/api/*`.
- Kein eigener Python-Server, kein Docker und kein zusätzlicher VPS notwendig.
- Projekt-Einstellungen > Runtime: Fail closed (bei erschöpftem Functions-Limit nicht auf statische Auslieferung zurückfallen).
- Bestehende Domain `https://crm.kaiser-webdesign.de` und vorhandenes Windows-Paket/Handy-PWA weiterverwenden.

## 2. Neues, separates Supabase-Projekt

- Frankfurt / EU, nicht die Abbate- oder Avanti-Datenbank verwenden.
- Für ein **leeres** Projekt `SUPABASE-SETUP.sql` einmal im SQL Editor ausführen. Falls 01_SCHEMA.sql bereits ausgeführt wurde, nur `cloud/04_PAGES_API.sql` ausführen. Nicht beide Varianten kombinieren.
- Die internen Tabellen liegen im nicht exponierten Schema `kaiser_crm`. Die beiden RPCs in `public` sind ausschließlich für `service_role` freigegeben. Standardmäßig muss `public` in Data API aktiviert sein. `kaiser_crm` nicht in Exposed schemas aufnehmen.
- Data API aktivieren, öffentliche Registrierungen unter Auth deaktivieren, Site URL auf `https://crm.kaiser-webdesign.de` setzen.
- Kein Zugriff über direkte Browser-DB-Anfragen. API prüft Auth und aktives Teamprofil bei jeder Anfrage. Supabase Secret Key ausschließlich als Cloudflare Secret verwenden.

## 3. Cloudflare Production-Variablen

Pages > Einstellungen > Variablen und Geheimnisse > Produktion:

| Name | Typ | Wert |
|---|---|---|
| `SUPABASE_URL` | Text | Projekt-URL aus Supabase Connect |
| `SUPABASE_PUBLISHABLE_KEY` | Text oder Secret | sb_publishable_... |
| `SUPABASE_SECRET_KEY` | Secret | sb_secret_... (niemals in GitHub oder Chat einfügen) |

Danach erneutes Deployment. Keine Datenbankpasswörter, Docker-Konfiguration oder Supabase-Servicekeys im Frontend nötig.

## 4. Aktuelle Kundendaten migrieren

Vorher bisheriges CRM beenden und aktuelle SQLite-Datei `data/kaiser-crm.db` sichern. Erst migrieren, dann Teamprofile erstellen. Die ZIP enthält absichtlich keine Kundendaten.

**Variante ohne DB-Zugangsdaten:** Auf dem eigenen Rechner, in einer Eingabeaufforderung im entpackten Codeordner (Python 3.12+):

```
python cloud/export_sql.py "C:\Pfad\zum\aktuellen\data\kaiser-crm.db" "%USERPROFILE%\Desktop\CRM-DATEN-NICHT-UPLOADEN.sql"
```

Die erzeugte Datei enthält vertrauliche Kundendaten. Nur im SQL Editor des neuen CRM-Projekts ausführen, **niemals über GitHub oder Cloudflare hochladen**. Die Migration stoppt, wenn Daten bereits vorhanden sind. Die Originaldatei bleibt unverändert. Alternative: vorhandenes `cloud/migrate.py` mit einer privilegierten DB-Verbindung lokal ausführen (siehe alte TEAM-SETUP.md nur für diese Migration).

Wenn keine Daten übernommen werden sollen, kann ein leeres Profil über SQL angelegt werden; dann darf später nicht mehr die alte Migration in dieses befüllte Schema ausgeführt werden.

## 5. Anmeldungen

In Supabase > Authentication > Users den eigenen und den Mitarbeiterzugang anlegen. Danach `cloud/03_TEAMKONTEN.sql` mit den tatsächlichen Auth-UUIDs und passenden Arbeitsprofil-IDs verwenden. Vorhandene CRM-Teamprofile werden nicht automatisch zu Login-Konten. Kein öffentliches Signup. Login-Sitzung maximal eine Stunde; Passwort-Wiederherstellung über Supabase-Verwaltung, keine eigene Self-Service-Maske in diesem Stand.

## 6. Produktivtest

- Admin und Mitarbeiter in zwei getrennten Browserprofilen anmelden.
- Einen Testkontakt protokollieren, Aufgabe planen und erledigen; beide Benutzer sehen den neuen Datenstand spätestens beim nächsten Polling (normalerweise alle 4 Sekunden im sichtbaren Fenster).
- Gleichzeitige Bearbeitung prüfen: eine alte Revision muss 409 erhalten, Eingabe bleibt im Formular erhalten.
- Fremdes / nicht freigegebenes Konto muss 403 erhalten. Ohne Session 401. Staff darf weder Import noch Export ausführen. Auth/DB-Fehler dürfen keine Daten liefern.
- SQL-Funktionen und Berechtigungen im echten Projekt prüfen (auch Security Advisor); anschließend Windows/Handy installieren.
- Excel/CSV-Import: max. 500 Datenzeilen pro Tabellenblatt und 8 MB lokale Datei, API-Nutzlast max. 2 MB; Daten werden lokal gelesen, erst beim bestätigten Import übertragen; einfache Zuordnung und Dublettenprüfung. Keine Makros, kein Formelneuberechnen, keine komplexen Excel-Sonderformate. Bei zu großen Importen aufteilen. CSV und JSON-Backup verfügbar, Wiederherstellung erfolgt administrativ außerhalb der App.

## Lokale Tests

`node --test pages/tests/backend.test.mjs` (Node 22). Acht lokale Tests mit simulierter Datenbank-/Auth-API. Zusätzlich Test des XLSX- und CSV-Lesers mit Chromium. SQL-Integration, Cloudflare-Deployment, tatsächliche Supabase-Berechtigungen und Endgeräte bleiben offen. Keine Produktivfreigabe vor deren Test.

## Projektdateien: direkte, fortsetzbare Uploads

Neue Uploads laufen nicht mehr über die Cloudflare-Funktion. Der authentifizierte Endpunkt POST /api/project-files/sign erstellt ein pfadgebundenes, kurzlebiges Upload-Ticket. Der Browser überträgt Dateien direkt zu Supabase Storage mit TUS in 6-MiB-Blöcken, Fortschritt, Pause und Wiederaufnahme nach erneuter Dateiauswahl im selben Browser/Teamkonto. Der bestehende private Speicher und vorhandene Dateien bleiben unverändert.

**Aktueller Supabase Free-Tarif: maximal 50 MB pro Datei.** Dieses Limit ist im CRM der Standard. Den privaten Bucket kaiser-projects aktiviert ein Administrator einmalig über die Schaltfläche „Speicher aktivieren“.

**Für echte 500 MB:** Supabase Pro aktivieren, unter Storage → Settings die globale Dateigrößengrenze auf mindestens 500 MB erhöhen. In Cloudflare Pages → Settings → Variables and Secrets (Production) die optionale Variable CRM_UPLOAD_LIMIT_MB auf 500 setzen und neu deployen. Der Code begrenzt das Maximum auf 500 MB.

Das Supabase Secret bleibt serverseitig. Der Browser sieht nur ein kurzfristiges Upload-Ticket für die freigegebene Projektdatei. Ein abgebrochener TUS-Upload muss innerhalb seiner Gültigkeitsdauer (höchstens 24 Stunden) fortgesetzt werden; danach neu beginnen. Nach dem Deployment mit einem Testprojekt auf Desktop und Smartphone testen.
