
# Optional: erlauben, dass lokale Skripte laufen
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force

# 1) Ins Backend-Verzeichnis wechseln und Abhängigkeiten installieren
cd Backend
npm install

# 2) Prisma-Client generieren (falls noch nicht)
npx prisma generate
# oder
npm run prisma:generate

# 3) Datenbank-Schema anlegen (Migration)
npx prisma migrate dev --name init
# Alternative (kein Migrations-Flow):
npx prisma db push

# 4) Excel-Import ausführen
npm run import:excel
# oder explizit:
node services/import/import-excel.js

# 5) Backend starten (API läuft auf http://localhost:3000)
npm run dev
# oder
node server.js

# 6) Frontend lokal serven (http://localhost:8080)
npm run serve:frontend

# 7) Optional: Endpunkte prüfen/verifizieren
npm run verify

# 8) Optional: Sicherheits-Checks reparieren
npm audit fix