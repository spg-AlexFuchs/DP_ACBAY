/**
 * Calculation Service - CO2 Footprint Calculations
 */

function normalizeEnum(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?()]/g, "")
    .trim();
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
  ["1-2", 1.9],
  ["2-5", 3.2],
  ["5-10", 7],
]);

const FLIGHT_DISTANCE_MAP = new Map([
  ["kurzstrecke", "Flugreisen Kurzstrecke (<1500 km)"],
  ["mittelstrecke", "Flugreisen Mittelstrecke (1500–3500 km)"],
  ["langstrecke", "Flugreisen Langstrecke (>3500 km)"],
]);

const TRANSPORT_MAP = new Map([
  ["pkw benzin", "PKW Benzin"],
  ["auto benzin", "PKW Benzin"],
  ["pkw diesel", "PKW Diesel"],
  ["auto diesel", "PKW Diesel"],
  ["hybrid", "Hybrid HEV"],
  ["plugin hybrid", "PlugInHybrid PHEV"],
  ["plug in hybrid", "PlugInHybrid PHEV"],
  ["elektro", "Elektroauto BEV EU Strommix"],
  ["eauto", "Elektroauto BEV EU Strommix"],
  ["e auto", "Elektroauto BEV EU Strommix"],
  ["firmenwagen", "PKW Benzin"],
  ["bus", "ÖPNV Bus Diesel"],
  ["offis", "ÖPNV Bahn/Tram"],
  ["oeffis", "ÖPNV Bahn/Tram"],
  ["zug", "ÖPNV Bahn/Tram"],
  ["bahn", "ÖPNV Bahn/Tram"],
  ["tram", "ÖPNV Bahn/Tram"],
  ["fahrrad", "Fahrrad"],
  ["bike", "Fahrrad"],
  ["ebike", "E-Bike/E-Roller"],
  ["e bike", "E-Bike/E-Roller"],
  ["roller", "E-Bike/E-Roller"],
  ["zu fuss", "Zu Fuß"],
  ["gehen", "Zu Fuß"],
]);

const CAR_TYPE_MAP = new Map([
  ["benzin", "PKW Benzin"],
  ["diesel", "PKW Diesel"],
  ["hybrid", "Hybrid HEV"],
  ["plugin hybrid", "PlugInHybrid PHEV"],
  ["plug in hybrid", "PlugInHybrid PHEV"],
  ["elektro", "Elektroauto BEV EU Strommix"],
]);

const HEATING_MAP = new Map([
  ["erdgas", "Erdgas (Brennwert)"],
  ["gas", "Erdgas (Brennwert)"],
  ["heizol", "Heizöl extra leicht"],
  ["ol", "Heizöl extra leicht"],
  ["pellets", "Biomasse Pellets"],
  ["stuckholz", "Biomasse Stückholz"],
  ["holz", "Biomasse Stückholz"],
  ["fernwarme", "Fernwärme Ø Österreich"],
  ["warmepumpe", "Wärmepumpe (EU-Strommix, JAZ 3)"],
  ["solar", "Solarthermie"],
  ["okostrom", "Ökostrom"],
  ["strom", "Strom Ö-Mix"],
]);

const WARM_WATER_MAP = new Map([
  ["gas", "Erdgas (Brennwert)"],
  ["erdgas", "Erdgas (Brennwert)"],
  ["ol", "Heizöl extra leicht"],
  ["heizol", "Heizöl extra leicht"],
  ["strom", "Strom Ö-Mix"],
  ["warmepumpe", "Wärmepumpe (EU-Strommix, JAZ 3)"],
  ["solar", "Solarthermie"],
]);

/**
 * Parse office days from text
 */
function parseOfficeDays(text) {
  const norm = normalizeEnum(text);
  const firstDigit = norm.match(/\d+/);
  if (firstDigit) {
    const n = Number(firstDigit[0]);
    if (Number.isFinite(n) && n >= 0 && n <= 7) return n;
  }
  return 0;
}

/**
 * Parse distance range to km
 */
function parseDistanceKm(text) {
  const norm = normalizeEnum(text).replace(/\s/g, "");
  for (const [k, v] of DISTANCE_MAP.entries()) {
    if (norm.includes(k)) return v;
  }
  return 0;
}

/**
 * Parse alternative transport frequency
 */
function parseAltFreq(text) {
  const norm = normalizeEnum(text);
  for (const [k, v] of ALT_FREQ_MAP.entries()) {
    if (norm.includes(k)) return v;
  }
  return null;
}

/**
 * Parse flights per year
 */
function parseFlightsPerYear(text) {
  const norm = normalizeEnum(text).replace(/\s/g, "");
  for (const [k, v] of FLIGHT_COUNT_MAP.entries()) {
    if (norm.includes(k)) return Math.round(v);
  }
  const num = toNumber(text);
  return num === null ? null : Math.round(num);
}

/**
 * Find factor from list by label
 */
function findFactor(factors, label) {
  if (!label) return null;
  return factors.find((x) => x.label === label) || null;
}

/**
 * Pick value from map by includes matching
 */
function pickByIncludes(text, map) {
  const norm = normalizeEnum(text);
  for (const [needle, result] of map.entries()) {
    if (norm.includes(needle)) return result;
  }
  return null;
}

/**
 * Convert text to number
 */
function toNumber(value) {
  if (typeof value === "number") return value;
  if (value === null || value === undefined) return null;
  const text = String(value).replace(",", ".").trim();
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Compute total CO2 for a survey
 */
function computeSurveyTotal(input, factors) {
  const officeDays = parseOfficeDays(input.officeDaysText);
  const distanceKm = parseDistanceKm(input.distanceText);
  const mainTransport =
    pickByIncludes(input.transportMainText, TRANSPORT_MAP) ||
    pickByIncludes(input.carTypeText, CAR_TYPE_MAP);
  const altTransport = pickByIncludes(input.alternativeTransportText, TRANSPORT_MAP);
  const altFreq = parseAltFreq(input.alternativeTransportFreqText) ?? 0;

  let commuteKg = 0;
  if (officeDays && distanceKm && mainTransport) {
    const mainFactor = findFactor(factors, mainTransport);
    const altFactor = findFactor(factors, altTransport);
    const mainValue = mainFactor?.valueNumber || 0;
    const altValue = altFactor?.valueNumber || 0;
    const commuteG = officeDays * distanceKm * (mainValue * (1 - altFreq) + altValue * altFreq);
    commuteKg = commuteG / 1000;
  }

  let flightKg = 0;
  const flightsPerYear = parseFlightsPerYear(input.flightsPerYearText);
  const flightLabel = pickByIncludes(input.flightDistanceText, FLIGHT_DISTANCE_MAP);
  if (flightsPerYear !== null && flightLabel) {
    const factor = findFactor(factors, flightLabel);
    flightKg = ((factor?.valueNumber || 0) * flightsPerYear) / 1000;
  }

  let warmWaterKg = 0;
  const warmWaterType = pickByIncludes(input.warmWaterTypeText, WARM_WATER_MAP);
  if (warmWaterType) {
    const energy = findFactor(factors, "Energiebedarf Warmwasser");
    const factor = findFactor(factors, warmWaterType);
    if (energy && factor) {
      warmWaterKg = ((energy.valueNumber || 0) * (factor.valueNumber || 0)) / 1000;
    }
  }

  return commuteKg + flightKg + warmWaterKg;
}

module.exports = {
  parseOfficeDays,
  parseDistanceKm,
  parseAltFreq,
  parseFlightsPerYear,
  findFactor,
  pickByIncludes,
  toNumber,
  computeSurveyTotal,
};