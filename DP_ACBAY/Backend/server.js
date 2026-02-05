//server

const express = require('express');

const importRoutes = require ("./routes/import.routes");
const statsRoutes = require ("./routes/stats.routes");
const authRoutes = require ("./routes/auth.routes");

const app= express();

app.use(express.json());

app.use("/api/import",importRoutes);
app.use("/api/stats",statsRoutes);
app.use("/api/auth", authRoutes);

const PORT = 3000;

app.listen(PORT, () => {
    console.log(`Server läuft auf http://localhost:${PORT}`);
});