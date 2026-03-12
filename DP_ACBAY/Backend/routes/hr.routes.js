const express = require("express");
const XLSX = require("xlsx");
const PDFDocument = require("pdfkit");
const { PrismaClient } = require("@prisma/client");
const { auth, requireRole } = require("../middleware/auth.middleware");
const { ROLE } = require("../services/auth.services");

const prisma = new PrismaClient();
const router = express.Router();

function normalizeExportValue(value) {
  if (value === null || value === undefined || value === "") return "";
  return value;
}

function toGermanDateTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("de-DE");
}

function pickExportValue(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return "";
}

function mapSurveyToGermanExportRow(survey) {
  return {
    "ID": survey.id,
    "Benutzer-ID": survey.userId,
    "E-Mail": survey.user?.email || survey.mitarbeiter || "",
    "Mitarbeiter": survey.mitarbeiter || survey.user?.email || "",
    "Name": normalizeExportValue(survey.employeeName),
    "Bürotage pro Woche": normalizeExportValue(survey.officeDaysPerWeek),
    "Pendelverkehrsmittel": normalizeExportValue(survey.transportMain),
    "Alternative Verkehrsmittel Nutzung": normalizeExportValue(survey.alternativeTransportFreq),
    "Alternatives Verkehrsmittel": normalizeExportValue(survey.alternativeTransport),
    "Pendelstrecke (km)": normalizeExportValue(survey.distanceKm),
    "Autoantrieb": normalizeExportValue(survey.carType),
    "Kurzstrecken Zug Alternative": normalizeExportValue(survey.shortHaulTrainAlternative),
    "Flüge pro Jahr": normalizeExportValue(survey.flightsPerYear),
    "Flugdistanz": normalizeExportValue(survey.flightDistanceKm),
    "Heizungsart": normalizeExportValue(survey.heatingType),
    "Warmwassererzeugung": normalizeExportValue(survey.warmWaterType),
    "Ökostromnutzung": normalizeExportValue(survey.usesGreenElectricity),
    "Ökostrom Art": normalizeExportValue(survey.greenElectricityType),
    "Lastoptimierung": normalizeExportValue(pickExportValue(survey.loadOptimization, survey.smartElectricityUsage)),
    "Feuerwerk pro Jahr": normalizeExportValue(survey.fireworkPerYear),
    "Nachhaltiger Transport": normalizeExportValue(survey.shoppingTransportEcoChoice),
    "Energieeffiziente Geräte": normalizeExportValue(survey.usesEnergyEfficientAppliances),
    "Smarte Geräte": normalizeExportValue(survey.usesSmartDevices),
    "Regionaler Kauf": normalizeExportValue(survey.buysRegionalProducts),
    "Nachhaltige Kleidung": normalizeExportValue(survey.buysSustainableClothing),
    "Online-Shopping vermeiden": normalizeExportValue(survey.avoidsOnlineShopping),
    "CO2 gesamt (kg)": normalizeExportValue(survey.totalCo2Kg),
    "Erstellt am": toGermanDateTime(survey.createdAt),
  };
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

async function getSurveyExportRows() {
  const surveys = await prisma.survey.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      user: {
        select: {
          email: true,
        },
      },
    },
  });

  return surveys.map(mapSurveyToGermanExportRow);
}

router.use(auth, requireRole(ROLE.HR, ROLE.ADMIN, ROLE.SUPER_ADMIN));

router.get("/export.csv", async (req, res) => {
  try {
    const rows = await getSurveyExportRows();
    const headers = rows.length ? Object.keys(rows[0]) : ["Hinweis"];
    const lines = [headers.map(csvEscape).join(",")];

    if (!rows.length) {
      lines.push(csvEscape("Keine Daten vorhanden"));
    } else {
      for (const row of rows) {
        lines.push(headers.map((header) => csvEscape(row[header])).join(","));
      }
    }

    const csv = `\uFEFF${lines.join("\n")}`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=surveys.csv");
    return res.send(csv);
  } catch (err) {
    console.error("hr export csv failed:", err);
    return res.status(500).json({ error: "CSV Export fehlgeschlagen" });
  }
});

router.get("/export.xlsx", async (req, res) => {
  try {
    const rows = await getSurveyExportRows();
    const worksheetData = rows.length ? rows : [{ Hinweis: "Keine Daten vorhanden" }];

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(worksheetData);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Surveys");

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=surveys.xlsx");
    return res.send(buffer);
  } catch (err) {
    console.error("hr export xlsx failed:", err);
    return res.status(500).json({ error: "XLSX Export fehlgeschlagen" });
  }
});

router.get("/export.pdf", async (req, res) => {
  try {
    const rows = await getSurveyExportRows();
    const exportRows = rows.length ? rows : [{ Hinweis: "Keine Daten vorhanden" }];

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=surveys.pdf");

    const doc = new PDFDocument({ margin: 40, size: "A4" });
    doc.pipe(res);

    doc.fontSize(16).text("Survey Export", { align: "left" });
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Erstellt am: ${new Date().toLocaleString("de-DE")}`);
    doc.moveDown(1);

    exportRows.forEach((row, index) => {
      doc.fontSize(11).text(`Datensatz ${index + 1}`, { underline: true });
      Object.entries(row).forEach(([key, value]) => {
        doc.fontSize(9).text(`${key}: ${value ?? ""}`);
      });
      doc.moveDown(0.7);

      if (doc.y > 760) {
        doc.addPage();
      }
    });

    doc.end();
  } catch (err) {
    console.error("hr export pdf failed:", err);
    return res.status(500).json({ error: "PDF Export fehlgeschlagen" });
  }
});

module.exports = router;
