
erkennt env nicht: $env: DATABASE_URL="file:./dev.db"
Am Anfang: npm install prisma@6.16.2, npm install @prisma/client@6.16.2, npx prisma init

npx prisma validate
npx prisma migrate_dev
npx prisma generate
npx prisma db push

npx seed.js