const path = require("path");
const xlsx = require("xlsx");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const EMISSION_FILE = path.join(
  "data", "emissionen_nach_typ.xlsx"
);
const SURVEY_FILE = path.join(
  "data",
  "auswertung_umfrage.xlsx"
);

function toText(value) {
  if (value === null || value === undefined) return null;
  return String(value).trim();
}

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
    .replace(/[–—]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeEnum(value) {
  return normalizeText(value).replace(/[.,;:!?()]/g, "").trim();
}

function buildHeaderIndex(rows) {
  const headerIndex = new Map();
  if (!rows.length) return headerIndex;
  Object.keys(rows[0]).forEach((key) => {
    headerIndex.set(normalizeText(key), key);
  });
  return headerIndex;
}

function getCell(row, headerIndex, aliases) {
  for (const alias of aliases) {
    const key = headerIndex.get(normalizeText(alias));
    if (!key) continue;
    const val = row[key];
    if (val !== null && val !== undefined && String(val).trim() !== "") {
      return val;
    }
  }
  return null;
}

function pickByIncludes(text, map) {
  const norm = normalizeEnum(text);
  for (const [needle, result] of map.entries()) {
    if (norm.includes(needle)) return result;
  }
  return null;
}

function findFactor(factors, label) {
  if (!label) return null;
  return factors.find((x) => x.label === label) || null;
}

function findColumnName(headers, aliases) {
  const normalizedHeaders = headers.map((h) => ({ raw: h, norm: normalizeText(h) }));
  for (const alias of aliases) {
    const aliasNorm = normalizeText(alias);
    const hit = normalizedHeaders.find((h) => h.norm === aliasNorm);
    if (hit) return hit.raw;
  }
  return null;
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
  for (const [k, v] of DISTANCE_MAP.entries()) {
    if (norm.includes(k)) return v;
  }
  return 0;
}

function parseAltFreq(text) {
  const norm = normalizeEnum(text);
  for (const [k, v] of ALT_FREQ_MAP.entries()) {
    if (norm.includes(k)) return v;
  }
  return null;
}

function parseFlightsPerYear(text) {
  const norm = normalizeEnum(text).replace(/\s/g, "");
  for (const [k, v] of FLIGHT_COUNT_MAP.entries()) {
    if (norm.includes(k)) return Math.round(v);
  }
  const num = toNumber(text);
  return num === null ? null : Math.round(num);
}

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

function getSheetRows(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return xlsx.utils.sheet_to_json(sheet, { defval: null });
}

async function importEmissionFactors() {
  const workbook = xlsx.readFile(EMISSION_FILE);
  const items = [];

  const configs = [
    {
      sheetName: "Pendelweg",
      category: "transport",
      labelAliases: ["Mobilitätsart (2)", "Mobilitatsart (2)", "MobilitÃ¤tsart (2)"],
      valueAliases: ["Lebenszyklus Emission"],
      unitAliases: ["Einheit"],
      sourceAliases: ["Quelle"],
    },
    {
      sheetName: "Urlaub",
      category: "flight",
      labelAliases: ["Mobilitätsart (2)", "Mobilitatsart (2)", "MobilitÃ¤tsart (2)"],
      valueAliases: ["Lebenszyklus Emission"],
      unitAliases: ["Einheit"],
      sourceAliases: ["Quelle"],
    },
    {
      sheetName: "Wärmeerzeugung",
      category: "heating",
      labelAliases: ["Emissionsquelle / Parameter"],
      valueAliases: ["CO2-Emissionen"],
      unitAliases: ["Einheit"],
      sourceAliases: ["Quelle"],
    },
  ];

  for (const cfg of configs) {
    const rows = getSheetRows(workbook, cfg.sheetName);
    if (!rows.length) continue;
    const headers = Object.keys(rows[0]);
    const labelKey = findColumnName(headers, cfg.labelAliases);
    const valueKey = findColumnName(headers, cfg.valueAliases);
    const unitKey = findColumnName(headers, cfg.unitAliases);
    const sourceKey = findColumnName(headers, cfg.sourceAliases);

    rows.forEach((row) => {
      const label = toText(labelKey ? row[labelKey] : null);
      const valueText = toText(valueKey ? row[valueKey] : null);
      if (!label || !valueText) return;
      items.push({
        category: cfg.category,
        label,
        valueNumber: toNumber(valueText),
        unit: toText(unitKey ? row[unitKey] : null) || "",
      });
    });
  }

  if (!items.length) {
    console.log("Keine Emissionsdaten gefunden.");
    return [];
  }

  await prisma.emissionFactor.deleteMany();
  for (const item of items) {
    await prisma.emissionFactor.create({
      data: {
        category: item.category,
        type: item.label,
        co2PerUnit: item.valueNumber ?? 0,
        unit: item.unit,
      },
    });
  }

  const factors = items.map((x) => ({ label: x.label, valueNumber: x.valueNumber }));
  console.log(`Emissionen importiert: ${items.length}`);
  return factors;
}

async function importSurvey(factors, userId) {
  const workbook = xlsx.readFile(SURVEY_FILE);
  const rows = getSheetRows(workbook, workbook.SheetNames[0]);
  if (!rows.length) {
    console.log("Keine Umfragedaten gefunden.");
    return;
  }

  const headerIndex = buildHeaderIndex(rows);

  await prisma.survey.deleteMany();

  for (const row of rows) {
    const officeDaysText = toText(
      getCell(row, headerIndex, ["Wie oft sind Sie pro Woche im Büro?", "Wie oft sind Sie pro Woche im Buro?"])
    );
    const transportMainText = toText(
      getCell(row, headerIndex, ["Mit welchem Verkehrsmittel kommen Sie in der Regel zur Arbeit?"])
    );
    const alternativeTransportFreqText = toText(
      getCell(row, headerIndex, ["Nutzen Sie auch alternative Verkehrsmittel an manchen Tagen?"])
    );
    const alternativeTransportText = toText(
      getCell(row, headerIndex, ["Wenn ja, welche alternativen Verkehrsmittel?"])
    );
    const distanceText = toText(
      getCell(row, headerIndex, ["Wie weit ist Ihr Arbeitsplatz von zuhause entfernt?"])
    );
    const carTypeText = toText(
      getCell(row, headerIndex, ["Falls Sie ein Auto benutzen: Welchen Antrieb hat Ihr Auto?"])
    );
    const flightsPerYearText = toText(
      getCell(row, headerIndex, ["Wie oft fliegen Sie im Jahr?"])
    );
    const flightDistanceText = toText(
      getCell(row, headerIndex, ["Wenn Sie fliegen, welche Strecken fliegen Sie eher?"])
    );
    const heatingTypeText = toText(getCell(row, headerIndex, ["Wie heizen Sie zu Hause?"]));
    const warmWaterTypeText = toText(
      getCell(row, headerIndex, ["Wie wird Ihr Warmwasser zu Hause erzeugt?"])
    );
    const usesGreenElectricityText = toText(
      getCell(row, headerIndex, ["Nutzen Sie zu Hause Ökostrom", "Nutzen Sie zu Hause Okostrom"])
    );
    const smartElectricityUsageText = toText(
      getCell(row, headerIndex, [
        "Nutzen Sie Strom bewusst zu Zeiten, in denen viel erneuerbare Energie verfügbar ist (z. B. mittags bei PV-Strom)?",
        "Nutzen Sie Strom bewusst zu Zeiten, in denen viel erneuerbare Energie verfugbar ist (z. B. mittags bei PV-Strom)?",
      ])
    );
    const fireworkText = toText(getCell(row, headerIndex, ["Wie oft verwenden Sie Feuerwerk?"]));
    const co2ImportanceText = toText(
      getCell(row, headerIndex, [
        "Wie wichtig ist Ihnen das Thema CO2-Einsparung? (1 sehr wichtig – 6 gar nicht wichtig)",
        "Wie wichtig ist Ihnen das Thema CO2-Einsparung? (1 sehr wichtig - 6 gar nicht wichtig)",
      ])
    );

    const mappedTransport =
      pickByIncludes(transportMainText, TRANSPORT_MAP) ||
      pickByIncludes(carTypeText, CAR_TYPE_MAP) ||
      toText(transportMainText) ||
      "UNKNOWN";

    const mappedHeating =
      pickByIncludes(heatingTypeText, HEATING_MAP) || toText(heatingTypeText) || "UNKNOWN";

    const mappedWarmWater =
      pickByIncludes(warmWaterTypeText, WARM_WATER_MAP) || toText(warmWaterTypeText) || "UNKNOWN";

    const totalCo2Kg = computeSurveyTotal(
      {
        officeDaysText,
        transportMainText,
        alternativeTransportFreqText,
        alternativeTransportText,
        distanceText,
        carTypeText,
        flightsPerYearText,
        flightDistanceText,
        warmWaterTypeText,
      },
      factors
    );

    const flightDistanceLabel = pickByIncludes(flightDistanceText, FLIGHT_DISTANCE_MAP);
    let flightDistanceKm = null;
    if (flightDistanceLabel?.includes("<1500")) flightDistanceKm = 750;
    if (flightDistanceLabel?.includes("1500–3500")) flightDistanceKm = 2500;
    if (flightDistanceLabel?.includes(">3500")) flightDistanceKm = 5000;

    await prisma.survey.create({
      data: {
        userId,
        officeDaysPerWeek: parseOfficeDays(officeDaysText),
        transportMain: mappedTransport,
        alternativeTransportFreq: parseAltFreq(alternativeTransportFreqText),
        alternativeTransport: pickByIncludes(alternativeTransportText, TRANSPORT_MAP),
        distanceKm: parseDistanceKm(distanceText),
        carType: pickByIncludes(carTypeText, CAR_TYPE_MAP),
        flightsPerYear: parseFlightsPerYear(flightsPerYearText),
        flightDistanceKm,
        heatingType: mappedHeating,
        warmWaterType: mappedWarmWater,
        usesGreenElectricity: usesGreenElectricityText || null,
        smartElectricityUsage: parseAltFreq(smartElectricityUsageText),
        fireworkPerYear: toNumber(fireworkText),
        co2Importance: toNumber(co2ImportanceText),
        totalCo2Kg: Number.isFinite(totalCo2Kg) ? totalCo2Kg : null,
      },
    });
  }

  console.log(`Umfrageantworten importiert: ${rows.length}`);
}

async function ensureDefaultUser() {
  const existing = await prisma.user.findFirst();
  if (existing) return existing.id;
  const user = await prisma.user.create({
    data: {
      email: "import@localhost",
      password: "import",
      name: "Import",
    },
  });
  return user.id;
}

// Main entry point when run directly
if (require.main === module) {
  (async () => {
    try {
      console.log("Starte Import von Emissionsfaktoren...");
      const factors = await importEmissionFactors();
      console.log(`✅ ${factors.length} Emissionsfaktoren importiert`);

      console.log("Starte Import von Umfrageantworten...");
      const userId = await ensureDefaultUser();
      await importSurvey(factors, userId);
      console.log("✅ Umfrageantworten importiert");

      process.exit(0);
    } catch (err) {
      console.error("❌ Fehler beim Import:", err);
      process.exit(1);
    }
  })();
}

module.exports = {
  importEmissionFactors,
  importSurvey,
  ensureDefaultUser,
};
