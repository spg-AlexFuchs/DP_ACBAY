const { PrismaClient } = require("@prisma/client");
const { ROLE } = require("../services/auth.services");

const prisma = new PrismaClient();

function formatDate(value) {
  return new Date(value).toLocaleDateString("de-DE");
}

function normalizeCell(value) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value).replace(/_/g, " ");
}

function summaryHtml(totalSurveys, avgCo2, latestDate, palette = "public") {
  if (palette === "private") {
    return `
      <div class="rounded-xl border border-slate-200 bg-gradient-to-br from-purple-50 to-purple-100 p-4">
        <div class="text-xs uppercase tracking-wide text-slate-600">Personenwerte gesamt</div>
        <div class="mt-2 text-3xl font-bold text-purple-700">${totalSurveys}</div>
      </div>
      <div class="rounded-xl border border-slate-200 bg-gradient-to-br from-orange-50 to-orange-100 p-4">
        <div class="text-xs uppercase tracking-wide text-slate-600">CO2 (kg)</div>
        <div class="mt-2 text-3xl font-bold text-orange-700">${avgCo2}</div>
      </div>
      <div class="rounded-xl border border-slate-200 bg-gradient-to-br from-cyan-50 to-cyan-100 p-4">
        <div class="text-xs uppercase tracking-wide text-slate-600">Letzter Stand</div>
        <div class="mt-2 text-lg font-semibold text-cyan-700">${latestDate}</div>
      </div>
    `;
  }

  return `
    <div class="rounded-xl border border-slate-200 bg-gradient-to-br from-red-50 to-red-100 p-4">
      <div class="text-xs uppercase tracking-wide text-slate-600">Personenwerte gesamt</div>
      <div class="mt-2 text-3xl font-bold text-red-700">${totalSurveys}</div>
    </div>
    <div class="rounded-xl border border-slate-200 bg-gradient-to-br from-green-50 to-green-100 p-4">
      <div class="text-xs uppercase tracking-wide text-slate-600">CO2 (kg)</div>
      <div class="mt-2 text-3xl font-bold text-green-700">${avgCo2}</div>
    </div>
    <div class="rounded-xl border border-slate-200 bg-gradient-to-br from-blue-50 to-blue-100 p-4">
      <div class="text-xs uppercase tracking-wide text-slate-600">Letzter Stand</div>
      <div class="mt-2 text-lg font-semibold text-blue-700">${latestDate}</div>
    </div>
  `;
}

function surveyRowsHtml(surveys, rowClass, co2Class) {
  if (surveys.length === 0) {
    return '<tr><td colspan="10" class="px-3 py-4 text-center text-slate-500">Keine Daten</td></tr>';
  }

  return surveys
    .map((s) => {
      const idStr = String(s.id).substring(0, 8);
      return `
      <tr class="border-b border-slate-200 ${rowClass}">
        <td class="px-3 py-2">${idStr}</td>
        <td class="px-3 py-2">—</td>
        <td class="px-3 py-2">${normalizeCell(s.officeDaysPerWeek)}</td>
        <td class="px-3 py-2">${normalizeCell(s.distanceKm)}</td>
        <td class="px-3 py-2">${normalizeCell(s.transportMain)}</td>
        <td class="px-3 py-2">${normalizeCell(s.flightsPerYear)}</td>
        <td class="px-3 py-2">${normalizeCell(s.heatingType)}</td>
        <td class="px-3 py-2">${normalizeCell(s.warmWaterType)}</td>
        <td class="px-3 py-2">${normalizeCell(s.usesGreenElectricity)}</td>
        <td class="px-3 py-2 font-semibold ${co2Class}">${Number(s.totalCo2Kg || 0).toFixed(2)}</td>
      </tr>
    `;
    })
    .join("");
}

/**
 * Get public summary HTML partial
 */
async function getPublicSummary(req, res) {
  try {
    const surveys = await prisma.survey.findMany({
      select: { totalCo2Kg: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    const totalSurveys = surveys.length;
    const avgCo2 =
      surveys.length > 0
        ? Number(
            (
              surveys.reduce((sum, s) => sum + Number(s.totalCo2Kg || 0), 0) /
              surveys.length
            ).toFixed(2)
          )
        : 0;
    const latestDate =
      surveys.length > 0 ? formatDate(surveys[surveys.length - 1].createdAt) : "—";

    res.set("Content-Type", "text/html; charset=utf-8");
    return res.send(summaryHtml(totalSurveys, avgCo2, latestDate, "public"));
  } catch (err) {
    console.error(err);
    return res.status(500).send("<div>Fehler beim Laden der Summary</div>");
  }
}

/**
 * Get private summary HTML partial (requires auth)
 */
async function getPrivateSummary(req, res) {
  try {
    const surveys = await prisma.survey.findMany({
      where: req.authUser.role === ROLE.EMPLOYEE ? { userId: req.authUser.id } : {},
      select: { totalCo2Kg: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    const totalSurveys = surveys.length;
    const avgCo2 =
      surveys.length > 0
        ? Number(
            (
              surveys.reduce((sum, s) => sum + Number(s.totalCo2Kg || 0), 0) /
              surveys.length
            ).toFixed(2)
          )
        : 0;
    const latestDate =
      surveys.length > 0 ? formatDate(surveys[surveys.length - 1].createdAt) : "—";

    res.set("Content-Type", "text/html; charset=utf-8");
    return res.send(summaryHtml(totalSurveys, avgCo2, latestDate, "private"));
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .send("<div>Fehler beim Laden der privaten Summary</div>");
  }
}

/**
 * Get public surveys table rows HTML partial
 */
async function getPublicSurveys(req, res) {
  try {
    const surveys = await prisma.survey.findMany({
      select: {
        id: true,
        officeDaysPerWeek: true,
        distanceKm: true,
        transportMain: true,
        flightsPerYear: true,
        heatingType: true,
        warmWaterType: true,
        usesGreenElectricity: true,
        totalCo2Kg: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.set("Content-Type", "text/html; charset=utf-8");
    return res.send(surveyRowsHtml(surveys, "hover:bg-slate-50", "text-red-600"));
  } catch (err) {
    console.error("Error in getPublicSurveys:", err.message, err.stack);
    return res
      .status(500)
      .send(
        '<tr><td colspan="10" class="px-3 py-4 text-center text-red-500">Fehler beim Laden</td></tr>'
      );
  }
}

/**
 * Get private surveys table rows HTML partial (requires auth)
 */
async function getPrivateSurveys(req, res) {
  try {
    const surveys = await prisma.survey.findMany({
      where: req.authUser.role === ROLE.EMPLOYEE ? { userId: req.authUser.id } : {},
      select: {
        id: true,
        officeDaysPerWeek: true,
        distanceKm: true,
        transportMain: true,
        flightsPerYear: true,
        heatingType: true,
        warmWaterType: true,
        usesGreenElectricity: true,
        totalCo2Kg: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.set("Content-Type", "text/html; charset=utf-8");
    return res.send(surveyRowsHtml(surveys, "hover:bg-purple-50", "text-purple-600"));
  } catch (err) {
    console.error("Error in getPrivateSurveys:", err.message, err.stack);
    return res
      .status(500)
      .send('<tr><td colspan="10" class="px-3 py-4 text-center text-red-500">Fehler</td></tr>');
  }
}

module.exports = {
  getPublicSummary,
  getPrivateSummary,
  getPublicSurveys,
  getPrivateSurveys,
};
