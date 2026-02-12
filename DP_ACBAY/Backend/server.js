const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const xlsx = require("xlsx");
const PDFDocument = require("pdfkit");
const { PrismaClient } = require("@prisma/client");

const app = express();
const prisma = new PrismaClient();

process.on("unhandledRejection", (err) => {
  console.error("UnhandledRejection:", err);
});
process.on("uncaughtException", (err) => {
  console.error("UncaughtException:", err);
});

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || "import@localhost";
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || "Admin123!";
const ROLE = {
  EMPLOYEE: "EMPLOYEE",
  HR: "HR",
  ADMIN: "ADMIN",
  SUPER_ADMIN: "SUPER_ADMIN",
};

const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      cb(null, `${Date.now()}_${safeName}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

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
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    {
      expiresIn: "7d",
    },
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function writeAudit({
  actorUserId,
  action,
  targetType,
  targetId,
  before,
  after,
  ipAddress,
}) {
  await prisma.auditLog.create({
    data: {
      actorUserId: actorUserId || null,
      action,
      targetType,
      targetId: targetId ? String(targetId) : null,
      beforeJson: before ? JSON.stringify(before) : null,
      afterJson: after ? JSON.stringify(after) : null,
      ipAddress: ipAddress || null,
    },
  });
}

function fireAudit(payload) {
  writeAudit(payload).catch((err) => {
    console.error("AuditWriteFailed:", err);
  });
}

async function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });
    if (!user) return res.status(401).json({ error: "Invalid token" });
    req.authUser = user;
    return next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.authUser)
      return res.status(401).json({ error: "Not authenticated" });
    if (!allowed.includes(req.authUser.role)) {
      return res.status(403).json({ error: "Insufficient role" });
    }
    return next();
  };
}

function summarizeSurveys(surveys) {
  if (!surveys.length) return { count: 0, avgCo2: "-", updated: "-" };
  const sum = surveys.reduce((acc, x) => acc + Number(x.totalCo2Kg || 0), 0);
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
        <td class="px-3 py-2 font-semibold">${Number(row.totalCo2Kg || 0).toFixed(1)}</td>
      </tr>
      `;
    })
    .join("");
}

function summaryHtml(surveys) {
  const s = summarizeSurveys(surveys);
  return `
    <div class="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div class="text-xs uppercase tracking-wide text-slate-500">Datensaetze</div>
      <div class="mt-1 text-2xl font-bold text-slate-900">${s.count}</div>
    </div>
    <div class="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div class="text-xs uppercase tracking-wide text-slate-500">Durchschnitt CO2</div>
      <div class="mt-1 text-2xl font-bold text-slate-900">${s.avgCo2}</div>
    </div>
    <div class="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div class="text-xs uppercase tracking-wide text-slate-500">Letzte Aktualisierung</div>
      <div class="mt-1 text-base font-semibold text-slate-900">${escapeHtml(s.updated)}</div>
    </div>
  `;
}

function adminUsersRowsHtml(users) {
  if (!users.length) {
    return `<tr><td colspan="6" class="px-4 py-6 text-center text-slate-500">Keine Benutzer.</td></tr>`;
  }
  return users
    .map(
      (u) => `
      <tr class="border-b border-slate-200">
        <td class="px-3 py-2">${u.id}</td>
        <td class="px-3 py-2">${escapeHtml(u.email)}</td>
        <td class="px-3 py-2">${escapeHtml(u.name || "-")}</td>
        <td class="px-3 py-2 font-medium">${u.role}</td>
        <td class="px-3 py-2">${u._count.surveys}</td>
        <td class="px-3 py-2">${new Date(u.createdAt).toLocaleDateString("de-AT")}</td>
      </tr>
    `,
    )
    .join("");
}

function auditRowsHtml(logs) {
  if (!logs.length) {
    return `<tr><td colspan="6" class="px-4 py-6 text-center text-slate-500">Keine Logs.</td></tr>`;
  }
  return logs
    .map(
      (l) => `
      <tr class="border-b border-slate-200">
        <td class="px-3 py-2">${l.id}</td>
        <td class="px-3 py-2">${escapeHtml(l.actor?.email || "system")}</td>
        <td class="px-3 py-2">${escapeHtml(l.action)}</td>
        <td class="px-3 py-2">${escapeHtml(l.targetType)}</td>
        <td class="px-3 py-2">${escapeHtml(l.targetId || "-")}</td>
        <td class="px-3 py-2">${new Date(l.createdAt).toLocaleString("de-AT")}</td>
      </tr>
    `,
    )
    .join("");
}

function uploadRowsHtml(items) {
  if (!items.length) {
    return `<tr><td colspan="5" class="px-4 py-6 text-center text-slate-500">Keine Uploads.</td></tr>`;
  }
  return items
    .map(
      (f) => `
      <tr class="border-b border-slate-200">
        <td class="px-3 py-2">${f.id}</td>
        <td class="px-3 py-2">${escapeHtml(f.originalName)}</td>
        <td class="px-3 py-2">${Math.round(f.sizeBytes / 1024)} KB</td>
        <td class="px-3 py-2">${escapeHtml(f.uploadedBy?.email || "-")}</td>
        <td class="px-3 py-2">${new Date(f.createdAt).toLocaleString("de-AT")}</td>
      </tr>
    `,
    )
    .join("");
}

async function ensureInitialAdmin() {
  const adminCount = await prisma.user.count({
    where: { role: { in: [ROLE.ADMIN, ROLE.SUPER_ADMIN] } },
  });
  if (adminCount > 0) return;

  const byEmail = await prisma.user.findUnique({
    where: { email: SUPER_ADMIN_EMAIL },
  });
  if (byEmail) {
    const passwordNeedsHash = !byEmail.password.startsWith("$2");
    const password = passwordNeedsHash
      ? await bcrypt.hash(SUPER_ADMIN_PASSWORD, 10)
      : byEmail.password;
    await prisma.user.update({
      where: { id: byEmail.id },
      data: { role: ROLE.SUPER_ADMIN, password },
    });
    return;
  }

  const hash = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 10);
  await prisma.user.create({
    data: {
      email: SUPER_ADMIN_EMAIL,
      password: hash,
      name: "Bootstrap Admin",
      role: ROLE.SUPER_ADMIN,
    },
  });
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
    const role = email === SUPER_ADMIN_EMAIL ? ROLE.SUPER_ADMIN : ROLE.EMPLOYEE;
    const user = await prisma.user.create({
      data: { email, password: hash, name: name || null, role },
    });

    await writeAudit({
      actorUserId: user.id,
      action: "REGISTER",
      targetType: "User",
      targetId: user.id,
      after: { email: user.email, role: user.role },
      ipAddress: req.ip,
    });

    return res.json({ token: signToken(user), role: user.role });
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
    if (!user) return res.status(401).json({ error: "invalid credentials" });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: "invalid credentials" });

    return res.json({ token: signToken(user), role: user.role });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "login failed" });
  }
});

app.post("/auth/login-hx", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res
        .status(400)
        .send(
          `<div class="text-sm text-red-700">Email und Passwort sind erforderlich.</div>`,
        );
    }
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user)
      return res
        .status(401)
        .send(`<div class="text-sm text-red-700">Login fehlgeschlagen.</div>`);

    const ok = await bcrypt.compare(password, user.password);
    if (!ok)
      return res
        .status(401)
        .send(`<div class="text-sm text-red-700">Login fehlgeschlagen.</div>`);

    const token = signToken(user);
    res.setHeader(
      "HX-Trigger",
      JSON.stringify({ authChanged: { token, role: user.role } }),
    );
    return res.send(
      `<div class="text-sm text-emerald-700">Login erfolgreich (${user.role}).</div>`,
    );
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .send(`<div class="text-sm text-red-700">Login fehlgeschlagen.</div>`);
  }
});

app.post("/auth/register-hx", async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) {
      return res
        .status(400)
        .send(
          `<div class="text-sm text-red-700">Email und Passwort sind erforderlich.</div>`,
        );
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res
        .status(400)
        .send(
          `<div class="text-sm text-red-700">Email existiert bereits.</div>`,
        );
    }

    const hash = await bcrypt.hash(password, 10);
    const role = email === SUPER_ADMIN_EMAIL ? ROLE.SUPER_ADMIN : ROLE.EMPLOYEE;
    const user = await prisma.user.create({
      data: { email, password: hash, name: name || null, role },
    });

    await writeAudit({
      actorUserId: user.id,
      action: "REGISTER",
      targetType: "User",
      targetId: user.id,
      after: { email: user.email, role: user.role },
      ipAddress: req.ip,
    });

    const token = signToken(user);
    res.setHeader(
      "HX-Trigger",
      JSON.stringify({ authChanged: { token, role: user.role } }),
    );
    return res.send(
      `<div class="text-sm text-emerald-700">Registrierung erfolgreich (${user.role}).</div>`,
    );
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .send(
        `<div class="text-sm text-red-700">Registrierung fehlgeschlagen.</div>`,
      );
  }
});

app.get("/me", auth, async (req, res) => {
  return res.json(req.authUser);
});

app.get("/surveys/public", async (_req, res) => {
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

app.get("/partials/surveys/public", async (_req, res) => {
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

app.get("/partials/summary/public", async (_req, res) => {
  const surveys = await prisma.survey.findMany({
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, totalCo2Kg: true },
  });
  return res.send(summaryHtml(surveys));
});

app.get("/surveys", auth, async (req, res) => {
  if (req.authUser.role === ROLE.HR) {
    return res
      .status(403)
      .json({ error: "HR role can access only aggregated data" });
  }
  const where =
    req.authUser.role === ROLE.EMPLOYEE ? { userId: req.authUser.id } : {};

  const surveys = await prisma.survey.findMany({
    where,
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

app.get("/surveys/me", auth, requireRole(ROLE.EMPLOYEE), async (req, res) => {
  const surveys = await prisma.survey.findMany({
    where: { userId: req.authUser.id },
    orderBy: { createdAt: "desc" },
  });
  return res.json(surveys);
});

app.get("/partials/surveys/private", auth, async (req, res) => {
  if (req.authUser.role === ROLE.HR) {
    return res.send(
      `<tr><td colspan="7" class="px-4 py-6 text-center text-slate-500">HR sieht nur aggregierte Daten.</td></tr>`,
    );
  }
  const where =
    req.authUser.role === ROLE.EMPLOYEE ? { userId: req.authUser.id } : {};
  const surveys = await prisma.survey.findMany({
    where,
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
  const where =
    req.authUser.role === ROLE.EMPLOYEE ? { userId: req.authUser.id } : {};
  const surveys = await prisma.survey.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, totalCo2Kg: true },
  });
  return res.send(summaryHtml(surveys));
});

app.get(
  "/hr/aggregations",
  auth,
  requireRole(ROLE.HR, ROLE.ADMIN, ROLE.SUPER_ADMIN),
  async (_req, res) => {
    const surveys = await prisma.survey.findMany({
      select: {
        transportMain: true,
        totalCo2Kg: true,
        officeDaysPerWeek: true,
        distanceKm: true,
        flightsPerYear: true,
      },
    });

    const byTransport = {};
    let total = 0;
    surveys.forEach((s) => {
      const key = s.transportMain || "UNKNOWN";
      byTransport[key] = (byTransport[key] || 0) + 1;
      total += Number(s.totalCo2Kg || 0);
    });

    return res.json({
      count: surveys.length,
      avgCo2Kg: surveys.length
        ? Number((total / surveys.length).toFixed(2))
        : 0,
      byTransport,
    });
  },
);

app.get(
  "/admin/access",
  auth,
  requireRole(ROLE.ADMIN, ROLE.SUPER_ADMIN),
  (_req, res) => {
    return res.json({ allowed: true });
  },
);

app.get(
  "/admin/users",
  auth,
  requireRole(ROLE.ADMIN, ROLE.SUPER_ADMIN),
  async (_req, res) => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        _count: { select: { surveys: true } },
      },
    });
    return res.json(users);
  },
);

app.put(
  "/admin/users/:id/role",
  auth,
  requireRole(ROLE.ADMIN, ROLE.SUPER_ADMIN),
  async (req, res) => {
    const userId = Number(req.params.id);
    const { role } = req.body;
    if (!Object.values(ROLE).includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    const before = await prisma.user.findUnique({ where: { id: userId } });
    if (!before) return res.status(404).json({ error: "User not found" });

    if (
      before.role === ROLE.SUPER_ADMIN &&
      req.authUser.role !== ROLE.SUPER_ADMIN
    ) {
      return res
        .status(403)
        .json({ error: "Only SUPER_ADMIN can modify SUPER_ADMIN role" });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { role },
      select: { id: true, email: true, role: true, name: true },
    });

    await writeAudit({
      actorUserId: req.authUser.id,
      action: "ROLE_UPDATE",
      targetType: "User",
      targetId: userId,
      before: { role: before.role },
      after: { role: updated.role },
      ipAddress: req.ip,
    });

    return res.json(updated);
  },
);

app.get(
  "/admin/surveys",
  auth,
  requireRole(ROLE.ADMIN, ROLE.SUPER_ADMIN),
  async (_req, res) => {
    const surveys = await prisma.survey.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, email: true, name: true, role: true } },
      },
    });
    return res.json(surveys);
  },
);

app.patch(
  "/admin/surveys/:id",
  auth,
  requireRole(ROLE.ADMIN, ROLE.SUPER_ADMIN),
  async (req, res) => {
    const surveyId = Number(req.params.id);
    const patch = req.body || {};

    const before = await prisma.survey.findUnique({ where: { id: surveyId } });
    if (!before) return res.status(404).json({ error: "Survey not found" });

    if (patch.distanceKm !== undefined) {
      const n = Number(patch.distanceKm);
      if (!Number.isFinite(n) || n < 0 || n > 500) {
        return res.status(400).json({ error: "distanceKm out of range" });
      }
    }
    if (patch.officeDaysPerWeek !== undefined) {
      const n = Number(patch.officeDaysPerWeek);
      if (!Number.isInteger(n) || n < 0 || n > 7) {
        return res
          .status(400)
          .json({ error: "officeDaysPerWeek out of range" });
      }
    }
    if (patch.totalCo2Kg !== undefined && patch.totalCo2Kg !== null) {
      const n = Number(patch.totalCo2Kg);
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ error: "totalCo2Kg invalid" });
      }
    }

    const allowed = [
      "officeDaysPerWeek",
      "transportMain",
      "alternativeTransportFreq",
      "alternativeTransport",
      "distanceKm",
      "carType",
      "flightsPerYear",
      "flightDistanceKm",
      "heatingType",
      "warmWaterType",
      "usesGreenElectricity",
      "smartElectricityUsage",
      "fireworkPerYear",
      "co2Importance",
      "totalCo2Kg",
    ];

    const data = {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        data[key] = patch[key];
      }
    }

    const updated = await prisma.survey.update({
      where: { id: surveyId },
      data,
    });

    await writeAudit({
      actorUserId: req.authUser.id,
      action: "SURVEY_UPDATE",
      targetType: "Survey",
      targetId: surveyId,
      before,
      after: updated,
      ipAddress: req.ip,
    });

    return res.json(updated);
  },
);

app.get(
  "/admin/audit-logs",
  auth,
  requireRole(ROLE.ADMIN, ROLE.SUPER_ADMIN),
  async (req, res) => {
    const take = Math.min(Number(req.query.take) || 200, 1000);
    const logs = await prisma.auditLog.findMany({
      take,
      orderBy: { createdAt: "desc" },
      include: {
        actor: { select: { id: true, email: true, role: true } },
      },
    });
    return res.json(logs);
  },
);

app.get(
  "/admin/export.csv",
  auth,
  requireRole(ROLE.ADMIN, ROLE.SUPER_ADMIN),
  async (req, res) => {
    const surveys = await prisma.survey.findMany({
      orderBy: { createdAt: "desc" },
      include: { user: { select: { email: true, name: true, role: true } } },
    });

    const header = [
      "id",
      "createdAt",
      "userEmail",
      "userName",
      "userRole",
      "transportMain",
      "distanceKm",
      "flightsPerYear",
      "totalCo2Kg",
    ];

    const lines = [header.join(",")];
    surveys.forEach((s) => {
      lines.push(
        [
          s.id,
          s.createdAt.toISOString(),
          s.user?.email || "",
          s.user?.name || "",
          s.user?.role || "",
          s.transportMain || "",
          s.distanceKm ?? "",
          s.flightsPerYear ?? "",
          s.totalCo2Kg ?? "",
        ]
          .map((x) => `"${String(x).replaceAll('"', '""')}"`)
          .join(","),
      );
    });

    fireAudit({
      actorUserId: req.authUser.id,
      action: "EXPORT_CSV",
      targetType: "Survey",
      ipAddress: req.ip,
    });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="surveys_${Date.now()}.csv"`,
    );
    return res.send(lines.join("\n"));
  },
);

app.get(
  "/admin/export.xlsx",
  auth,
  requireRole(ROLE.ADMIN, ROLE.SUPER_ADMIN),
  async (req, res) => {
    const surveys = await prisma.survey.findMany({
      orderBy: { createdAt: "desc" },
      include: { user: { select: { email: true, name: true, role: true } } },
    });

    const rows = surveys.map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      userEmail: s.user?.email || "",
      userName: s.user?.name || "",
      userRole: s.user?.role || "",
      transportMain: s.transportMain,
      distanceKm: s.distanceKm,
      flightsPerYear: s.flightsPerYear,
      totalCo2Kg: s.totalCo2Kg,
    }));

    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(rows);
    xlsx.utils.book_append_sheet(wb, ws, "Surveys");
    const buf = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });

    fireAudit({
      actorUserId: req.authUser.id,
      action: "EXPORT_XLSX",
      targetType: "Survey",
      ipAddress: req.ip,
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="surveys_${Date.now()}.xlsx"`,
    );
    return res.send(buf);
  },
);

app.get(
  "/admin/export.pdf",
  auth,
  requireRole(ROLE.ADMIN, ROLE.SUPER_ADMIN),
  async (req, res) => {
    const surveys = await prisma.survey.findMany({
      take: 300,
      orderBy: { createdAt: "desc" },
      include: { user: { select: { email: true, name: true, role: true } } },
    });

    fireAudit({
      actorUserId: req.authUser.id,
      action: "EXPORT_PDF",
      targetType: "Survey",
      ipAddress: req.ip,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="surveys_${Date.now()}.pdf"`,
    );

    const doc = new PDFDocument({ size: "A4", margin: 40 });
    doc.pipe(res);
    doc.fontSize(18).text("EVN CO2 Export", { align: "left" });
    doc.moveDown(0.4);
    doc.fontSize(10).text(`Generated: ${new Date().toLocaleString("de-AT")}`);
    doc.moveDown(0.8);

    surveys.forEach((s, idx) => {
      const line = `${idx + 1}. #${s.id} | ${s.user?.email || "-"} | ${s.transportMain || "-"} | CO2: ${Number(
        s.totalCo2Kg || 0,
      ).toFixed(1)} kg`;
      doc.fontSize(9).text(line, { lineGap: 2 });
      if (doc.y > 760) doc.addPage();
    });

    doc.end();
  },
);

app.post(
  "/admin/upload",
  auth,
  requireRole(ROLE.ADMIN, ROLE.SUPER_ADMIN),
  upload.single("file"),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const saved = await prisma.uploadedFile.create({
      data: {
        originalName: req.file.originalname,
        storedName: req.file.filename,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        uploadedById: req.authUser.id,
      },
    });

    await writeAudit({
      actorUserId: req.authUser.id,
      action: "FILE_UPLOAD",
      targetType: "UploadedFile",
      targetId: saved.id,
      after: {
        originalName: saved.originalName,
        sizeBytes: saved.sizeBytes,
      },
      ipAddress: req.ip,
    });

    return res.json(saved);
  },
);

app.get(
  "/admin/uploads",
  auth,
  requireRole(ROLE.ADMIN, ROLE.SUPER_ADMIN),
  async (_req, res) => {
    const items = await prisma.uploadedFile.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        uploadedBy: { select: { id: true, email: true, role: true } },
      },
    });
    return res.json(items);
  },
);

app.get(
  "/admin/partials/users",
  auth,
  requireRole(ROLE.ADMIN, ROLE.SUPER_ADMIN),
  async (_req, res) => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        _count: { select: { surveys: true } },
      },
    });
    return res.send(adminUsersRowsHtml(users));
  },
);

app.get(
  "/admin/partials/audit-logs",
  auth,
  requireRole(ROLE.ADMIN, ROLE.SUPER_ADMIN),
  async (_req, res) => {
    const logs = await prisma.auditLog.findMany({
      take: 200,
      orderBy: { createdAt: "desc" },
      include: { actor: { select: { email: true } } },
    });
    return res.send(auditRowsHtml(logs));
  },
);

app.get(
  "/admin/partials/uploads",
  auth,
  requireRole(ROLE.ADMIN, ROLE.SUPER_ADMIN),
  async (_req, res) => {
    const items = await prisma.uploadedFile.findMany({
      take: 200,
      orderBy: { createdAt: "desc" },
      include: { uploadedBy: { select: { email: true } } },
    });
    return res.send(uploadRowsHtml(items));
  },
);

// Public endpoint to fetch emission factors (imported from Excel)
app.get("/emission-factors", async (_req, res) => {
  try {
    const list = await prisma.emissionFactor.findMany({
      orderBy: { createdAt: "asc" },
    });
    return res.json(list);
  } catch (err) {
    console.error("Failed to fetch emission factors:", err);
    return res.status(500).json({ error: "failed" });
  }
});

// Public pre-aggregated data for frontend charts
app.get("/public/aggregations", async (_req, res) => {
  try {
    const surveys = await prisma.survey.findMany({
      select: {
        transportMain: true,
        totalCo2Kg: true,
        createdAt: true,
        flightsPerYear: true,
      },
    });

    const byTransport = {};
    const flights = {};
    let totalCo2 = 0;

    const byMonth = {};

    surveys.forEach((s) => {
      const t = s.transportMain || "UNKNOWN";
      byTransport[t] = (byTransport[t] || 0) + 1;

      const f = (() => {
        const v = s.flightsPerYear ?? -1;
        if (v <= 0) return "0";
        if (v <= 2) return "1-2";
        if (v <= 5) return "2-5";
        return ">5";
      })();
      flights[f] = (flights[f] || 0) + 1;

      totalCo2 += Number(s.totalCo2Kg || 0);

      const d = new Date(s.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      byMonth[key] = byMonth[key] || { sum: 0, count: 0 };
      byMonth[key].sum += Number(s.totalCo2Kg || 0);
      byMonth[key].count += 1;
    });

    const months = Object.keys(byMonth).sort();
    const avgCo2ByMonth = months.map((m) =>
      Number((byMonth[m].sum / byMonth[m].count).toFixed(2)),
    );

    return res.json({
      count: surveys.length,
      avgCo2Kg: surveys.length
        ? Number((totalCo2 / surveys.length).toFixed(2))
        : 0,
      byTransport,
      flights,
      months,
      avgCo2ByMonth,
    });
  } catch (err) {
    console.error("Failed to compute aggregations:", err);
    return res.status(500).json({ error: "failed" });
  }
});

ensureInitialAdmin()
  .then(() => {
    app.listen(3000, () => {
      console.log("API running on http://localhost:3000");
    });
  })
  .catch((err) => {
    console.error("Startup failed:", err);
    process.exit(1);
  });
