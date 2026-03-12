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
const emissionFactors = require("../services/import/emission-factors.data");

function baseFactors() {
  return emissionFactors;
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

test("computeSurveyTotal supports new schema naming without short-haul field", () => {
  const factors = baseFactors();

  const total = computeSurveyTotal(
    {
      officeDaysText: "4",
      transportMainText: "Eigenes Auto",
      alternativeTransportFreqText: "Manchmal",
      alternativeTransportText: "Öffentliche Verkehrsmittel",
      distanceText: "20-30",
      carTypeText: "Hybrid",
      flightsPerYearText: "1-2",
      flightDistanceText: "Kurzstrecke",
      heatingTypeText: "Gas",
      warmWaterTypeText: "Strom",
      usesGreenElectricityText: "Ja",
      smartElectricityUsageText: "Selten",
      fireworkText: "Nie",
      shoppingTransportEcoChoiceText: "Ja",
      usesEnergyEfficientAppliancesText: "Einige",
      usesSmartDevicesText: "Ja",
      regionalProductsText: "Ja, oft",
      sustainableClothingText: "Manchmal",
      avoidsOnlineShoppingText: "Manchmal",
      // intentionally missing: shortHaulTrainAlternativeText
    },
    factors
  );

  assert.equal(Number.isFinite(total), true);
  assert.ok(total > 0);
});

test("computeSurveyComponentKgFromRecord ignores short-haul train alternative", () => {
  const factors = baseFactors();

  const noTrainAlternative = computeSurveyComponentKgFromRecord(
    {
      officeDaysPerWeek: 2,
      distanceKm: 10,
      transportMain: "PKW Benzin",
      alternativeTransport: null,
      alternativeTransportFreq: "Nie",
      flightsPerYear: "2",
      flightDistanceKm: "Kurzstrecke",
      shortHaulTrainAlternative: "Nein",
      heatingType: "Erdgas (Brennwert)",
      warmWaterType: "Strom Ö-Mix",
      usesGreenElectricity: "Nein",
      smartElectricityUsage: "Nie",
      fireworkPerYear: "Nie",
      shoppingTransportEcoChoice: null,
      usesEnergyEfficientAppliances: null,
      usesSmartDevices: null,
      buysRegionalProducts: null,
      buysSustainableClothing: null,
      avoidsOnlineShopping: null,
    },
    factors
  );

  const withTrainAlternative = computeSurveyComponentKgFromRecord(
    {
      officeDaysPerWeek: 2,
      distanceKm: 10,
      transportMain: "PKW Benzin",
      alternativeTransport: null,
      alternativeTransportFreq: "Nie",
      flightsPerYear: "2",
      flightDistanceKm: "Kurzstrecke",
      shortHaulTrainAlternative: "Ja",
      heatingType: "Erdgas (Brennwert)",
      warmWaterType: "Strom Ö-Mix",
      usesGreenElectricity: "Nein",
      smartElectricityUsage: "Nie",
      fireworkPerYear: "Nie",
      shoppingTransportEcoChoice: null,
      usesEnergyEfficientAppliances: null,
      usesSmartDevices: null,
      buysRegionalProducts: null,
      buysSustainableClothing: null,
      avoidsOnlineShopping: null,
    },
    factors
  );

  assert.equal(withTrainAlternative.flightKg, noTrainAlternative.flightKg);
});
