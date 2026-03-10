const path = require("path");
const xlsx = require("xlsx");
const { PrismaClient } = require("@prisma/client");
const calc = require("../calculation.service");

const prisma = new PrismaClient();

const EMISSION_FILE = path.join("data", "emissionen_nach_typ.xlsx");
const SURVEY_FILE = path.join("data", "auswertung_umfrage.xlsx");

function toText(value) {
  if (value === null || value === undefined) return null;
  return String(value).trim();
}

function toNumber(value) {
  if (typeof value === "number") return value;
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/,/g, ".").replace(/[–—]/g, "-").trim();

  // Supports range notation from source sheets (e.g. "0-50") by using midpoint.
  const rangeMatch = text.match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/);
  if (rangeMatch) {
    const min = Number(rangeMatch[1]);
    const max = Number(rangeMatch[2]);
    if (Number.isFinite(min) && Number.isFinite(max)) {
      return (min + max) / 2;
    }
  }

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

function findColumnName(headers, aliases = []) {
  const normalizedHeaders = headers.map((h) => ({ raw: h, norm: normalizeText(h) }));
  for (const alias of aliases) {
    const aliasNorm = normalizeText(alias);
    const hit = normalizedHeaders.find((h) => h.norm === aliasNorm);
    if (hit) return hit.raw;
  }
  return null;
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
    },
    {
      sheetName: "Urlaub",
      category: "flight",
      labelAliases: ["Mobilitätsart (2)", "Mobilitatsart (2)", "MobilitÃ¤tsart (2)"],
      valueAliases: ["Lebenszyklus Emission"],
      unitAliases: ["Einheit"],
    },
    {
      sheetName: "Wärmeerzeugung",
      category: "heating",
      labelAliases: ["Emissionsquelle / Parameter"],
      valueAliases: ["CO2-Emissionen"],
      unitAliases: ["Einheit"],
    },
    {
      sheetName: "Konsum",
      category: "consumption",
      labelAliases: ["Kategorie"],
      valueAliases: ["Basiswert_t_CO2e"],
      fallbackValueAliases: ["Max_Reduktion_t_CO2e"],
      unitAliases: ["Einheit"],
    },
  ];

  for (const cfg of configs) {
    const rows = getSheetRows(workbook, cfg.sheetName);
    if (!rows.length) continue;

    const headers = Object.keys(rows[0]);
    const labelKey = findColumnName(headers, cfg.labelAliases);
    const valueKey = findColumnName(headers, cfg.valueAliases);
    const fallbackValueKey = findColumnName(headers, cfg.fallbackValueAliases || []);
    const unitKey = findColumnName(headers, cfg.unitAliases);

    rows.forEach((row) => {
      const label = toText(labelKey ? row[labelKey] : null);
      const valueText =
        toText(valueKey ? row[valueKey] : null) || toText(fallbackValueKey ? row[fallbackValueKey] : null);
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

  const factors = items.map((x) => ({
    label: x.label,
    valueNumber: x.valueNumber ?? 0,
    category: x.category,
    unit: x.unit,
  }));

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
  const importUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
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
    const heatingSavingsText = toText(
      getCell(row, headerIndex, [
        "Machen Sie etwas, um beim Heizen Energie und CO₂ zu sparen?",
        "Machen Sie etwas, um beim Heizen Energie und CO2 zu sparen?",
      ])
    );
    const flightAvoidanceText = toText(
      getCell(row, headerIndex, ["Verzichten Sie auf Flugreisen oder nutzen Alternativen wie Zug?"])
    );
    const shortHaulTrainAlternativeText = toText(
      getCell(row, headerIndex, ["Würden Sie bei Kurzstrecken Alternativen wie Zug nutzen?"])
    );
    const shoppingTransportEcoChoiceText = toText(
      getCell(row, headerIndex, [
        "Achten Sie beim Kauf darauf, dass Produkte möglichst umweltfreundlich transportiert werden (z. B. Schiff statt Flugzeug)?",
        "Achten Sie beim Kauf darauf, dass Produkte möglichst umweltfreundlich transportiert werden (z. B. Schiff statt Flugzeug)?",
      ])
    );
    const usesEnergyEfficientAppliancesText = toText(
      getCell(row, headerIndex, [
        "Nutzen Sie energiesparende Haushaltsgeräte (z. B. Kühlschrank, Waschmaschine)?",
        "Nutzen Sie energiesparende Haushaltsgeräte (z. B. Kühlschrank, Waschmaschine)?",
      ])
    );
    const usesSmartDevicesText = toText(
      getCell(row, headerIndex, [
        "Nutzen Sie smarte Geräte, die Strom sparen (z.B. programmierbare Thermostate, smarte Waschmaschine)?",
        "Nutzen Sie smarte Geräte, die Strom sparen (z. B. programmierbare Thermostate, smarte Waschmaschine)?",
      ])
    );
    const buysRegionalProductsText = toText(
      getCell(row, headerIndex, ["Kaufen Sie gerne Produkte aus der Region oder lokal hergestellte Sachen?"])
    );
    const buysSustainableClothingText = toText(
      getCell(row, headerIndex, ["Achten Sie bei Kleidung auf langlebige oder nachhaltige Materialien?"])
    );
    const avoidsOnlineShoppingText = toText(
      getCell(row, headerIndex, ["Kaufen Sie bewusst weniger online, um Verpackung und Transportweg zu sparen?"])
    );
    const co2ImportanceText = toText(
      getCell(row, headerIndex, [
        "Wie wichtig ist Ihnen das Thema CO2-Einsparung? (1 sehr wichtig – 6 gar nicht wichtig)",
        "Wie wichtig ist Ihnen das Thema CO2-Einsparung? (1 sehr wichtig - 6 gar nicht wichtig)",
      ])
    );

    const totalCo2Kg = calc.computeSurveyTotal(
      {
        officeDaysText,
        transportMainText,
        alternativeTransportFreqText,
        alternativeTransportText,
        distanceText,
        carTypeText,
        flightsPerYearText,
        flightDistanceText,
        heatingTypeText,
        warmWaterTypeText,
        usesGreenElectricityText,
        smartElectricityUsageText,
        heatingSavingsText,
        flightAvoidanceText,
        shortHaulTrainAlternativeText,
        shoppingTransportEcoChoiceText,
        usesEnergyEfficientAppliancesText,
        usesSmartDevicesText,
        regionalProductsText: buysRegionalProductsText,
        sustainableClothingText: buysSustainableClothingText,
        avoidsOnlineShoppingText,
        fireworkText,
      },
      factors
    );

    await prisma.survey.create({
      data: {
        userId,
        mitarbeiter: importUser?.email || null,
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
  toNumber,
};
