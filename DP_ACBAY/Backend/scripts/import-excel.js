const path = require("path");
const xlsx = require("xlsx");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const EMISSION_FILE = path.join(
  "C:\\Users\\yoav\\SynologyDrive\\SWP_BIE_REH",
  "Emissionen nach Typ.xlsx"
);
const SURVEY_FILE = path.join(
  "C:\\Users\\yoav\\SynologyDrive\\SWP_BIE_REH",
  "Auswertung Umfrage.xlsx"
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

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const distanceMap = new Map([
  ["<10", 5],
  ["10-20", 15],
  ["20-30", 25],
  ["40-50", 45],
  ["50-60", 55],
  [">60", 80],
]);

const officeDaysMap = new Map([
  ["0 tage", 0],
  ["1 tag", 1],
  ["1 tage", 1],
  ["2 tage", 2],
  ["3 tage", 3],
  ["4 tage", 4],
  ["5 tage", 5],
]);

const altFreqMap = new Map([
  ["oft", 1 / 3],
  ["selten", 0.1],
  ["manchmal", 1 / 30],
  ["nie", 0],
]);

const flightCountMap = new Map([
  ["0", 0],
  ["1-2", 1.9],
  ["2-5", 3.2],
  ["5-10", 7],
]);

const flightDistanceMap = new Map([
  ["kurzstrecke", "Flugreisen Kurzstrecke (<1500 km)"],
  ["mittelstrecke", "Flugreisen Mittelstrecke (1500–3500 km)"],
  ["langstrecke", "Flugreisen Langstrecke (>3500 km)"],
]);

const transportMap = new Map([
  ["pkw benzin", "PKW Benzin"],
  ["auto benzin", "PKW Benzin"],
  ["pkw diesel", "PKW Diesel"],
  ["auto diesel", "PKW Diesel"],
  ["hybrid", "Hybrid HEV"],
  ["plug-in hybrid", "PlugInHybrid PHEV"],
  ["plug in hybrid", "PlugInHybrid PHEV"],
  ["elektro", "Elektroauto BEV EU Strommix"],
  ["e-auto", "Elektroauto BEV EU Strommix"],
  ["e auto", "Elektroauto BEV EU Strommix"],
  ["firmenwagen", "PKW Benzin"],
  ["bus", "ÖPNV Bus Diesel"],
  ["öffis", "ÖPNV Bahn/Tram"],
  ["oeffis", "ÖPNV Bahn/Tram"],
  ["zug", "ÖPNV Bahn/Tram"],
  ["bahn", "ÖPNV Bahn/Tram"],
  ["tram", "ÖPNV Bahn/Tram"],
  ["fahrrad", "Fahrrad"],
  ["bike", "Fahrrad"],
  ["e-bike", "E-Bike/E-Roller"],
  ["e bike", "E-Bike/E-Roller"],
  ["roller", "E-Bike/E-Roller"],
  ["zu fuß", "Zu Fuß"],
  ["zu fuss", "Zu Fuß"],
  ["gehen", "Zu Fuß"],
]);

const carTypeMap = new Map([
  ["benzin", "PKW Benzin"],
  ["diesel", "PKW Diesel"],
  ["hybrid", "Hybrid HEV"],
  ["plug-in hybrid", "PlugInHybrid PHEV"],
  ["plug in hybrid", "PlugInHybrid PHEV"],
  ["elektro", "Elektroauto BEV EU Strommix"],
]);

const heatingMap = new Map([
  ["erdgas", "Erdgas (Brennwert)"],
  ["gas", "Erdgas (Brennwert)"],
  ["heizöl", "Heizöl extra leicht"],
  ["öl", "Heizöl extra leicht"],
  ["pellets", "Biomasse Pellets"],
  ["stückholz", "Biomasse Stückholz"],
  ["holz", "Biomasse Stückholz"],
  ["fernwärme", "Fernwärme Ø Österreich"],
  ["wärmepumpe", "Wärmepumpe (EU-Strommix, JAZ 3)"],
  ["solar", "Solarthermie"],
  ["okostrom", "Ökostrom"],
  ["öko", "Ökostrom"],
  ["strom", "Strom Ö-Mix"],
]);

const warmWaterMap = new Map([
  ["gas", "Erdgas (Brennwert)"],
  ["erdgas", "Erdgas (Brennwert)"],
  ["öl", "Heizöl extra leicht"],
  ["heizöl", "Heizöl extra leicht"],
  ["strom", "Strom Ö-Mix"],
  ["wärmepumpe", "Wärmepumpe (EU-Strommix, JAZ 3)"],
  ["solar", "Solarthermie"],
]);

function pickFirstMatch(text, map) {
  const normalized = normalizeKey(text);
  for (const [key, value] of map.entries()) {
    if (normalized.includes(key)) return value;
  }
  return null;
}

function getEmissionFactor(factors, label) {
  if (!label) return null;
  return factors.find((f) => f.label === label) || null;
}

function readEmissionSheet(workbook, sheetName, config) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];

  const rows = xlsx.utils.sheet_to_json(sheet, { defval: null });
  return rows
    .map((row, idx) => {
      const label = toText(row[config.labelKey]);
      const rawValue = row[config.valueKey];
      const valueText = toText(rawValue);
      if (!label || !valueText) return null;

      const noteParts = config.noteKeys
        .map((key) => toText(row[key]))
        .filter(Boolean);
      const note = noteParts.length ? noteParts.join(" | ") : null;

      return {
        category: config.category,
        type: label,
        label,
        valueText,
        valueNumber: toNumber(rawValue),
        unit: toText(row[config.unitKey]),
        source: toText(row[config.sourceKey]),
        note,
        sheetRow: idx + 2,
      };
    })
    .filter(Boolean);
}

async function importEmissionFactors() {
  const workbook = xlsx.readFile(EMISSION_FILE);
  const items = [];

  items.push(
    ...readEmissionSheet(workbook, "Pendelweg", {
      category: "transport",
      labelKey: "Mobilitätsart (2)",
      valueKey: "Lebenszyklus Emission",
      unitKey: "Einheit",
      sourceKey: "Quelle",
      noteKeys: ["Unnamed: 4", "Unnamed: 5"],
    })
  );

  items.push(
    ...readEmissionSheet(workbook, "Urlaub", {
      category: "flight",
      labelKey: "Mobilitätsart (2)",
      valueKey: "Lebenszyklus Emission",
      unitKey: "Einheit",
      sourceKey: "Quelle",
      noteKeys: ["Unnamed: 4", "Unnamed: 5"],
    })
  );

  items.push(
    ...readEmissionSheet(workbook, "Wärmeerzeugung", {
      category: "heating",
      labelKey: "Emissionsquelle / Parameter",
      valueKey: "CO2-Emissionen",
      unitKey: "Einheit",
      sourceKey: "Quelle",
      noteKeys: ["Unnamed: 4"],
    })
  );

  if (!items.length) {
    console.log("Keine Emissionsdaten gefunden.");
    return [];
  }

  await prisma.emissionFactor.deleteMany();
  const creates = items.map((item) =>
    prisma.emissionFactor.create({
      data: {
        category: item.category,
        type: item.type,
        co2PerUnit: item.valueNumber ?? 0,
        unit: item.unit || "",
      },
    })
  );
  await prisma.$transaction(creates);

  console.log(`Emissionen importiert: ${items.length}`);
  return items;
}

function computeSurveyTotal(row, factors) {
  const emissions = {
    commuteKg: 0,
    flightKg: 0,
    warmWaterKg: 0,
  };

  const officeDays = officeDaysMap.get(normalizeKey(row.officeDaysText)) ?? null;
  const distanceKm = distanceMap.get(normalizeKey(row.distanceText)) ?? null;
  const mainTransportLabel =
    pickFirstMatch(row.transportMainText, transportMap) ||
    pickFirstMatch(row.carTypeText, carTypeMap);
  const altTransportLabel = pickFirstMatch(
    row.alternativeTransportText,
    transportMap
  );
  const altFreq =
    altFreqMap.get(normalizeKey(row.alternativeTransportFreqText)) ?? null;

  if (officeDays !== null && distanceKm !== null && mainTransportLabel) {
    const mainFactor = getEmissionFactor(factors, mainTransportLabel);
    const altFactor = getEmissionFactor(factors, altTransportLabel);
    const altShare = altFreq ?? 0;
    const mainShare = 1 - altShare;
    const mainValue = mainFactor ? mainFactor.valueNumber || 0 : 0;
    const altValue = altFactor ? altFactor.valueNumber || 0 : 0;

    const commuteG =
      officeDays * distanceKm * (mainValue * mainShare + altValue * altShare);
    emissions.commuteKg = commuteG / 1000;
  }

  const flightsPerYear =
    flightCountMap.get(normalizeKey(row.flightsPerYearText)) ?? null;
  const flightDistanceLabel = pickFirstMatch(
    row.flightDistanceText,
    flightDistanceMap
  );
  if (flightsPerYear && flightDistanceLabel) {
    const flightFactor = getEmissionFactor(factors, flightDistanceLabel);
    const flightG = (flightFactor?.valueNumber || 0) * flightsPerYear;
    emissions.flightKg = flightG / 1000;
  }

  const warmWaterTypeLabel = pickFirstMatch(
    row.warmWaterTypeText,
    warmWaterMap
  );
  if (warmWaterTypeLabel) {
    const warmWaterEnergy = getEmissionFactor(factors, "Energiebedarf Warmwasser");
    const warmWaterFactor = getEmissionFactor(factors, warmWaterTypeLabel);
    if (warmWaterEnergy && warmWaterFactor) {
      const annualG =
        (warmWaterEnergy.valueNumber || 0) * (warmWaterFactor.valueNumber || 0);
      emissions.warmWaterKg = annualG / 1000;
    }
  }

  return emissions.commuteKg + emissions.flightKg + emissions.warmWaterKg;
}

async function importSurvey(factors, userId) {
  const workbook = xlsx.readFile(SURVEY_FILE);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: null });

  if (!rows.length) {
    console.log("Keine Umfragedaten gefunden.");
    return;
  }

  await prisma.survey.deleteMany();

  for (const row of rows) {
    const officeDaysText = toText(row["Wie oft sind Sie pro Woche im Büro?"]);
    const transportMainText = toText(
      row["Mit welchem Verkehrsmittel kommen Sie in der Regel zur Arbeit?"]
    );
    const alternativeTransportFreqText = toText(
      row["Nutzen Sie auch alternative Verkehrsmittel an manchen Tagen?"]
    );
    const alternativeTransportText = toText(
      row["Wenn ja, welche alternativen Verkehrsmittel?"]
    );
    const distanceText = toText(
      row["Wie weit ist Ihr Arbeitsplatz von zuhause entfernt?"]
    );
    const carTypeText = toText(
      row["Falls Sie ein Auto benutzen: Welchen Antrieb hat Ihr Auto?"]
    );
    const flightsPerYearText = toText(row["Wie oft fliegen Sie im Jahr?"]);
    const flightDistanceText = toText(
      row["Wenn Sie fliegen, welche Strecken fliegen Sie eher?"]
    );
    const heatingTypeText = toText(row["Wie heizen Sie zu Hause?"]);
    const warmWaterTypeText = toText(
      row["Wie wird Ihr Warmwasser zu Hause erzeugt?"]
    );
    const usesGreenElectricityText = toText(
      row["Nutzen Sie zu Hause Ökostrom"]
    );
    const smartElectricityUsageText = toText(
      row[
        "Nutzen Sie Strom bewusst zu Zeiten, in denen viel erneuerbare Energie verfügbar ist (z. B. mittags bei PV-Strom)?"
      ]
    );
    const fireworkText = toText(row["Wie oft verwenden Sie Feuerwerk?"]);
    const co2ImportanceText = toText(
      row[
        "Wie wichtig ist Ihnen das Thema CO2-Einsparung? (1 sehr wichtig – 6 gar nicht wichtig)"
      ]
    );

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

    await prisma.survey.create({
      data: {
        userId,
        officeDaysPerWeek:
          officeDaysMap.get(normalizeKey(officeDaysText)) ?? 0,
        transportMain:
          pickFirstMatch(transportMainText, transportMap) ||
          pickFirstMatch(carTypeText, carTypeMap) ||
          "UNKNOWN",
        alternativeTransportFreq:
          altFreqMap.get(normalizeKey(alternativeTransportFreqText)) ?? null,
        alternativeTransport:
          pickFirstMatch(alternativeTransportText, transportMap) ?? null,
        distanceKm: distanceMap.get(normalizeKey(distanceText)) ?? 0,
        carType: pickFirstMatch(carTypeText, carTypeMap) ?? null,
        flightsPerYear:
          flightCountMap.get(normalizeKey(flightsPerYearText)) ?? null,
        flightDistanceKm:
          (() => {
            const label = pickFirstMatch(
              flightDistanceText,
              flightDistanceMap
            );
            if (!label) return null;
            const factor = getEmissionFactor(factors, label);
            if (!factor) return null;
            if (label.includes("<1500")) return 750;
            if (label.includes("1500–3500")) return 2500;
            if (label.includes(">3500")) return 5000;
            return null;
          })() ?? null,
        heatingType:
          pickFirstMatch(heatingTypeText, heatingMap) || "UNKNOWN",
        warmWaterType:
          pickFirstMatch(warmWaterTypeText, warmWaterMap) || "UNKNOWN",
        usesGreenElectricity:
          usesGreenElectricityText || null,
        smartElectricityUsage:
          altFreqMap.get(normalizeKey(smartElectricityUsageText)) ?? null,
        fireworkPerYear: toNumber(fireworkText),
        co2Importance: toNumber(co2ImportanceText),
        totalCo2Kg: totalCo2Kg || null,
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

async function main() {
  const userId = await ensureDefaultUser();
  const factors = await importEmissionFactors();
  if (userId && factors.length) {
    await importSurvey(factors, userId);
  }
}

main()
  .catch((error) => {
    console.error("Import fehlgeschlagen:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
