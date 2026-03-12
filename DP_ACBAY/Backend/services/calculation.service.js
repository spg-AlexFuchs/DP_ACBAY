function toNumber(value) {
  if (typeof value === "number") return value;
  if (value === null || value === undefined) return null;
  const text = String(value).replace(",", ".").trim();
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[–—]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeEnum(value) {
  return normalizeText(value).replace(/[.,;:!?()]/g, "").trim();
}

function normalizeUnit(value) {
  return normalizeText(value || "").replace(/co2e?/g, "co2").replace(/\s+/g, " ").trim();
}

function getUnitGroup(unit) {
  const norm = normalizeUnit(unit);
  if (!norm) return "unknown";
  if (norm.includes("t co2") && norm.includes("jahr")) return "annual_tonnes";
  if (norm.includes("kwh") && norm.includes("jahr")) return "annual_energy_kwh";
  if (norm.includes("pro flug") || norm.includes("/flug")) return "emission_g_per_flight";
  if (norm.startsWith("g") && norm.includes("/kwh")) return "emission_g_per_kwh";
  if (norm.startsWith("g") && (norm.includes("/km") || norm.includes("/pkm"))) {
    return "emission_g_per_distance";
  }
  return "other";
}

function unitGroupMatches(actual, expected) {
  if (!expected) return true;
  if (Array.isArray(expected)) return expected.includes(actual);
  return actual === expected;
}

function pickByIncludes(text, map) {
  const norm = normalizeEnum(text);
  for (const [needle, result] of map.entries()) {
    if (norm.includes(needle)) return result;
  }
  return null;
}

function pickAllByIncludes(text, map) {
  const norm = normalizeEnum(text);
  if (!norm) return [];

  const matches = [];
  for (const [needle, result] of map.entries()) {
    if (norm.includes(needle) && !matches.includes(result)) {
      matches.push(result);
    }
  }
  return matches;
}

function getHeatingMatches(text) {
  const norm = normalizeEnum(text);
  const matches = pickAllByIncludes(text, HEATING_MAP);

  // Keep plain "Öl" distinguishable from "Holzofen"; substring matching alone is not enough.
  if (norm === "ol" || norm === "oel") {
    if (!matches.includes("Heizöl extra leicht")) {
      matches.push("Heizöl extra leicht");
    }
  }

  return matches;
}

function pickByIncludesOrWarn(text, map, fieldName) {
  if (text === null || text === undefined || String(text).trim() === "") return null;
  const result = pickByIncludes(text, map);
  if (!result) {
    console.warn(`[CO2] Unmapped answer for ${fieldName}: "${text}"`);
  }
  return result;
}

function findFactor(factors, label) {
  if (!label) return null;
  const normalizedLabel = normalizeText(label);
  return factors.find((x) => normalizeText(x.label) === normalizedLabel) || null;
}

function findFactorsByLabel(factors, label) {
  if (!label) return [];
  const normalizedLabel = normalizeText(label);
  return factors.filter((x) => normalizeText(x.label) === normalizedLabel);
}

function findFirstFactor(factors, labels) {
  for (const label of labels) {
    const factor = findFactor(factors, label);
    if (factor) return factor;
  }
  return null;
}

function categoryAverageFactorValue(factors, category, expectedUnitGroup) {
  const values = factors
    .filter((x) => {
      if (x.category !== category || !Number.isFinite(x.valueNumber)) return false;
      return expectedUnitGroup ? unitGroupMatches(getUnitGroup(x.unit), expectedUnitGroup) : true;
    })
    .map((x) => x.valueNumber);

  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function factorValueByLabelWithFallback(factors, label, category, context, expectedUnitGroup) {
  if (!label) return 0;

  if (normalizeText(label) === normalizeText(PUBLIC_TRANSPORT_AVERAGE_LABEL)) {
    const busCandidates = findFactorsByLabel(factors, "ÖPNV Bus Diesel").filter((x) => Number.isFinite(x.valueNumber));
    const railCandidates = findFactorsByLabel(factors, "ÖPNV Bahn/Tram").filter((x) => Number.isFinite(x.valueNumber));

    const bus = busCandidates.find((x) => unitGroupMatches(getUnitGroup(x.unit), expectedUnitGroup));
    const rail = railCandidates.find((x) => unitGroupMatches(getUnitGroup(x.unit), expectedUnitGroup));

    if (bus && rail) {
      return (bus.valueNumber + rail.valueNumber) / 2;
    }
  }

  const directCandidates = findFactorsByLabel(factors, label).filter((x) => Number.isFinite(x.valueNumber));
  if (directCandidates.length) {
    const compatible = directCandidates.find((x) => unitGroupMatches(getUnitGroup(x.unit), expectedUnitGroup));
    if (compatible) {
      return compatible.valueNumber;
    }

    const candidateGroups = [...new Set(directCandidates.map((x) => getUnitGroup(x.unit)))].join(", ");
    console.warn(
      `[CO2] Unit mismatch for ${context} ("${label}"): expected ${expectedUnitGroup}, got ${candidateGroups}.`
    );
  }

  const fallback = categoryAverageFactorValue(factors, category, expectedUnitGroup);
  if (Number.isFinite(fallback)) {
    console.warn(
      `[CO2] Missing factor for ${context} ("${label}"). Using ${category}/${expectedUnitGroup} average: ${fallback.toFixed(2)}.`
    );
    return fallback;
  }

  console.warn(
    `[CO2] Missing factor for ${context} ("${label}") and no ${category}/${expectedUnitGroup} fallback available.`
  );
  return 0;
}

const DISTANCE_MAP = new Map([
  ["<10", 5],
  ["10-20", 15],
  ["20-30", 25],
  ["30-40", 35],
  ["40-50", 45],
  ["50-60", 55],
  [">60", 80],
]);

const ALT_FREQ_MAP = new Map([
  ["oft", 1 / 3],
  ["selten", 0.1],
  ["manchmal", 1 / 30],
  ["nie", 0],
]);

const FLIGHT_COUNT_MAP = new Map([
  ["0", 0],
  ["1-2", 1.5],
  ["2-5", 3.5],
  ["5-10", 7.5],
]);

const COMMUTE_ROUND_TRIPS_PER_DAY = 2;
const COMMUTE_WEEKS_PER_YEAR = 46;

const FLIGHT_DISTANCE_MAP = new Map([
  ["kurzstrecke", "Flugreisen Kurzstrecke (<1500 km)"],
  ["mittelstrecke", "Flugreisen Mittelstrecke (1500–3500 km)"],
  ["langstrecke", "Flugreisen Langstrecke (>3500 km)"],
]);

const NO_ADJUSTMENT = "__NO_ADJUSTMENT__";
const SOME_APPLIANCES = "__SOME_APPLIANCES__";
const NO_CAR = "__NO_CAR__";
const PUBLIC_TRANSPORT_AVERAGE_LABEL = "ÖPNV Durchschnitt";
const OTHER_HEATING = "__OTHER_HEATING__";
const OTHER_WARM_WATER = "__OTHER_WARM_WATER__";
const APPLIANCES_SOME_SHARE = 0.5;

const TRANSPORT_MAP = new Map([
  ["pkw benzin", "PKW Benzin"],
  ["auto benzin", "PKW Benzin"],
  ["eigenes auto", "Auto"],
  ["pkw diesel", "PKW Diesel"],
  ["auto diesel", "PKW Diesel"],
  ["hybrid", "Hybrid HEV"],
  ["plugin hybrid", "PlugInHybrid PHEV"],
  ["plug in hybrid", "PlugInHybrid PHEV"],
  ["elektro", "Elektroauto BEV EU Strommix"],
  ["eauto", "Elektroauto BEV EU Strommix"],
  ["e auto", "Elektroauto BEV EU Strommix"],
  ["firmenwagen", "Auto"],
  ["bus", "ÖPNV Bus Diesel"],
  ["ubahn", "ÖPNV Bahn/Tram"],
  ["u-bahn", "ÖPNV Bahn/Tram"],
  ["straßenbahn", "ÖPNV Bahn/Tram"],
  ["strassenbahn", "ÖPNV Bahn/Tram"],
  ["badnerbahn", "ÖPNV Bahn/Tram"],
  ["offis", PUBLIC_TRANSPORT_AVERAGE_LABEL],
  ["oeffis", PUBLIC_TRANSPORT_AVERAGE_LABEL],
  ["offentliche verkehrsmittel", PUBLIC_TRANSPORT_AVERAGE_LABEL],
  ["oeffentliche verkehrsmittel", PUBLIC_TRANSPORT_AVERAGE_LABEL],
  ["öffentliche verkehrsmittel", PUBLIC_TRANSPORT_AVERAGE_LABEL],
  ["offentlicheverkehrsmittel", PUBLIC_TRANSPORT_AVERAGE_LABEL],
  ["oeffentlicheverkehrsmittel", PUBLIC_TRANSPORT_AVERAGE_LABEL],
  ["öffentlicheverkehrsmittel", PUBLIC_TRANSPORT_AVERAGE_LABEL],
  ["zug", "ÖPNV Bahn/Tram"],
  ["bahn", "ÖPNV Bahn/Tram"],
  ["tram", "ÖPNV Bahn/Tram"],
  ["fahrrad", "Fahrrad"],
  ["bike", "Fahrrad"],
  ["ebike", "E-Bike/E-Roller"],
  ["e bike", "E-Bike/E-Roller"],
  ["roller", "E-Bike/E-Roller"],
  ["e-roller", "E-Bike/E-Roller"],
  ["e roller", "E-Bike/E-Roller"],
  ["zu fuss", "Zu Fuß"],
  ["gehen", "Zu Fuß"],
  ["sonstig", "Anderes Pendelfahrzeug"],
  ["auto", "Auto"],
]);

const CAR_TYPE_MAP = new Map([
  ["benzin", "PKW Benzin"],
  ["diesel", "PKW Diesel"],
  ["hybrid", "Hybrid HEV"],
  ["plugin hybrid", "PlugInHybrid PHEV"],
  ["plug in hybrid", "PlugInHybrid PHEV"],
  ["elektro", "Elektroauto BEV EU Strommix"],
  ["flussiggas", "Flüssiggas LPG"],
  ["fluessiggas", "Flüssiggas LPG"],
  ["gas", "Gas CNG"],
  ["wasserstoff", "Wasserstoff FCEV"],
  ["ich benutze kein auto", NO_CAR],
  ["benutze kein auto", NO_CAR],
  ["kein auto", NO_CAR],
]);

const HEATING_MAP = new Map([
  ["erdgas", "Erdgas (Brennwert)"],
  ["gas", "Erdgas (Brennwert)"],
  ["heizol", "Heizöl extra leicht"],
  ["heizoel", "Heizöl extra leicht"],
  ["olheizung", "Heizöl extra leicht"],
  ["oel", "Heizöl extra leicht"],
  ["pellets", "Biomasse Pellets"],
  ["stuckholz", "Biomasse Stückholz"],
  ["holz", "Biomasse Stückholz"],
  ["fernwarme", "Fernwärme Ø Österreich"],
  ["warmepumpe", "Wärmepumpe (EU-Strommix, JAZ 3)"],
  ["solar", "Solarthermie"],
  ["okostrom", "Ökostrom"],
  ["strom", "Strom Ö-Mix"],
  ["sonstig", OTHER_HEATING],
]);

const WARM_WATER_MAP = new Map([
  ["gas", "Erdgas (Brennwert)"],
  ["erdgas", "Erdgas (Brennwert)"],
  ["strom", "Strom Ö-Mix"],
  ["warmepumpe", "Wärmepumpe (EU-Strommix, JAZ 3)"],
  ["solar", "Solarthermie"],
  ["pellets", "Biomasse Pellets"],
  ["fernwarme", "Fernwärme Ø Österreich"],
  ["sonstig", OTHER_WARM_WATER],
]);

const ELECTRICITY_TYPE_MAP = new Map([
  ["okostrom", "Ökostrom"],
  ["ja", "Ökostrom"],
  ["yes", "Ökostrom"],
  ["teilweise", "PARTLY_GREEN"],
  ["teils", "PARTLY_GREEN"],
  ["partly", "PARTLY_GREEN"],
  ["strommix", "Strom Ö-Mix"],
  ["strom o-mix", "Strom Ö-Mix"],
  ["strom o mix", "Strom Ö-Mix"],
  ["nein", "Strom Ö-Mix"],
  ["no", "Strom Ö-Mix"],
  ["weiss nicht", "PARTLY_GREEN"],
  ["weis nicht", "PARTLY_GREEN"],
]);

const HEATING_ENERGY_LABELS = [
  "Energieverbrauch durchschnitt österreich/person heizen",
  "Energiebedarf Heizen",
  "Energieverbrauch Heizen",
  "Energieverbauch durschnitt österreich/person heizen",
];

const ELECTRICITY_ENERGY_LABELS = [
  "Energiebedarf Strom",
  "Stromverbrauch österreich/person",
];

const CONSUMPTION_BASE_LABELS = [
  ["Ernährung Durchschnittswert"],
  ["Konsumgüter Durchschnittswert", "Konsumgüter Durschnittswert"],
  ["Alltagsmobilität (ohne Pendeln) Durchschnittswert"],
];

const CONSUMPTION_CLOTHING_MAP = new Map([
  ["ja", "Nachhaltige Kleidung immer"],
  ["immer", "Nachhaltige Kleidung immer"],
  ["mittel", "Nachhaltige Kleidung manchmal"],
  ["manchmal", "Nachhaltige Kleidung manchmal"],
  ["nein", NO_ADJUSTMENT],
  ["no", NO_ADJUSTMENT],
]);

const CONSUMPTION_REGIONAL_MAP = new Map([
  ["ja", "Regionaler Einkauf oft"],
  ["oft", "Regionaler Einkauf oft"],
  ["mittel", "Regionaler Einkauf manchmal"],
  ["manchmal", "Regionaler Einkauf manchmal"],
  ["nein", NO_ADJUSTMENT],
  ["no", NO_ADJUSTMENT],
]);

const CONSUMPTION_ONLINE_MAP = new Map([
  ["ja", "Verzicht auf Onlinekauf oft"],
  ["oft", "Verzicht auf Onlinekauf oft"],
  ["mittel", "Verzicht auf Onlinekauf manchmal"],
  ["manchmal", "Verzicht auf Onlinekauf manchmal"],
  ["nein", NO_ADJUSTMENT],
  ["no", NO_ADJUSTMENT],
]);

const CONSUMPTION_SHOPPING_TRANSPORT_MAP = new Map([
  ["ja", "Umweltfreundlicher Transport beim Einkauf Ja"],
  ["mittel", "Umweltfreundlicher Transport beim Einkauf Manchmal"],
  ["manchmal", "Umweltfreundlicher Transport beim Einkauf Manchmal"],
  ["nein", NO_ADJUSTMENT],
  ["no", NO_ADJUSTMENT],
]);

const CONSUMPTION_APPLIANCES_MAP = new Map([
  ["ja, alle", "Energiesparende Geräte – alle (Herstellung)"],
  ["ja alle", "Energiesparende Geräte – alle (Herstellung)"],
  ["einige", SOME_APPLIANCES],
  ["teilweise", SOME_APPLIANCES],
  ["nein", NO_ADJUSTMENT],
  ["no", NO_ADJUSTMENT],
]);

const CONSUMPTION_SMART_DEVICES_MAP = new Map([
  ["ja", "Smarte Geräte – Ja (Herstellung)"],
  ["nein", NO_ADJUSTMENT],
  ["no", NO_ADJUSTMENT],
  ["weiss nicht", NO_ADJUSTMENT],
  ["weis nicht", NO_ADJUSTMENT],
]);

function parseOfficeDays(text) {
  const norm = normalizeEnum(text);
  const firstDigit = norm.match(/\d+/);
  if (firstDigit) {
    const n = Number(firstDigit[0]);
    if (Number.isFinite(n) && n >= 0 && n <= 7) return n;
  }
  return 0;
}

function parseDistanceKm(text) {
  const norm = normalizeEnum(text).replace(/\s/g, "");
  if (norm.includes("unter10")) return 5;
  for (const [k, v] of DISTANCE_MAP.entries()) {
    if (norm.includes(k)) return v;
  }
  if (norm.includes("uber60") || norm.includes("ueber60") || norm.includes("mehrals60")) return 80;
  return 0;
}

function parseAltFreq(text) {
  const norm = normalizeEnum(text);
  for (const [k, v] of ALT_FREQ_MAP.entries()) {
    if (norm.includes(k)) return v;
  }
  return null;
}

function parseFlightsPerYear(text, options = {}) {
  const { forStorage = false } = options;
  const norm = normalizeEnum(text).replace(/\s/g, "");
  if (norm.includes("nie")) return 0;
  // Exact match first to avoid "0" substring-matching inside "5-10" etc.
  if (FLIGHT_COUNT_MAP.has(norm)) {
    const v = FLIGHT_COUNT_MAP.get(norm);
    return forStorage ? Math.round(v) : v;
  }
  for (const [k, v] of FLIGHT_COUNT_MAP.entries()) {
    if (norm.includes(k)) return forStorage ? Math.round(v) : v;
  }
  const num = toNumber(text);
  if (num === null) return null;
  return forStorage ? Math.round(num) : num;
}

function parseFireworkAdjustmentLabel(text) {
  const norm = normalizeEnum(text);
  if (!norm || norm.includes("nie")) return null;
  if (norm.includes("1/jahr") || norm.includes("1x/jahr") || norm.includes("1 mal")) {
    return "Feuerwerk 1/Jahr";
  }

  const digitMatch = norm.match(/\d+/);
  if (digitMatch) {
    const n = Number(digitMatch[0]);
    if (Number.isFinite(n)) {
      if (n > 1) return "Feuerwerk >1/Jahr";
      if (n === 1) return "Feuerwerk 1/Jahr";
    }
  }

  if (norm.includes("mehrmals") || norm.includes("oft")) return "Feuerwerk >1/Jahr";
  if (norm.includes("selten") || norm.includes("manchmal")) return "Feuerwerk 1/Jahr";
  return null;
}

function resolveMainTransportLabel(transportMainText, carTypeText) {
  const main = pickByIncludesOrWarn(transportMainText, TRANSPORT_MAP, "transportMain");
  const carRaw = pickByIncludes(carTypeText, CAR_TYPE_MAP);
  const car = carRaw === NO_CAR ? null : carRaw;
  const mainNorm = normalizeEnum(transportMainText || "");
  const mainIsGenericCar =
    mainNorm.includes("eigenes auto") ||
    mainNorm === "auto" ||
    mainNorm.includes("firmenwagen") ||
    mainNorm.includes("pkw");

  if (carRaw === NO_CAR && mainIsGenericCar) return null;
  if (mainIsGenericCar && car) return car;
  return main || car;
}

function resolveCarTypeLabel(carTypeText) {
  const raw = pickByIncludes(carTypeText, CAR_TYPE_MAP);
  if (raw === NO_CAR) return null;
  if (!raw && carTypeText !== null && carTypeText !== undefined && String(carTypeText).trim() !== "") {
    console.warn(`[CO2] Unmapped answer for carType: "${carTypeText}"`);
  }
  return raw;
}

function mapTransport(text) {
  return pickByIncludes(text, TRANSPORT_MAP);
}

function mapHeatingType(text) {
  const [mapped] = getHeatingMatches(text);
  return mapped === OTHER_HEATING ? null : mapped;
}

function mapHeatingTypes(text) {
  const mapped = getHeatingMatches(text).filter((x) => x !== OTHER_HEATING);
  return mapped;
}

function mapWarmWaterType(text) {
  const mapped = pickByIncludes(text, WARM_WATER_MAP);
  return mapped === OTHER_WARM_WATER ? null : mapped;
}

function mapWarmWaterTypes(text) {
  const mapped = pickAllByIncludes(text, WARM_WATER_MAP).filter((x) => x !== OTHER_WARM_WATER);
  return mapped;
}

function parseFlightDistanceKm(text) {
  const flightDistanceLabel = pickByIncludes(text, FLIGHT_DISTANCE_MAP);
  if (flightDistanceLabel?.includes("<1500")) return 750;
  if (flightDistanceLabel?.includes("1500–3500")) return 2500;
  if (flightDistanceLabel?.includes(">3500")) return 5000;

  const numericDistance = toNumber(text);
  if (Number.isFinite(numericDistance) && numericDistance > 0) return numericDistance;

  const norm = normalizeEnum(text).replace(/\s/g, "");
  const rangeMatch = norm.match(/(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)/);
  if (rangeMatch) {
    const from = Number(rangeMatch[1].replace(",", "."));
    const to = Number(rangeMatch[2].replace(",", "."));
    if (Number.isFinite(from) && Number.isFinite(to) && from > 0 && to > 0) {
      return (from + to) / 2;
    }
  }

  return null;
}

function labelFromFlightDistanceKm(distanceKm) {
  if (!Number.isFinite(distanceKm)) return null;
  if (distanceKm < 1500) return "Flugreisen Kurzstrecke (<1500 km)";
  if (distanceKm <= 3500) return "Flugreisen Mittelstrecke (1500–3500 km)";
  return "Flugreisen Langstrecke (>3500 km)";
}

function factorValueByLabel(factors, label, category, context, expectedUnitGroup) {
  return factorValueByLabelWithFallback(factors, label, category, context, expectedUnitGroup);
}

function applianceAdjustmentTons(factors, appliancesLabel) {
  if (!appliancesLabel || appliancesLabel === NO_ADJUSTMENT) return 0;
  if (appliancesLabel === SOME_APPLIANCES) {
    const allDevicesTons = factorValueByLabel(
      factors,
      "Energiesparende Geräte – alle (Herstellung)",
      "consumption",
      "consumption.appliances.all",
      "annual_tonnes"
    );
    return allDevicesTons * APPLIANCES_SOME_SHARE;
  }
  return factorValueByLabel(
    factors,
    appliancesLabel,
    "consumption",
    "consumption.appliances",
    "annual_tonnes"
  );
}

function optionalConsumptionAdjustmentTons(factors, label, context) {
  if (!label || label === NO_ADJUSTMENT) return 0;
  return factorValueByLabel(factors, label, "consumption", context, "annual_tonnes");
}

function computeConsumptionKg(input, factors) {
  const baseTons = CONSUMPTION_BASE_LABELS.reduce((sum, aliases) => {
    const factor = findFirstFactor(factors, aliases);
    const contextLabel = aliases[0] || "unknown";
    if (factor) {
      const unitGroup = getUnitGroup(factor.unit);
      if (unitGroupMatches(unitGroup, "annual_tonnes") && Number.isFinite(factor.valueNumber)) {
        return sum + Number(factor.valueNumber);
      }
    }
    return sum + factorValueByLabel(
      factors,
      aliases[0],
      "consumption",
      `consumption.base.${contextLabel}`,
      "annual_tonnes"
    );
  }, 0);

  const clothingLabel = pickByIncludesOrWarn(
    input.sustainableClothingText,
    CONSUMPTION_CLOTHING_MAP,
    "sustainableClothing"
  );
  const regionalLabel = pickByIncludesOrWarn(
    input.regionalProductsText,
    CONSUMPTION_REGIONAL_MAP,
    "regionalProducts"
  );
  const onlineLabel = pickByIncludesOrWarn(
    input.avoidsOnlineShoppingText,
    CONSUMPTION_ONLINE_MAP,
    "avoidsOnlineShopping"
  );
  const shoppingTransportLabel = pickByIncludesOrWarn(
    input.shoppingTransportEcoChoiceText,
    CONSUMPTION_SHOPPING_TRANSPORT_MAP,
    "shoppingTransportEcoChoice"
  );
  const appliancesLabel = pickByIncludesOrWarn(
    input.usesEnergyEfficientAppliancesText,
    CONSUMPTION_APPLIANCES_MAP,
    "usesEnergyEfficientAppliances"
  );
  const smartDevicesLabel = pickByIncludesOrWarn(
    input.usesSmartDevicesText,
    CONSUMPTION_SMART_DEVICES_MAP,
    "usesSmartDevices"
  );
  const fireworkLabel = parseFireworkAdjustmentLabel(input.fireworkText);

  const adjustmentTons =
    optionalConsumptionAdjustmentTons(factors, clothingLabel, "consumption.clothing") +
    optionalConsumptionAdjustmentTons(factors, regionalLabel, "consumption.regional") +
    optionalConsumptionAdjustmentTons(factors, onlineLabel, "consumption.online") +
    optionalConsumptionAdjustmentTons(factors, shoppingTransportLabel, "consumption.shoppingTransport") +
    applianceAdjustmentTons(factors, appliancesLabel) +
    optionalConsumptionAdjustmentTons(factors, smartDevicesLabel, "consumption.smartDevices") +
    factorValueByLabel(factors, fireworkLabel, "consumption", "consumption.firework", "annual_tonnes");

  return (baseTons + adjustmentTons) * 1000;
}

function computeSurveyTotal(input, factors) {
  const officeDays = parseOfficeDays(input.officeDaysText);
  const distanceKm = parseDistanceKm(input.distanceText);
  const mainTransport = resolveMainTransportLabel(input.transportMainText, input.carTypeText);
  const altTransportRaw =
    pickByIncludesOrWarn(input.alternativeTransportText, TRANSPORT_MAP, "alternativeTransport") ||
    (input.alternativeTransportText ? "Anderes Pendelfahrzeug" : null);
  // "Auto" is a generic placeholder with no specific emission factor; use mainTransport instead
  const altTransport = altTransportRaw === "Auto" ? mainTransport : altTransportRaw;
  const altFreq = parseAltFreq(input.alternativeTransportFreqText) ?? 0;

  const commuteKg = computeCommuteKgFromValues(
    {
      officeDays,
      distanceKm,
      mainTransport,
      altTransport,
      altFreq,
    },
    factors
  );

  let flightKg = 0;
  const flightsPerYear = parseFlightsPerYear(input.flightsPerYearText);
  const directFlightLabel = pickByIncludes(input.flightDistanceText, FLIGHT_DISTANCE_MAP);
  const parsedFlightDistanceKm = parseFlightDistanceKm(input.flightDistanceText);
  const flightLabel = directFlightLabel || labelFromFlightDistanceKm(parsedFlightDistanceKm);
  if (!flightLabel && input.flightDistanceText !== null && input.flightDistanceText !== undefined && String(input.flightDistanceText).trim() !== "") {
    console.warn(`[CO2] Unmapped answer for flightDistance: "${input.flightDistanceText}"`);
  }
  if (flightsPerYear !== null && flightLabel) {
    const factorValue = factorValueByLabelWithFallback(
      factors,
      flightLabel,
      "flight",
      "flight.distance",
      ["emission_g_per_distance", "emission_g_per_flight"]
    );
    flightKg = (factorValue * flightsPerYear) / 1000;

  }

  let warmWaterKg = 0;
  const warmWaterTypes = mapWarmWaterTypes(input.warmWaterTypeText);
  const warmWaterHasInput = input.warmWaterTypeText !== null && input.warmWaterTypeText !== undefined && String(input.warmWaterTypeText).trim() !== "";
  if (warmWaterTypes.length || warmWaterHasInput) {
    const energyValue = factorValueByLabelWithFallback(
      factors,
      "Energiebedarf Warmwasser",
      "heating",
      "warmWater.energy",
      "annual_energy_kwh"
    );

    if (warmWaterTypes.length) {
      const energySharePerType = energyValue / warmWaterTypes.length;
      warmWaterKg = warmWaterTypes.reduce((sum, warmWaterType) => {
        const factorValue = factorValueByLabelWithFallback(
          factors,
          warmWaterType,
          "heating",
          "warmWater.type",
          "emission_g_per_kwh"
        );
        return sum + (energySharePerType * factorValue) / 1000;
      }, 0);
    } else {
      const fallbackValue = categoryAverageFactorValue(factors, "heating", "emission_g_per_kwh") ?? 0;
      warmWaterKg = (energyValue * fallbackValue) / 1000;
    }
  }

  let heatingKg = 0;
  const heatingTypes = getHeatingMatches(input.heatingTypeText);
  if (heatingTypes.length) {
    const energy = findFirstFactor(factors, HEATING_ENERGY_LABELS);
    const energyValue = factorValueByLabelWithFallback(
      factors,
      energy?.label || "Energiebedarf Heizen",
      "heating",
      "heating.energy",
      "annual_energy_kwh"
    );

    const energySharePerType = heatingTypes.length ? energyValue / heatingTypes.length : 0;
    heatingKg = heatingTypes.reduce((sum, heatingType) => {
      const factorValue = heatingType === OTHER_HEATING
        ? categoryAverageFactorValue(factors, "heating", "emission_g_per_kwh") ?? 0
        : factorValueByLabelWithFallback(
          factors,
          heatingType,
          "heating",
          "heating.type",
          "emission_g_per_kwh"
        );
      return sum + (energySharePerType * factorValue) / 1000;
    }, 0);

  }

  let electricityKg = 0;
  const electricityType = pickByIncludesOrWarn(input.usesGreenElectricityText, ELECTRICITY_TYPE_MAP, "usesGreenElectricity");
  if (electricityType) {
    const energy = findFirstFactor(factors, ELECTRICITY_ENERGY_LABELS);
    let factorValue;
    if (electricityType === "PARTLY_GREEN") {
      const green = factorValueByLabelWithFallback(
        factors,
        "Ökostrom",
        "heating",
        "electricity.partly.green",
        "emission_g_per_kwh"
      );
      const mix = factorValueByLabelWithFallback(
        factors,
        "Strom Ö-Mix",
        "heating",
        "electricity.partly.mix",
        "emission_g_per_kwh"
      );
      factorValue = (green + mix) / 2;
    } else {
      factorValue = factorValueByLabelWithFallback(
        factors,
        electricityType,
        "heating",
        "electricity.type",
        "emission_g_per_kwh"
      );
    }
    const energyValue = factorValueByLabelWithFallback(
      factors,
      energy?.label || "Energiebedarf Strom",
      "heating",
      "electricity.energy",
      "annual_energy_kwh"
    );
    electricityKg = (energyValue * factorValue) / 1000;
  }

  const consumptionKg = computeConsumptionKg(
    {
      sustainableClothingText: input.sustainableClothingText,
      regionalProductsText: input.regionalProductsText,
      avoidsOnlineShoppingText: input.avoidsOnlineShoppingText,
      shoppingTransportEcoChoiceText: input.shoppingTransportEcoChoiceText,
      usesEnergyEfficientAppliancesText: input.usesEnergyEfficientAppliancesText,
      usesSmartDevicesText: input.usesSmartDevicesText,
      fireworkText: input.fireworkText,
    },
    factors
  );

  return commuteKg + flightKg + warmWaterKg + heatingKg + electricityKg + consumptionKg;
}

function computeCommuteKgFromValues(input, factors) {
  const officeDays = Number(input.officeDays || 0);
  const distanceKm = Number(input.distanceKm || 0);
  const mainTransport = input.mainTransport || null;
  const altTransport = input.altTransport || null;
  const altFreqRaw = Number(input.altFreq || 0);
  const altFreq = Math.min(Math.max(Number.isFinite(altFreqRaw) ? altFreqRaw : 0, 0), 1);

  if (!officeDays || !distanceKm || !mainTransport) return 0;

  const mainValue = factorValueByLabelWithFallback(
    factors,
    mainTransport,
    "transport",
    "commute.mainTransport",
    "emission_g_per_distance"
  );
  const altValue = factorValueByLabelWithFallback(
    factors,
    altTransport,
    "transport",
    "commute.alternativeTransport",
    "emission_g_per_distance"
  );

  const commuteG =
    officeDays *
    COMMUTE_WEEKS_PER_YEAR *
    COMMUTE_ROUND_TRIPS_PER_DAY *
    distanceKm *
    (mainValue * (1 - altFreq) + altValue * altFreq);

  return commuteG / 1000;
}

function computeCommuteKgFromSurveyRecord(survey, factors) {
  // Resolve mainTransport using carType if it's a car
  const mainTransport = resolveMainTransportLabel(survey.transportMain, survey.carType);
  const altTransportRaw = mapTransport(survey.alternativeTransport) || survey.alternativeTransport;
  // "Auto" is a generic placeholder with no specific emission factor; use mainTransport instead
  const altTransport = altTransportRaw === "Auto" ? mainTransport : altTransportRaw;
  const altFreq = parseAltFreq(survey.alternativeTransportFreq) ?? Number(survey.alternativeTransportFreq ?? 0);

  return computeCommuteKgFromValues(
    {
      officeDays: survey.officeDaysPerWeek,
      distanceKm: survey.distanceKm,
      mainTransport,
      altTransport,
      altFreq,
    },
    factors
  );
}

function computeSurveyComponentKgFromRecord(survey, factors) {

  const commuteKg = computeCommuteKgFromSurveyRecord(survey, factors);

  let flightKg = 0;
  const parsedFlightsPerYear = parseFlightsPerYear(survey.flightsPerYear);
  if (Number.isFinite(parsedFlightsPerYear) && parsedFlightsPerYear > 0) {
    const parsedDistance = parseFlightDistanceKm(survey.flightDistanceKm);
    const flightLabel = labelFromFlightDistanceKm(Number(parsedDistance));
    if (flightLabel) {
      const factorValue = factorValueByLabelWithFallback(
        factors,
        flightLabel,
        "flight",
        "flight.distance.record",
        ["emission_g_per_distance", "emission_g_per_flight"]
      );
      flightKg = (factorValue * Number(parsedFlightsPerYear)) / 1000;

    }
  }

  const mappedHeatingTypes = mapHeatingTypes(survey.heatingType);
  const heatingTypes = mappedHeatingTypes.length
    ? mappedHeatingTypes
    : [mapHeatingType(survey.heatingType) || "UNKNOWN"];

  let heatingKg = 0;
  if (heatingTypes.length) {
    const energy = findFirstFactor(factors, HEATING_ENERGY_LABELS);
    const energyValue = factorValueByLabelWithFallback(
      factors,
      energy?.label || "Energiebedarf Heizen",
      "heating",
      "heating.energy.record",
      "annual_energy_kwh"
    );

    const energySharePerType = energyValue / heatingTypes.length;
    heatingKg = heatingTypes.reduce((sum, heatingType) => {
      const isUnknown = heatingType === "UNKNOWN" || heatingType === "Sonstiges";
      const factorValue = isUnknown
        ? categoryAverageFactorValue(factors, "heating", "emission_g_per_kwh") ?? 0
        : factorValueByLabelWithFallback(
          factors,
          heatingType,
          "heating",
          "heating.type.record",
          "emission_g_per_kwh"
        );
      return sum + (energySharePerType * factorValue) / 1000;
    }, 0);
  }

  let warmWaterKg = 0;
  const warmWaterTypes = mapWarmWaterTypes(survey.warmWaterType);
  const warmWaterHasInput = survey.warmWaterType !== null && survey.warmWaterType !== undefined && String(survey.warmWaterType).trim() !== "";
  if (warmWaterTypes.length || warmWaterHasInput) {
    const energyValue = factorValueByLabelWithFallback(
      factors,
      "Energiebedarf Warmwasser",
      "heating",
      "warmWater.energy.record",
      "annual_energy_kwh"
    );

    if (warmWaterTypes.length) {
      const energySharePerType = energyValue / warmWaterTypes.length;
      warmWaterKg = warmWaterTypes.reduce((sum, warmWaterType) => {
        const factorValue = factorValueByLabelWithFallback(
          factors,
          warmWaterType,
          "heating",
          "warmWater.type.record",
          "emission_g_per_kwh"
        );
        return sum + (energySharePerType * factorValue) / 1000;
      }, 0);
    } else {
      const fallbackValue = categoryAverageFactorValue(factors, "heating", "emission_g_per_kwh") ?? 0;
      warmWaterKg = (energyValue * fallbackValue) / 1000;
    }
  }

  let electricityKg = 0;
  const electricityType = pickByIncludes(survey.usesGreenElectricity, ELECTRICITY_TYPE_MAP);
  if (electricityType) {
    const energy = findFirstFactor(factors, ELECTRICITY_ENERGY_LABELS);
    let factorValue;
    if (electricityType === "PARTLY_GREEN") {
      const green = factorValueByLabelWithFallback(
        factors,
        "Ökostrom",
        "heating",
        "electricity.partly.green.record",
        "emission_g_per_kwh"
      );
      const mix = factorValueByLabelWithFallback(
        factors,
        "Strom Ö-Mix",
        "heating",
        "electricity.partly.mix.record",
        "emission_g_per_kwh"
      );
      factorValue = (green + mix) / 2;
    } else {
      factorValue = factorValueByLabelWithFallback(
        factors,
        electricityType,
        "heating",
        "electricity.type.record",
        "emission_g_per_kwh"
      );
    }

    const energyValue = factorValueByLabelWithFallback(
      factors,
      energy?.label || "Energiebedarf Strom",
      "heating",
      "electricity.energy.record",
      "annual_energy_kwh"
    );

    electricityKg = (energyValue * factorValue) / 1000;
  }

  const consumptionKg = computeConsumptionKg(
    {
      sustainableClothingText: survey.buysSustainableClothing,
      regionalProductsText: survey.buysRegionalProducts,
      avoidsOnlineShoppingText: survey.avoidsOnlineShopping,
      shoppingTransportEcoChoiceText: survey.shoppingTransportEcoChoice,
      usesEnergyEfficientAppliancesText: survey.usesEnergyEfficientAppliances,
      usesSmartDevicesText: survey.usesSmartDevices,
      fireworkText: survey.fireworkPerYear,
    },
    factors
  );

  return {
    commuteKg,
    flightKg,
    heatingKg,
    warmWaterKg,
    electricityKg,
    consumptionKg,
  };
}

module.exports = {
  computeSurveyTotal,
  computeCommuteKgFromSurveyRecord,
  computeSurveyComponentKgFromRecord,
  resolveMainTransportLabel,
  resolveCarTypeLabel,
  mapTransport,
  mapHeatingType,
  mapHeatingTypes,
  mapWarmWaterType,
  mapWarmWaterTypes,
  parseFlightDistanceKm,
  parseOfficeDays,
  parseAltFreq,
  parseDistanceKm,
  parseFlightsPerYear,
};
