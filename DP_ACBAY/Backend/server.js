const express = require("express");
const cors = require("cors");
const path = require("path");

// Import controllers
const {
  getPublicSurveys,
  getEmissionFactors,
  getPublicAggregations,
} = require("./controllers/stats.controller");

// Import services
const { ensureInitialAdmin } = require("./services/auth.services");

// Import routes
const authRoutes = require("./routes/auth.routes");
const statsRoutes = require("./routes/stats.routes");
const importRoutes = require("./routes/import.routes");
const partialsRoutes = require("./routes/partials.routes");

const app = express();
const PORT = process.env.PORT || 3000;

// Error handling for unhandled rejections
process.on("unhandledRejection", (err) => {
  console.error("UnhandledRejection:", err);
});
process.on("uncaughtException", (err) => {
  console.error("UncaughtException:", err);
});

// CORS Configuration
const allowOrigin = (origin, callback) => {
  if (!origin || origin === "null") return callback(null, true);
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return callback(null, true);
  }
  return callback(new Error("Not allowed by CORS"));
};

app.use(
  cors({
    origin: allowOrigin,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "HX-Request",
      "HX-Current-URL",
      "HX-Target",
      "HX-Trigger",
      "HX-Trigger-Name",
      "HX-Prompt",
    ],
    exposedHeaders: ["HX-Trigger"],
  })
);

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static(path.join(__dirname, "..", "Frontend")));

// Public endpoints (NOT under /surveys)
app.get("/public/aggregations", getPublicAggregations);
app.get("/public/surveys", getPublicSurveys);
app.get("/emission-factors", getEmissionFactors);

// Authenticated routes
app.use("/auth", authRoutes);
app.use("/surveys", statsRoutes);
app.use("/import", importRoutes);
app.use("/partials", partialsRoutes);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Startup
async function startup() {
  try {
    // Ensure initial admin user is created
    console.log("🟡 Ensuring initial admin user...");
    await ensureInitialAdmin();
    console.log("✅ Initial admin user ensured");

    // Start server
    app.listen(PORT, () => {
      console.log(`\n✅ API running on http://localhost:${PORT}`);
      console.log("\n📍 Available Routes:");
      console.log("  Auth:");
      console.log("    POST /auth/register-hx - Register user (HTMX)");
      console.log("    POST /auth/login-hx - Login user (HTMX)");
      console.log("\n");
    });
  } catch (err) {
    console.error("❌ Startup failed:", err);
    process.exit(1);
  }
}

startup();

module.exports = app;
