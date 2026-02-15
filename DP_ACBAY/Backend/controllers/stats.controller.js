const { PrismaClient } = require("@prisma/client");
const { ROLE } = require("../services/auth.services");

const prisma = new PrismaClient();

/**
 * Get public surveys summary
 */
async function getPublicSurveys(req, res) {
  try {
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
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to fetch surveys" });
  }
}

/**
 * Get authenticated user's surveys
 */
async function getUserSurveys(req, res) {
  try {
    if (req.authUser.role === ROLE.HR) {
      return res
        .status(403)
        .json({ error: "HR role can access only aggregated data" });
    }

    const where =
      req.authUser.role === ROLE.EMPLOYEE
        ? { userId: req.authUser.id }
        : {};

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
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to fetch surveys" });
  }
}

/**
 * Get current user's surveys
 */
async function getMySurveys(req, res) {
  try {
    const surveys = await prisma.survey.findMany({
      where: { userId: req.authUser.id },
      orderBy: { createdAt: "desc" },
    });
    return res.json(surveys);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to fetch surveys" });
  }
}

/**
 * Get emission factors
 */
async function getEmissionFactors(req, res) {
  try {
    const list = await prisma.emissionFactor.findMany({
      orderBy: { createdAt: "asc" },
    });
    return res.json(list);
  } catch (err) {
    console.error("Failed to fetch emission factors:", err);
    return res.status(500).json({ error: "failed" });
  }
}

/**
 * Get public aggregations for charts
 */
async function getPublicAggregations(req, res) {
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
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
        2,
        "0"
      )}`;
      byMonth[key] = byMonth[key] || { sum: 0, count: 0 };
      byMonth[key].sum += Number(s.totalCo2Kg || 0);
      byMonth[key].count += 1;
    });

    const months = Object.keys(byMonth).sort();
    const avgCo2ByMonth = months.map((m) =>
      Number((byMonth[m].sum / byMonth[m].count).toFixed(2))
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
}

/**
 * Get HR aggregations
 */
async function getHrAggregations(req, res) {
  try {
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
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "failed" });
  }
}

module.exports = {
  getPublicSurveys,
  getUserSurveys,
  getMySurveys,
  getEmissionFactors,
  getPublicAggregations,
  getHrAggregations,
};