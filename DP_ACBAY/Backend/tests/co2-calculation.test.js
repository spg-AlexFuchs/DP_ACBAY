const test = require("node:test");
const assert = require("node:assert/strict");

const { toNumber } = require("../services/import/import-excel");
const {
  computeSurveyTotal,
  computeSurveyComponentKgFromRecord,
} = require("../services/calculation.service");
const {
  buildSurveyAggregations,
} = require("../services/aggregation.service");

function baseFactors() {
  return [
    { category: "transport", label: "PKW Benzin", valueNumber: 200, unit: "g/km" },
    { category: "transport", label: "Anderes Pendelfahrzeug", valueNumber: 150, unit: "g/km" },

    { category: "heating", label: "Erdgas (Brennwert)", valueNumber: 100, unit: "g CO2/kWh" },
    { category: "heating", label: "Strom Ö-Mix", valueNumber: 200, unit: "g CO2/kWh Strom" },
    { category: "heating", label: "Ökostrom", valueNumber: 25, unit: "g CO2/kWh Strom" },
    { category: "heating", label: "Energiebedarf Heizen", valueNumber: 1000, unit: "kWh/Jahr" },
    { category: "heating", label: "Energiebedarf Warmwasser", valueNumber: 500, unit: "kWh/Jahr" },
    { category: "heating", label: "Energiebedarf Strom", valueNumber: 1000, unit: "kWh/Jahr" },

    { category: "consumption", label: "Ernährung", valueNumber: 1, unit: "t CO2e/Jahr" },
    { category: "consumption", label: "Konsumgüter", valueNumber: 1, unit: "t CO2e/Jahr" },
    { category: "consumption", label: "Alltagsmobilität (ohne Pendeln)", valueNumber: 1, unit: "t CO2e/Jahr" },
  ];
}

test("toNumber parses range values from Excel", () => {
  assert.equal(toNumber("0-50"), 25);
  assert.equal(toNumber("10 - 20"), 15);
  assert.equal(toNumber("-10-30"), 10);
  assert.equal(toNumber("42"), 42);
});

test("computeSurveyTotal calculates deterministic reference case", () => {
  const factors = baseFactors();

  const total = computeSurveyTotal(
    {
      officeDaysText: "5",
      transportMainText: "PKW Benzin",
      alternativeTransportFreqText: "nie",
      alternativeTransportText: null,
      distanceText: "10-20",
      carTypeText: null,
      flightsPerYearText: "nie",
      flightDistanceText: null,
      heatingTypeText: "Erdgas",
      warmWaterTypeText: "Strom",
      usesGreenElectricityText: "Nein",
      smartElectricityUsageText: "nie",
      heatingSavingsText: "nie",
      flightAvoidanceText: "nein",
      shortHaulTrainAlternativeText: "nein",
      shoppingTransportEcoChoiceText: null,
      usesEnergyEfficientAppliancesText: null,
      usesSmartDevicesText: null,
      regionalProductsText: null,
      sustainableClothingText: null,
      avoidsOnlineShoppingText: null,
      fireworkText: "nie",
    },
    factors
  );

  const components = computeSurveyComponentKgFromRecord(
    {
      officeDaysPerWeek: 5,
      distanceKm: 15,
      transportMain: "PKW Benzin",
      alternativeTransport: null,
      alternativeTransportFreq: 0,
      flightsPerYear: 0,
      flightDistanceKm: null,
      heatingType: "Erdgas (Brennwert)",
      warmWaterType: "Strom Ö-Mix",
      usesGreenElectricity: "Nein",
      smartElectricityUsage: 0,
      fireworkPerYear: 0,
      shoppingTransportEcoChoice: null,
      usesEnergyEfficientAppliances: null,
      usesSmartDevices: null,
      buysRegionalProducts: null,
      buysSustainableClothing: null,
      avoidsOnlineShopping: null,
    },
    factors
  );

  const expectedFromComponents =
    components.commuteKg +
    components.flightKg +
    components.heatingKg +
    components.warmWaterKg +
    components.electricityKg +
    components.consumptionKg;

  assert.equal(total, expectedFromComponents);
});

test("buildSurveyAggregations keeps co2 area sum aligned with average total", () => {
  const factors = baseFactors();

  const surveyA = {
    officeDaysPerWeek: 5,
    distanceKm: 15,
    transportMain: "PKW Benzin",
    alternativeTransport: null,
    alternativeTransportFreq: 0,
    flightsPerYear: 0,
    flightDistanceKm: null,
    heatingType: "Erdgas (Brennwert)",
    warmWaterType: "Strom Ö-Mix",
    usesGreenElectricity: "Nein",
    smartElectricityUsage: 0,
    fireworkPerYear: 0,
    shoppingTransportEcoChoice: null,
    usesEnergyEfficientAppliances: null,
    usesSmartDevices: null,
    buysRegionalProducts: null,
    buysSustainableClothing: null,
    avoidsOnlineShopping: null,
    totalCo2Kg: 17200,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  const surveyB = {
    ...surveyA,
    usesGreenElectricity: "Ja",
    totalCo2Kg: 16000,
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
  };

  const agg = buildSurveyAggregations([surveyA, surveyB], factors);
  const areasTotal = Object.values(agg.co2Areas).reduce((sum, value) => sum + Number(value || 0), 0);
  const expectedTotal = Number(agg.avgCo2Kg) * Number(agg.count);

  assert.ok(Math.abs(areasTotal - expectedTotal) < 0.2);
});
