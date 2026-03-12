const path = require("path");
const xlsx = require("xlsx");
const { PrismaClient } = require("@prisma/client");
const calc = require("../calculation.service");
const staticEmissionFactors = require("./emission-factors.data");

const prisma = new PrismaClient();

const DATA_DIR = path.resolve(__dirname, "..", "..", "data");
const SURVEY_FILE = path.join(DATA_DIR, "auswertung_umfrage.xlsx");

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

function mapCombinedFlightAnswerToShortHaul(value) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (normalized.includes("ja")) return "Ja";
  if (normalized.includes("manchmal")) return "Manchmal";
  if (normalized.includes("nein")) return "Nein";
  return null;
}

function getSheetRows(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return xlsx.utils.sheet_to_json(sheet, { defval: null });
}

async function importEmissionFactors() {
  const items = staticEmissionFactors
    .filter((item) => item && item.category && item.label)
    .map((item) => ({
      category: toText(item.category),
      label: toText(item.label),
      valueNumber: toNumber(item.valueNumber) ?? 0,
      unit: toText(item.unit) || "",
    }));

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
    const emailText = toText(getCell(row, headerIndex, ["Email", "E-Mail"]));
    const nameText = toText(getCell(row, headerIndex, ["Name"]));
    const officeDaysText = toText(
      getCell(row, headerIndex, [
        "Bürotage pro Woche",
        "Burotage pro Woche",
        "Wie oft sind Sie pro Woche im Büro?",
        "Wie oft sind Sie pro Woche im Buro?",
      ])
    );
    const transportMainText = toText(
      getCell(row, headerIndex, [
        "Verkehrsmittel",
        "Pendelverkehrsmittel",
        "Mit welchem Verkehrsmittel kommen Sie in der Regel zur Arbeit?",
      ])
    );
    const alternativeTransportFreqText = toText(
      getCell(row, headerIndex, [
        "Häufigkeit alternatives Vekehrsmittel",
        "Haufigkeit alternatives Vekehrsmittel",
        "Häufigkeit alternatives Verkehrsmittel",
        "Haufigkeit alternatives Verkehrsmittel",
        "Nutzen Sie auch alternative Verkehrsmittel an manchen Tagen?",
      ])
    );
    const alternativeTransportText = toText(
      getCell(row, headerIndex, ["alternatives Verkehrsmittel", "Wenn ja, welche alternativen Verkehrsmittel?"])
    );
    const distanceText = toText(
      getCell(row, headerIndex, ["Pendelstrecke", "Wie weit ist Ihr Arbeitsplatz von zuhause entfernt?"])
    );
    const carTypeText = toText(
      getCell(row, headerIndex, ["Autoantrieb", "Falls Sie ein Auto benutzen: Welchen Antrieb hat Ihr Auto?"])
    );
    const flightsPerYearText = toText(
      getCell(row, headerIndex, ["Flüge pro Jahr", "Fluge pro Jahr", "Wie oft fliegen Sie im Jahr?"])
    );
    const flightDistanceText = toText(
      getCell(row, headerIndex, ["Flugstrecken", "Flugdistanz", "Wenn Sie fliegen, welche Strecken fliegen Sie eher?"])
    );
    const heatingTypeText = toText(getCell(row, headerIndex, ["Heizungsart", "Wie heizen Sie zu Hause?"]));
    const warmWaterTypeText = toText(
      getCell(row, headerIndex, ["Warmwassererzeugung", "Wie wird Ihr Warmwasser zu Hause erzeugt?"])
    );
    const usesGreenElectricityText = toText(
      getCell(row, headerIndex, [
        "Ökostromnutzung",
        "Okostromnutzung",
        "Nutzen Sie zu Hause Ökostrom",
        "Nutzen Sie zu Hause Okostrom",
      ])
    );
    const greenElectricityTypeText = toText(
      getCell(row, headerIndex, ["Ökostrom Art", "Okostrom Art"])
    );
    const loadOptimizationText = toText(
      getCell(row, headerIndex, [
        "Lastoptimiereung",
        "Lastoptimierung",
        "Lastoptimiereung/Lastmanagement/intelligente Stromnutzung",
        "Lastoptimierung/Lastmanagement/intelligente Stromnutzung",
        "Smart-Stromnutzung",
      ])
    );
    const smartElectricityUsageText = toText(
      getCell(row, headerIndex, [
        "Smart-Stromnutzung",
        "Lastoptimiereung/Lastmanagement/intelligente Stromnutzung",
        "Lastoptimierung/Lastmanagement/intelligente Stromnutzung",
        "Nutzen Sie Strom bewusst zu Zeiten, in denen viel erneuerbare Energie verfügbar ist (z. B. mittags bei PV-Strom)?",
        "Nutzen Sie Strom bewusst zu Zeiten, in denen viel erneuerbare Energie verfugbar ist (z. B. mittags bei PV-Strom)?",
      ])
    ) || loadOptimizationText;
    const fireworkText = toText(getCell(row, headerIndex, ["Feuerwerk Nutzung", "Wie oft verwenden Sie Feuerwerk?"]));
    const combinedFlightBehaviorText = toText(
      getCell(row, headerIndex, [
        "Verzicht auf Flugreisen/ Zug als Alternative",
        "Verzicht auf Flugreisen; Zug als Alternative",
        "Verzicht auf Flugreisen;  Zug als Alternative",
        "Verzicht auf Flugreisen / Zug als Alternative",
      ])
    );
    const shortHaulTrainAlternativeText = toText(
      getCell(row, headerIndex, [
        "Kurzstrecken Zug Alternative",
        "Zug als Alternative",
        "Würden Sie bei Kurzstrecken Alternativen wie Zug nutzen?",
      ])
    ) || mapCombinedFlightAnswerToShortHaul(combinedFlightBehaviorText);
    const shoppingTransportEcoChoiceText = toText(
      getCell(row, headerIndex, [
        "Nachhaltiger Transport",
        "Achten Sie beim Kauf darauf, dass Produkte möglichst umweltfreundlich transportiert werden (z. B. Schiff statt Flugzeug)?",
        "Achten Sie beim Kauf darauf, dass Produkte möglichst umweltfreundlich transportiert werden (z. B. Schiff statt Flugzeug)?",
      ])
    );
    const usesEnergyEfficientAppliancesText = toText(
      getCell(row, headerIndex, [
        "Energieeffiziente Geräte",
        "Nutzen Sie energiesparende Haushaltsgeräte (z. B. Kühlschrank, Waschmaschine)?",
        "Nutzen Sie energiesparende Haushaltsgeräte (z. B. Kühlschrank, Waschmaschine)?",
      ])
    );
    const usesSmartDevicesText = toText(
      getCell(row, headerIndex, [
        "smarte Geräte",
        "Nutzen Sie smarte Geräte, die Strom sparen (z.B. programmierbare Thermostate, smarte Waschmaschine)?",
        "Nutzen Sie smarte Geräte, die Strom sparen (z. B. programmierbare Thermostate, smarte Waschmaschine)?",
      ])
    );
    const buysRegionalProductsText = toText(
      getCell(row, headerIndex, ["Regionaler Kauf", "Kaufen Sie gerne Produkte aus der Region oder lokal hergestellte Sachen?"])
    );
    const buysSustainableClothingText = toText(
      getCell(row, headerIndex, ["Nachhaltige Kleidung", "Achten Sie bei Kleidung auf langlebige oder nachhaltige Materialien?"])
    );
    const avoidsOnlineShoppingText = toText(
      getCell(row, headerIndex, ["Bewusster Konsum", "Kaufen Sie bewusst weniger online, um Verpackung und Transportweg zu sparen?"])
    );

    const hasMeaningfulSurveyData = [
      officeDaysText,
      transportMainText,
      distanceText,
      flightsPerYearText,
      flightDistanceText,
      heatingTypeText,
      warmWaterTypeText,
      usesGreenElectricityText,
      loadOptimizationText,
      fireworkText,
    ].some((value) => value !== null && value !== undefined && String(value).trim() !== "");

    if (!hasMeaningfulSurveyData) {
      continue;
    }

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
        mitarbeiter: emailText || importUser?.email || null,
        employeeName: nameText || null,
        officeDaysPerWeek: calc.parseOfficeDays(officeDaysText),
        transportMain: transportMainText || "UNKNOWN",
        alternativeTransportFreq: alternativeTransportFreqText || null,
        alternativeTransport: alternativeTransportText || null,
        distanceKm: calc.parseDistanceKm(distanceText),
        carType: carTypeText || null,
        flightsPerYear: flightsPerYearText || null,
        flightDistanceKm: flightDistanceText || null,
        shortHaulTrainAlternative: shortHaulTrainAlternativeText || null,
        heatingType: heatingTypeText || "UNKNOWN",
        warmWaterType: warmWaterTypeText || "UNKNOWN",
        usesGreenElectricity: usesGreenElectricityText || null,
        greenElectricityType: greenElectricityTypeText || null,
        smartElectricityUsage: smartElectricityUsageText || null,
        loadOptimization: loadOptimizationText || null,
        fireworkPerYear: fireworkText || null,
        shoppingTransportEcoChoice: shoppingTransportEcoChoiceText || null,
        usesEnergyEfficientAppliances: usesEnergyEfficientAppliancesText || null,
        usesSmartDevices: usesSmartDevicesText || null,
        buysRegionalProducts: buysRegionalProductsText || null,
        buysSustainableClothing: buysSustainableClothingText || null,
        avoidsOnlineShopping: avoidsOnlineShoppingText || null,
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
