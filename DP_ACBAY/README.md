# EVN CO2 Dashboard - Run Instructions

This repository contains a small Node.js backend and static frontend for the EVN CO2 dashboard.

Prerequisites
- Node.js 16+ installed
- The Excel files used by the importer placed in `Backend/data/`:
  - `emissionen_nach_typ.xlsx`
  - `auswertung_umfrage.xlsx`
- `DATABASE_URL` environment variable configured (for SQLite use `file:./dev.db`)

Quick start (powershell)

1. Install dependencies (in `Backend`):

```powershell
cd Backend
npm install
```

2. (Optional) Import Excel data into the database:

```powershell
# from repository root
node Backend/services/import/import-excel.js
```

3. Start backend API server:

```powershell
# from Backend folder
node Backend/server.js
# or use npm script
npm run dev
```

4. Serve the frontend (static files) locally on port 8080:

```powershell
# from Backend folder
npm run serve:frontend
# then open http://localhost:8080 in your browser
```

Notes
- The backend exposes a public endpoint `/surveys/public` and `/emission-factors`.
- If you prefer to open `Frontend/index.html` directly from the filesystem, Chart fetches to `http://localhost:3000` must be reachable (start the backend API server).

Environment / Prisma
- A local SQLite database is supported via `DATABASE_URL=file:./dev.db`.
- I added a `.env` file in `Backend/.env` containing `DATABASE_URL="file:./dev.db"` so the importer and server can run locally.
- If you change the DB location or use a remote DB, set the `DATABASE_URL` env var accordingly.
- Generate Prisma client (if needed) before running the importer:

```powershell
cd Backend
npx prisma generate
# or use npm script
npm run prisma:generate
```

Verification
- After running the importer and starting the backend, you can run a quick verification that the importer and endpoints respond:

```powershell
# from Backend folder
npm run verify
```

This runs the importer script (if present) and queries these endpoints:
- `/surveys/public`
- `/emission-factors`
- `/public/aggregations`

If any endpoint fails, start the backend API with `npm run dev` and run the verify command again.

If you want, I can also:
- Add a pre-aggregated public endpoint for charts.
- Wire an automated test that runs the importer and verifies endpoints.
