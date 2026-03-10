const { PrismaClient } = require("@prisma/client");
const { ROLE } = require("../services/auth.services");
const { buildSurveyAggregations } = require("../services/aggregation.service");

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
        heatingType: true,
        warmWaterType: true,
        usesGreenElectricity: true,
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
        heatingType: true,
        warmWaterType: true,
        usesGreenElectricity: true,
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
    const [surveys, factors] = await Promise.all([
      prisma.survey.findMany({
        select: {
          transportMain: true,
          alternativeTransport: true,
          alternativeTransportFreq: true,
          officeDaysPerWeek: true,
          distanceKm: true,
          totalCo2Kg: true,
          createdAt: true,
          flightsPerYear: true,
          heatingType: true,
          usesGreenElectricity: true,
        },
      }),
      prisma.emissionFactor.findMany({
        select: {
          category: true,
          type: true,
          co2PerUnit: true,
          unit: true,
        },
      }),
    ]);

    const normalizedFactors = factors.map((factor) => ({
      category: factor.category,
      label: factor.type,
      valueNumber: Number(factor.co2PerUnit || 0),
      unit: factor.unit,
    }));

    return res.json(buildSurveyAggregations(surveys, normalizedFactors));
  } catch (err) {
    console.error("Failed to compute aggregations:", err);
    return res.status(500).json({ error: "failed" });
  }
}

/**
 * Get aggregations for authenticated user scope
 */
async function getPrivateAggregations(req, res) {
  try {
    const where = req.authUser.role === ROLE.EMPLOYEE
      ? { userId: req.authUser.id }
      : {};

    const [surveys, factors] = await Promise.all([
      prisma.survey.findMany({
        where,
        select: {
          transportMain: true,
          alternativeTransport: true,
          alternativeTransportFreq: true,
          officeDaysPerWeek: true,
          distanceKm: true,
          totalCo2Kg: true,
          createdAt: true,
          flightsPerYear: true,
          heatingType: true,
          usesGreenElectricity: true,
        },
      }),
      prisma.emissionFactor.findMany({
        select: {
          category: true,
          type: true,
          co2PerUnit: true,
          unit: true,
        },
      }),
    ]);

    const normalizedFactors = factors.map((factor) => ({
      category: factor.category,
      label: factor.type,
      valueNumber: Number(factor.co2PerUnit || 0),
      unit: factor.unit,
    }));

    return res.json(buildSurveyAggregations(surveys, normalizedFactors));
  } catch (err) {
    console.error("Failed to compute private aggregations:", err);
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
  getPrivateAggregations,
  getHrAggregations,
};
