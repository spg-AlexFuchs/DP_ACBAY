const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const XLSX = require("xlsx");
const PDFDocument = require("pdfkit");
const { PrismaClient } = require("@prisma/client");
const { auth, requireRole } = require("../middleware/auth.middleware");
const { ROLE } = require("../services/auth.services");

const prisma = new PrismaClient();
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function canManageRole(actorRole, nextRole) {
  if (actorRole === ROLE.SUPER_ADMIN) return true;
  if (actorRole === ROLE.ADMIN) return nextRole !== ROLE.SUPER_ADMIN;
  return false;
}

function normalizeSurveyPatch(body) {
  const allowedFields = new Set([
    "distanceKm",
    "officeDaysPerWeek",
    "transportMain",
    "flightsPerYear",
    "totalCo2Kg",
    "heatingType",
  ]);

  const entries = Object.entries(body || {}).filter(([key]) => allowedFields.has(key));
  if (entries.length !== 1) {
    return { error: "Genau ein erlaubtes Feld muss gesetzt werden" };
  }

  const [field, rawValue] = entries[0];
  const valueAsString = String(rawValue ?? "").trim();
  if (!valueAsString) {
    return { error: "Wert darf nicht leer sein" };
  }

  if (field === "distanceKm" || field === "totalCo2Kg") {
    const value = Number(valueAsString);
    if (!Number.isFinite(value)) {
      return { error: `${field} muss eine Zahl sein` };
    }
    return { field, value };
  }

  if (field === "officeDaysPerWeek" || field === "flightsPerYear") {
    const value = Number.parseInt(valueAsString, 10);
    if (!Number.isInteger(value)) {
      return { error: `${field} muss eine ganze Zahl sein` };
    }
    return { field, value };
  }

  return { field, value: valueAsString };
}

function parseIp(req) {
  return (
    req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    null
  );
}

router.use(auth, requireRole(ROLE.ADMIN, ROLE.SUPER_ADMIN));

router.get("/partials/users", async (req, res) => {
  try {
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

    if (!users.length) {
      return res
        .set("Content-Type", "text/html; charset=utf-8")
        .send('<tr><td colspan="6" class="px-3 py-3 text-center text-slate-500">Keine Benutzer</td></tr>');
    }

    const html = users
      .map(
        (u) => `
      <tr class="border-b border-slate-200 hover:bg-slate-50">
        <td class="px-3 py-2">${u.id}</td>
        <td class="px-3 py-2">${escapeHtml(u.email)}</td>
        <td class="px-3 py-2">${escapeHtml(u.name || "-")}</td>
        <td class="px-3 py-2">${escapeHtml(u.role)}</td>
        <td class="px-3 py-2">${u._count.surveys}</td>
        <td class="px-3 py-2">${new Date(u.createdAt).toLocaleString("de-DE")}</td>
      </tr>
    `
      )
      .join("");

    return res.set("Content-Type", "text/html; charset=utf-8").send(html);
  } catch (err) {
    console.error("admin users partial failed:", err);
    return res
      .status(500)
      .set("Content-Type", "text/html; charset=utf-8")
      .send('<tr><td colspan="6" class="px-3 py-3 text-center text-red-600">Fehler beim Laden</td></tr>');
  }
});

router.get("/partials/uploads", async (req, res) => {
  try {
    const uploads = await prisma.uploadedFile.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { uploadedBy: { select: { email: true } } },
    });

    if (!uploads.length) {
      return res
        .set("Content-Type", "text/html; charset=utf-8")
        .send('<tr><td colspan="5" class="px-3 py-3 text-center text-slate-500">Keine Uploads</td></tr>');
    }

    const html = uploads
      .map(
        (f) => `
      <tr class="border-b border-slate-200 hover:bg-slate-50">
        <td class="px-3 py-2">${f.id}</td>
        <td class="px-3 py-2">${escapeHtml(f.originalName)}</td>
        <td class="px-3 py-2">${f.sizeBytes}</td>
        <td class="px-3 py-2">${escapeHtml(f.uploadedBy?.email || "-")}</td>
        <td class="px-3 py-2">${new Date(f.createdAt).toLocaleString("de-DE")}</td>
      </tr>
    `
      )
      .join("");

    return res.set("Content-Type", "text/html; charset=utf-8").send(html);
  } catch (err) {
    console.error("admin uploads partial failed:", err);
    return res
      .status(500)
      .set("Content-Type", "text/html; charset=utf-8")
      .send('<tr><td colspan="5" class="px-3 py-3 text-center text-red-600">Fehler beim Laden</td></tr>');
  }
});

router.get("/partials/audit-logs", async (req, res) => {
  try {
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { actor: { select: { email: true } } },
    });

    if (!logs.length) {
      return res
        .set("Content-Type", "text/html; charset=utf-8")
        .send('<tr><td colspan="6" class="px-3 py-3 text-center text-slate-500">Keine Audit-Eintraege</td></tr>');
    }

    const html = logs
      .map(
        (l) => `
      <tr class="border-b border-slate-200 hover:bg-slate-50">
        <td class="px-3 py-2">${l.id}</td>
        <td class="px-3 py-2">${escapeHtml(l.actor?.email || "-")}</td>
        <td class="px-3 py-2">${escapeHtml(l.action)}</td>
        <td class="px-3 py-2">${escapeHtml(l.targetType)}</td>
        <td class="px-3 py-2">${escapeHtml(l.targetId || "-")}</td>
        <td class="px-3 py-2">${new Date(l.createdAt).toLocaleString("de-DE")}</td>
      </tr>
    `
      )
      .join("");

    return res.set("Content-Type", "text/html; charset=utf-8").send(html);
  } catch (err) {
    console.error("admin audit partial failed:", err);
    return res
      .status(500)
      .set("Content-Type", "text/html; charset=utf-8")
      .send('<tr><td colspan="6" class="px-3 py-3 text-center text-red-600">Fehler beim Laden</td></tr>');
  }
});

router.put("/users/:id/role", requireRole(ROLE.SUPER_ADMIN), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const role = String(req.body?.role || "");
    const validRoles = [ROLE.EMPLOYEE, ROLE.HR, ROLE.ADMIN, ROLE.SUPER_ADMIN];
    if (!id || !validRoles.includes(role)) {
      return res.status(400).json({ error: "Ungueltige Daten" });
    }
    if (!canManageRole(req.authUser.role, role)) {
      return res.status(403).json({ error: "Nicht erlaubt" });
    }

    const before = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
    if (!before) return res.status(404).json({ error: "Benutzer nicht gefunden" });

    if (req.authUser.role !== ROLE.SUPER_ADMIN && before.role === ROLE.SUPER_ADMIN) {
      return res.status(403).json({ error: "SUPER_ADMIN darf nicht geaendert werden" });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { role },
      select: { id: true, email: true, role: true },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: req.authUser.id,
        action: "USER_ROLE_UPDATED",
        targetType: "User",
        targetId: String(id),
        beforeJson: JSON.stringify(before),
        afterJson: JSON.stringify(updated),
        ipAddress: parseIp(req),
      },
    });

    return res.json(updated);
  } catch (err) {
    console.error("set role failed:", err);
    return res.status(500).json({ error: "Rollenupdate fehlgeschlagen" });
  }
});

router.patch("/surveys/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "Ungueltige Daten" });
    }

    const parsed = normalizeSurveyPatch(req.body);
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }

    const { field, value } = parsed;
    const before = await prisma.survey.findUnique({ where: { id } });
    if (!before) return res.status(404).json({ error: "Survey nicht gefunden" });

    const updated = await prisma.survey.update({
      where: { id },
      data: { [field]: value },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: req.authUser.id,
        action: "SURVEY_UPDATED",
        targetType: "Survey",
        targetId: String(id),
        beforeJson: JSON.stringify({ [field]: before[field] }),
        afterJson: JSON.stringify({ [field]: updated[field] }),
        ipAddress: parseIp(req),
      },
    });

    return res.json({ id: updated.id, field, value: updated[field] });
  } catch (err) {
    console.error("patch survey failed:", err);
    return res.status(500).json({ error: "Survey-Update fehlgeschlagen" });
  }
});

router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Keine Datei" });

    const ext = path.extname(req.file.originalname);
    const storedName = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
    const uploadsDir = path.join(__dirname, "..", "uploads");
    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.writeFileSync(path.join(uploadsDir, storedName), req.file.buffer);

    const created = await prisma.uploadedFile.create({
      data: {
        originalName: req.file.originalname,
        storedName,
        mimeType: req.file.mimetype || null,
        sizeBytes: req.file.size,
        uploadedById: req.authUser.id,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: req.authUser.id,
        action: "FILE_UPLOADED",
        targetType: "UploadedFile",
        targetId: String(created.id),
        afterJson: JSON.stringify({ originalName: created.originalName, storedName: created.storedName }),
        ipAddress: parseIp(req),
      },
    });

    return res.json(created);
  } catch (err) {
    console.error("upload failed:", err);
    return res.status(500).json({ error: "Upload fehlgeschlagen" });
  }
});

router.get("/export.csv", async (req, res) => {
  try {
    const surveys = await prisma.survey.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        userId: true,
        officeDaysPerWeek: true,
        transportMain: true,
        distanceKm: true,
        flightsPerYear: true,
        totalCo2Kg: true,
        createdAt: true,
      },
    });
    const header = "id,userId,officeDaysPerWeek,transportMain,distanceKm,flightsPerYear,totalCo2Kg,createdAt";
    const rows = surveys.map((s) =>
      [
        s.id,
        s.userId,
        s.officeDaysPerWeek,
        `"${String(s.transportMain ?? "").replaceAll('"', '""')}"`,
        s.distanceKm,
        s.flightsPerYear ?? "",
        s.totalCo2Kg ?? "",
        new Date(s.createdAt).toISOString(),
      ].join(",")
    );
    const csv = `${header}\n${rows.join("\n")}`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="surveys.csv"');
    return res.send(csv);
  } catch (err) {
    console.error("csv export failed:", err);
    return res.status(500).json({ error: "Export fehlgeschlagen" });
  }
});

router.get("/export.xlsx", async (req, res) => {
  try {
    const surveys = await prisma.survey.findMany({ orderBy: { createdAt: "desc" } });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(
      surveys.map((s) => ({
        ...s,
        createdAt: new Date(s.createdAt).toISOString(),
      }))
    );
    XLSX.utils.book_append_sheet(wb, ws, "Surveys");
    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", 'attachment; filename="surveys.xlsx"');
    return res.send(buffer);
  } catch (err) {
    console.error("xlsx export failed:", err);
    return res.status(500).json({ error: "Export fehlgeschlagen" });
  }
});

router.get("/export.pdf", async (req, res) => {
  try {
    const surveys = await prisma.survey.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, userId: true, transportMain: true, totalCo2Kg: true, createdAt: true },
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="surveys.pdf"');

    const doc = new PDFDocument({ margin: 40, size: "A4" });
    doc.pipe(res);
    doc.fontSize(16).text("Survey Export", { underline: true });
    doc.moveDown();

    surveys.forEach((s) => {
      doc
        .fontSize(10)
        .text(
          `#${s.id} | user:${s.userId} | transport:${s.transportMain || "-"} | co2:${s.totalCo2Kg ?? "-"} | ${new Date(s.createdAt).toLocaleString("de-DE")}`
        );
    });

    doc.end();
  } catch (err) {
    console.error("pdf export failed:", err);
    return res.status(500).json({ error: "Export fehlgeschlagen" });
  }
});

module.exports = router;
