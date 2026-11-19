# Kaiser CRM 9.9 CLOUD — IONOS

Bestehende Python-CRM-Logik + Supabase Auth/PostgreSQL. Dieser Stand ist ein Deployment-Kandidat für einen IONOS Linux VPS mit Docker Compose, nicht für reinen Webspace/Domain-Tarif. Keine Produktivfreigabe ohne echten Supabase-Test. Die Domain kann auch auf einen anderen kompatiblen Server zeigen.

## GitHub
Inhalt dieses Ordners in ein privates Repository laden. Keine echten Zugangsdaten, DB-Dateien, Zertifikate oder Exporte einchecken. `.gitignore` ist enthalten.

## Einrichtung
1. Neues, separates Supabase-Projekt; SQL und Migration gemäß TEAM-SETUP.md. Mitarbeiter ausschließlich freigegebenen Auth-Benutzern zuordnen. Öffentliche Registrierung deaktivieren.
2. IONOS VPS mit Docker/Compose bereitstellen (nur falls bereits verfügbar bzw. nach Tarifentscheidung). DNS `crm` als A-Record auf die VPS-IP, ggf. AAAA nur bei funktionierendem IPv6. Ports 80/443 öffnen, 8080 nicht veröffentlichen. Andere Webserver auf denselben Ports müssen separat integriert werden.
3. Repo auf Server klonen. `cp cloud/config.example.env .env`, dort echte Werte lokal ergänzen, `CRM_PUBLIC_URL=https://crm.kaiser-webdesign.de`. `secrets/supabase-ca.crt` aus dem Supabase-Dashboard ablegen (Datei für Container lesbar; keine Schlüssel in Git). Die Migration benötigt separat eine entsprechend privilegierte Verbindung, Runtime nur kaiser_crm_app.
4. `docker compose up -d --build`; `docker compose logs -f crm` zur Kontrolle. Caddy bezieht ein TLS-Zertifikat, wenn DNS und Ports stimmen. `curl https://crm.kaiser-webdesign.de/healthz` prüft den HTTP-Prozess, nicht DB-Gesundheit.
5. Login mit Admin und Mitarbeiter testen, Änderungen parallel ausführen, Archiv, Import, Export und tatsächliche PostgreSQL-Verbindung prüfen. Passwort-Wiederherstellung ist in dieser Version noch nicht implementiert; Admin kann Passwörter über Supabase verwalten.

## Installation
Handy: URL in Safari/Chrome öffnen, Menü Teilen / Zum Home-Bildschirm bzw. App installieren. Manifest und Service Worker enthalten; nur Onlinebetrieb. Keine Speicherung von Kundendaten durch den Service Worker. Windows: Download auf Loginseite, ZIP entpacken, CMD starten; erzeugt Desktop/Startmenü-Verknüpfung für Edge-App-Modus. Alternativ Edge-PWA direkt installieren. Kein natives MSI, kein unsigniertes EXE.

## Grenzen
Der Webserver benötigt einen dauerhaft laufenden Python-Prozess; normaler IONOS Webspace ist nicht als kompatibel bestätigt. Für reines Static Hosting müsste das Backend separat auf Supabase RPC/Edge Functions portiert werden. Keine DNS- oder Cloud-Änderungen durchgeführt. Sync: Polling alle vier Sekunden in sichtbaren Fenstern, kein Push-Realtime.
