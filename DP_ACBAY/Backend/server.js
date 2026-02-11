const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");

const app = express();
const prisma = new PrismaClient();

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

const allowOrigin = (origin, callback) => {
  // Allow server-side tools and direct file:// usage (origin can be undefined/null).
  if (!origin || origin === "null") return callback(null, true);
  // Allow any localhost/127.0.0.1 port for local development.
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return callback(null, true);
  }
  return callback(new Error("Not allowed by CORS"));
};

app.use(
  cors({
    origin: allowOrigin,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "HX-Request",
      "HX-Current-URL",
      "HX-Target",
      "HX-Trigger",
      "HX-Trigger-Name",
    ],
    exposedHeaders: ["HX-Trigger"],
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: "7d",
  });
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not authenticated" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatNumber(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }
  return Number(value).toFixed(digits);
}

function summarize(surveys) {
  if (!surveys.length) {
    return { count: 0, avgCo2: "-", updated: "-" };
  }
  const sum = surveys.reduce((acc, row) => acc + Number(row.totalCo2Kg || 0), 0);
  const avg = (sum / surveys.length).toFixed(1);
  return {
    count: surveys.length,
    avgCo2: `${avg} kg`,
    updated: new Date(surveys[0].createdAt).toLocaleString("de-AT"),
  };
}

function surveysRowsHtml(surveys, privateMode) {
  if (!surveys.length) {
    return `<tr><td colspan="7" class="px-4 py-6 text-center text-slate-500">Keine Daten vorhanden.</td></tr>`;
  }
  return surveys
    .map((row) => {
      const person = privateMode
        ? escapeHtml(row.user?.name || row.user?.email || "-")
        : "Anonym";
      return `
        <tr class="border-b border-slate-200">
          <td class="px-3 py-2">${row.id}</td>
          <td class="px-3 py-2">${person}</td>
          <td class="px-3 py-2">${escapeHtml(row.officeDaysPerWeek ?? "-")}</td>
          <td class="px-3 py-2">${escapeHtml(row.distanceKm ?? "-")}</td>
          <td class="px-3 py-2">${escapeHtml(String(row.transportMain || "-").replaceAll("_", " "))}</td>
          <td class="px-3 py-2">${escapeHtml(row.flightsPerYear ?? "-")}</td>
          <td class="px-3 py-2 font-semibold">${formatNumber(row.totalCo2Kg, 1)}</td>
        </tr>
      `;
    })
    .join("");
}

function summaryHtml(surveys) {
  const summary = summarize(surveys);
  return `
    <div class="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div class="text-xs uppercase tracking-wide text-slate-500">Datensaetze</div>
      <div class="mt-1 text-2xl font-bold text-slate-900">${summary.count}</div>
    </div>
    <div class="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div class="text-xs uppercase tracking-wide text-slate-500">Durchschnitt CO2</div>
      <div class="mt-1 text-2xl font-bold text-slate-900">${summary.avgCo2}</div>
    </div>
    <div class="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div class="text-xs uppercase tracking-wide text-slate-500">Letzte Aktualisierung</div>
      <div class="mt-1 text-base font-semibold text-slate-900">${escapeHtml(summary.updated)}</div>
    </div>
  `;
}

app.post("/auth/register", async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "email and password required" });
    }
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ error: "email already exists" });
    }
    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, password: hash, name: name || null },
    });
    return res.json({ token: signToken(user) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "register failed" });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "email and password required" });
    }
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: "invalid credentials" });
    }
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({ error: "invalid credentials" });
    }
    return res.json({ token: signToken(user) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "login failed" });
  }
});

app.get("/me", auth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.sub },
    select: { id: true, email: true, name: true, createdAt: true },
  });
  return res.json(user);
});

app.post("/auth/login-hx", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res
        .status(400)
        .send(`<div class="text-sm text-red-700">Email und Passwort sind erforderlich.</div>`);
    }
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).send(`<div class="text-sm text-red-700">Login fehlgeschlagen.</div>`);
    }
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).send(`<div class="text-sm text-red-700">Login fehlgeschlagen.</div>`);
    }
    const token = signToken(user);
    res.setHeader("HX-Trigger", JSON.stringify({ authChanged: { token } }));
    return res.send(`<div class="text-sm text-emerald-700">Login erfolgreich.</div>`);
  } catch (err) {
    console.error(err);
    return res.status(500).send(`<div class="text-sm text-red-700">Login fehlgeschlagen.</div>`);
  }
});

app.post("/auth/register-hx", async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) {
      return res
        .status(400)
        .send(`<div class="text-sm text-red-700">Email und Passwort sind erforderlich.</div>`);
    }
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).send(`<div class="text-sm text-red-700">Email existiert bereits.</div>`);
    }
    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, password: hash, name: name || null },
    });
    const token = signToken(user);
    res.setHeader("HX-Trigger", JSON.stringify({ authChanged: { token } }));
    return res.send(`<div class="text-sm text-emerald-700">Registrierung erfolgreich.</div>`);
  } catch (err) {
    console.error(err);
    return res.status(500).send(`<div class="text-sm text-red-700">Registrierung fehlgeschlagen.</div>`);
  }
});

app.get("/surveys/public", async (req, res) => {
  const surveys = await prisma.survey.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      officeDaysPerWeek: true,
      transportMain: true,
      distanceKm: true,
      flightsPerYear: true,
      totalCo2Kg: true,
    },
  });
  return res.json(surveys);
});

app.get("/partials/surveys/public", async (req, res) => {
  const surveys = await prisma.survey.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      officeDaysPerWeek: true,
      transportMain: true,
      distanceKm: true,
      flightsPerYear: true,
      totalCo2Kg: true,
    },
  });
  return res.send(surveysRowsHtml(surveys, false));
});

app.get("/partials/summary/public", async (req, res) => {
  const surveys = await prisma.survey.findMany({
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, totalCo2Kg: true },
  });
  return res.send(summaryHtml(surveys));
});

app.get("/surveys", auth, async (req, res) => {
  const surveys = await prisma.survey.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      officeDaysPerWeek: true,
      transportMain: true,
      distanceKm: true,
      flightsPerYear: true,
      totalCo2Kg: true,
      user: { select: { email: true, name: true } },
    },
  });
  return res.json(surveys);
});

app.get("/partials/surveys/private", auth, async (req, res) => {
  const surveys = await prisma.survey.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      officeDaysPerWeek: true,
      transportMain: true,
      distanceKm: true,
      flightsPerYear: true,
      totalCo2Kg: true,
      user: { select: { email: true, name: true } },
    },
  });
  return res.send(surveysRowsHtml(surveys, true));
});

app.get("/partials/summary/private", auth, async (req, res) => {
  const surveys = await prisma.survey.findMany({
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, totalCo2Kg: true },
  });
  return res.send(summaryHtml(surveys));
});

app.listen(3000, () => {
  console.log("API running on http://localhost:3000");
});
