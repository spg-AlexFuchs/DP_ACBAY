const { PrismaClient } = require("@prisma/client");
const { ROLE } = require("../services/auth.services");
const { buildSurveyAggregations } = require("../services/aggregation.service");
const calc = require("../services/calculation.service");

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
          flightDistanceKm: true,
          heatingType: true,
          warmWaterType: true,
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
          flightDistanceKm: true,
          heatingType: true,
          warmWaterType: true,
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

/**
 * Create or update the logged-in user's own survey entry.
 * Accepts the original German survey text answers and parses them
 * the same way the Excel import does.
 */
async function saveMySurvey(req, res) {
  try {
    const userId = req.authUser.id;
    const b = req.body || {};

    const str = (v) => (v !== null && v !== undefined ? String(v).trim() : "");

    const officeDaysText              = str(b.officeDaysPerWeek);
    const transportMainText           = str(b.transportMain);
    const carTypeText                 = str(b.carType);
    const alternativeTransportFreqText = str(b.alternativeTransportFreq);
    const alternativeTransportText    = str(b.alternativeTransport);
    const distanceText                = str(b.distanceKm);
    const flightsPerYearText          = str(b.flightsPerYear);
    const flightDistanceText          = str(b.flightDistance);
    const flightAvoidanceText         = str(b.flightAvoidance);
    const shortHaulTrainAlternativeText = str(b.shortHaulTrainAlternative);
    const heatingTypeText             = str(b.heatingType);
    const heatingSavingsText          = str(b.heatingSaving);
    const warmWaterTypeText           = str(b.warmWaterType);
    const usesGreenElectricityText    = str(b.usesGreenElectricity);
    const smartElectricityUsageText   = str(b.smartElectricityUsage);
    const fireworkText                = str(b.fireworkPerYear);
    const shoppingTransportEcoChoiceText     = str(b.shoppingTransportEcoChoice);
    const usesEnergyEfficientAppliancesText  = str(b.usesEnergyEfficientAppliances);
    const usesSmartDevicesText        = str(b.usesSmartDevices);
    const buysRegionalProductsText    = str(b.buysRegionalProducts);
    const buysSustainableClothingText = str(b.buysSustainableClothing);
    const avoidsOnlineShoppingText    = str(b.avoidsOnlineShopping);

    // Load emission factors from DB
    const factorRows = await prisma.emissionFactor.findMany();
    const factors = factorRows.map((r) => ({
      label: r.type,
      valueNumber: r.co2PerUnit,
      category: r.category,
      unit: r.unit,
    }));

    // Compute total CO2 (same logic as Excel import)
    const totalCo2Kg = calc.computeSurveyTotal(
      {
        officeDaysText,
        transportMainText,
        carTypeText,
        alternativeTransportFreqText,
        alternativeTransportText,
        distanceText,
        flightsPerYearText,
        flightDistanceText,
        flightAvoidanceText,
        shortHaulTrainAlternativeText,
        heatingTypeText,
        heatingSavingsText,
        warmWaterTypeText,
        usesGreenElectricityText,
        smartElectricityUsageText,
        fireworkText,
        shoppingTransportEcoChoiceText,
        usesEnergyEfficientAppliancesText,
        usesSmartDevicesText,
        regionalProductsText: buysRegionalProductsText,
        sustainableClothingText: buysSustainableClothingText,
        avoidsOnlineShoppingText,
      },
      factors
    );

    const data = {
      mitarbeiter: req.authUser.email || null,
      officeDaysPerWeek: calc.parseOfficeDays(officeDaysText),
      transportMain: transportMainText || "UNKNOWN",
      alternativeTransportFreq: alternativeTransportFreqText || null,
      alternativeTransport: alternativeTransportText || null,
      distanceKm: calc.parseDistanceKm(distanceText),
      carType: carTypeText || null,
      flightsPerYear: flightsPerYearText || null,
      flightDistanceKm: flightDistanceText || null,
      heatingType: heatingTypeText || "UNKNOWN",
      warmWaterType: warmWaterTypeText || "UNKNOWN",
      usesGreenElectricity: usesGreenElectricityText || null,
      smartElectricityUsage: smartElectricityUsageText || null,
      fireworkPerYear: fireworkText || null,
      shoppingTransportEcoChoice: shoppingTransportEcoChoiceText || null,
      usesEnergyEfficientAppliances: usesEnergyEfficientAppliancesText || null,
      usesSmartDevices: usesSmartDevicesText || null,
      buysRegionalProducts: buysRegionalProductsText || null,
      buysSustainableClothing: buysSustainableClothingText || null,
      avoidsOnlineShopping: avoidsOnlineShoppingText || null,
      totalCo2Kg: Number.isFinite(totalCo2Kg) ? totalCo2Kg : null,
    };

    // Upsert: update existing survey for this user, or create a new one
    const existing = await prisma.survey.findFirst({ where: { userId } });
    let survey;
    if (existing) {
      survey = await prisma.survey.update({ where: { id: existing.id }, data });
    } else {
      survey = await prisma.survey.create({ data: { userId, ...data } });
    }

    return res.json({ ok: true, updated: !!existing, totalCo2Kg: survey.totalCo2Kg });
  } catch (err) {
    console.error("saveMySurvey error:", err);
    return res.status(500).json({ error: "Speichern fehlgeschlagen" });
  }
}

module.exports = {
  getPublicSurveys,
  getUserSurveys,
  getMySurveys,
  saveMySurvey,
  getEmissionFactors,
  getPublicAggregations,
  getPrivateAggregations,
  getHrAggregations,
};
