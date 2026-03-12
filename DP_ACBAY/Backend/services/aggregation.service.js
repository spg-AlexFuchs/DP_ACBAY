const {
	computeCommuteKgFromSurveyRecord,
	computeSurveyComponentKgFromRecord,
	resolveMainTransportLabel,
	mapHeatingType,
	mapHeatingTypes,
	mapWarmWaterType,
	mapWarmWaterTypes,
	mapTransport,
	parseAltFreq,
} = require("./calculation.service");

function bucketFlights(flightsPerYear) {
	const text = String(flightsPerYear ?? "").toLowerCase();
	if (text.includes("nie") || text === "0") return "0";
	if (text.includes("1-2")) return "1-2";
	if (text.includes("2-5")) return "2-5";
	if (text.includes("5-10")) return "5-10";

	const value = Number(flightsPerYear ?? -1);
	if (!Number.isFinite(value) || value <= 0) return "0";
	if (value <= 2) return "1-2";
	if (value <= 5) return "2-5";
	return "5-10";
}

function flightDistanceBucket(flightDistanceKm) {
	const text = String(flightDistanceKm ?? "").toLowerCase();
	if (text.includes("kurzstrecke")) return "Kurzstrecke";
	if (text.includes("mittelstrecke")) return "Mittelstrecke";
	if (text.includes("langstrecke")) return "Langstrecke";

	const distance = Number(flightDistanceKm);
	if (!Number.isFinite(distance)) return null;
	if (distance < 1500) return "Kurzstrecke";
	if (distance <= 3500) return "Mittelstrecke";
	return "Langstrecke";
}

const FLIGHT_BUCKET_ORDER = ["0", "1-2", "2-5", "5-10"];
const FLIGHT_DISTANCE_ORDER = ["Kurzstrecke", "Mittelstrecke", "Langstrecke"];

function getTransportFactorValue(factors, transportLabel) {
	if (!transportLabel) return 0;
	const labelNorm = String(transportLabel).toLowerCase();
	const exact = (factors || []).find((factor) =>
		String(factor?.category || "").toLowerCase() === "transport" &&
		String(factor?.label || "").toLowerCase() === labelNorm
	);
	if (exact && Number.isFinite(Number(exact.valueNumber))) {
		return Number(exact.valueNumber);
	}

	const transportValues = (factors || [])
		.filter((factor) => String(factor?.category || "").toLowerCase() === "transport")
		.map((factor) => Number(factor.valueNumber))
		.filter((value) => Number.isFinite(value) && value > 0);

	if (!transportValues.length) return 0;
	return transportValues.reduce((sum, value) => sum + value, 0) / transportValues.length;
}

function categorizeTransport(transportLabel, carType = null) {
	if (!transportLabel) return "UNKNOWN";
	
	const norm = String(transportLabel).toLowerCase();
	
	// Wenn "Auto" ohne Antriebsart, default auf "PKW Benzin"
	if (norm === "auto") {
		if (!carType) return "PKW Benzin";
		const carNorm = String(carType).toLowerCase();
		if (carNorm.includes("benzin")) return "PKW Benzin";
		if (carNorm.includes("diesel")) return "PKW Diesel";
		if (carNorm.includes("plug") && carNorm.includes("hybrid")) return "PlugInHybrid PHEV";
		if (carNorm.includes("hybrid")) return "Hybrid HEV";
		if (carNorm.includes("elektro")) return "Elektroauto BEV EU Strommix";
		if (carNorm.includes("gas") && carNorm.includes("cng")) return "Gas CNG";
		if (carNorm.includes("wasserstoff")) return "Wasserstoff FCEV";
		if (carNorm.includes("fluessiggas") || carNorm.includes("flüssiggas")) return "Flüssiggas LPG";
		return "PKW Benzin"; // Default fallback
	}
	
	// Direkt die Antriebsarten/Labels aus emission-factors zurückgeben
	// PKW Antriebsarten
	if (norm.includes("benzin")) return "PKW Benzin";
	if (norm.includes("diesel")) return "PKW Diesel";
	if (norm.includes("plug") && norm.includes("hybrid")) return "PlugInHybrid PHEV";
	if (norm.includes("hybrid")) return "Hybrid HEV";
	if (norm.includes("elektro")) return "Elektroauto BEV EU Strommix";
	if (norm.includes("gas") && norm.includes("cng")) return "Gas CNG";
	if (norm.includes("wasserstoff")) return "Wasserstoff FCEV";
	if (norm.includes("fluessiggas") || norm.includes("flüssiggas")) return "Flüssiggas LPG";
	
	// Zu Fuß
	if (norm.includes("fuss") || norm.includes("gehen")) return "Zu Fuß";
	
	// Fahrrad
	if (norm.includes("fahrrad") || norm.includes("bike")) return "Fahrrad";
	
	// E-Bike/E-Roller
	if (norm.includes("e-bike") || norm.includes("e bike") || norm.includes("ebike") || 
		norm.includes("roller") || norm.includes("e-roller") || norm.includes("e roller")) {
		return "E-Bike/E-Roller";
	}
	
	// ÖPNV Bus
	if (norm.includes("bus")) return "ÖPNV Bus Diesel";
	
	// ÖPNV Bahn/Tram
	if (norm.includes("bahn") || norm.includes("tram") || norm.includes("zug") || 
		norm.includes("ubahn") || norm.includes("u-bahn") || norm.includes("straßenbahn") ||
		norm.includes("strassenbahn") || norm.includes("offis") || norm.includes("oeffis") ||
		norm.includes("öpnv") || norm.includes("oepnv") || norm.includes("oeffentliche") ||
		norm.includes("öffentliche") || norm.includes("offentliche")) {
		return "ÖPNV Bahn/Tram";
	}
	
	return "Sonstiges";
}

function extractCarDriveType(transportLabel) {
	if (!transportLabel) return null;
	
	const norm = String(transportLabel).toLowerCase();
	
	if (norm.includes("benzin")) return "Benzin";
	if (norm.includes("diesel")) return "Diesel";
	if (norm.includes("hybrid") && norm.includes("plug")) return "Plug-in Hybrid";
	if (norm.includes("hybrid")) return "Hybrid";
	if (norm.includes("elektro")) return "Elektro";
	if (norm.includes("gas")) return "Gas/CNG";
	if (norm.includes("wasserstoff")) return "Wasserstoff";
	if (norm.includes("fluessiggas") || norm.includes("flüssiggas")) return "Flüssiggas";
	
	return null;
}

function buildSurveyAggregations(surveys, factors = []) {
	const byTransport = {};
	const co2ByTransport = {};
	const flights = {};
	const flightsByDistance = {};
	const byHeating = {};
	const byWarmWater = {};
	const byElectricity = {};
	const co2ByFlights = {};
	const co2ByHeating = {};
	const co2ByWarmWater = {};
	const co2Areas = {
		transport: 0,
		flights: 0,
		heating: 0,
		warmWater: 0,
		electricity: 0,
		consumption: 0,
	};
	let totalCo2 = 0;

	surveys.forEach((survey) => {
		// Resolve actual transport label using carType if it's a car
		const resolvedTransport = resolveMainTransportLabel(survey.transportMain, survey.carType);
		const transportCategory = categorizeTransport(resolvedTransport, survey.carType);
		const altTransportLabel = mapTransport(survey.alternativeTransport) || survey.alternativeTransport || null;
		const altTransportCategory = categorizeTransport(altTransportLabel);
		const altFreqParsed = parseAltFreq(survey.alternativeTransportFreq);
		const altFreqRaw = Number.isFinite(altFreqParsed)
			? altFreqParsed
			: Number(survey.alternativeTransportFreq || 0);
		const altFreq = Math.min(Math.max(Number.isFinite(altFreqRaw) ? altFreqRaw : 0, 0), 1);
		byTransport[transportCategory] = (byTransport[transportCategory] || 0) + 1;

		const commuteKg = computeCommuteKgFromSurveyRecord(survey, factors);

		// CO2: alle beteiligten Verkehrsmittel (Haupt + Alternative anteilig)
		const mainValue = getTransportFactorValue(factors, resolvedTransport);
		const altValue = getTransportFactorValue(factors, altTransportLabel);
		const mainWeight = mainValue * (1 - altFreq);
		const altWeight = altTransportLabel ? altValue * altFreq : 0;
		const totalWeight = mainWeight + altWeight;
		const totalCommuteKg = Number(commuteKg || 0);

		if (totalCommuteKg > 0 && totalWeight > 0) {
			const mainKg = totalCommuteKg * (mainWeight / totalWeight);
			co2ByTransport[transportCategory] = co2ByTransport[transportCategory] || { sum: 0, count: 0 };
			co2ByTransport[transportCategory].sum += Number(mainKg || 0);
			co2ByTransport[transportCategory].count += 1;

			if (altWeight > 0) {
				const altKg = totalCommuteKg * (altWeight / totalWeight);
				co2ByTransport[altTransportCategory] = co2ByTransport[altTransportCategory] || { sum: 0, count: 0 };
				co2ByTransport[altTransportCategory].sum += Number(altKg || 0);
				co2ByTransport[altTransportCategory].count += 1;
			}
		} else {
			co2ByTransport[transportCategory] = co2ByTransport[transportCategory] || { sum: 0, count: 0 };
			co2ByTransport[transportCategory].sum += totalCommuteKg;
			co2ByTransport[transportCategory].count += 1;
		}

		const flightCountBucket = bucketFlights(survey.flightsPerYear);
		flights[flightCountBucket] = (flights[flightCountBucket] || 0) + 1;

		const hasFlights = bucketFlights(survey.flightsPerYear) !== "0";
		const flightDistanceGroup = hasFlights
			? flightDistanceBucket(survey.flightDistanceKm)
			: null;

		const components = computeSurveyComponentKgFromRecord(survey, factors);
		co2Areas.transport += Number(components.commuteKg || 0);
		co2Areas.flights += Number(components.flightKg || 0);
		co2Areas.heating += Number(components.heatingKg || 0);
		co2Areas.warmWater += Number(components.warmWaterKg || 0);
		co2Areas.electricity += Number(components.electricityKg || 0);
		co2Areas.consumption += Number(components.consumptionKg || 0);

		if (flightDistanceGroup) {
			flightsByDistance[flightDistanceGroup] = (flightsByDistance[flightDistanceGroup] || 0) + 1;
			co2ByFlights[flightDistanceGroup] = co2ByFlights[flightDistanceGroup] || { sum: 0, count: 0 };
			co2ByFlights[flightDistanceGroup].sum += Number(components.flightKg || 0);
			co2ByFlights[flightDistanceGroup].count += 1;
		}

		const heatingParts = mapHeatingTypes(survey.heatingType);
		const resolvedHeatingParts = heatingParts.length
			? heatingParts
			: [mapHeatingType(survey.heatingType) || "UNKNOWN"];

		const heatingShareKg = Number(components.heatingKg || 0) / resolvedHeatingParts.length;
		resolvedHeatingParts.forEach((part) => {
			byHeating[part] = (byHeating[part] || 0) + 1;
			co2ByHeating[part] = co2ByHeating[part] || { sum: 0, count: 0 };
			co2ByHeating[part].sum += heatingShareKg;
			co2ByHeating[part].count += 1;
		});

		const warmWaterParts = mapWarmWaterTypes(survey.warmWaterType);
		const resolvedWarmWaterParts = warmWaterParts.length
			? warmWaterParts
			: [mapWarmWaterType(survey.warmWaterType) || "UNKNOWN"];
		const warmWaterShareKg = Number(components.warmWaterKg || 0) / resolvedWarmWaterParts.length;
		resolvedWarmWaterParts.forEach((part) => {
			byWarmWater[part] = (byWarmWater[part] || 0) + 1;
			co2ByWarmWater[part] = co2ByWarmWater[part] || { sum: 0, count: 0 };
			co2ByWarmWater[part].sum += warmWaterShareKg;
			co2ByWarmWater[part].count += 1;
		});

		const electricity = survey.usesGreenElectricity || "UNKNOWN";
		byElectricity[electricity] = (byElectricity[electricity] || 0) + 1;

		totalCo2 += Number(survey.totalCo2Kg || 0);
	});

	const co2SumByTransport = {};
	Object.keys(co2ByTransport).forEach((transport) => {
		const entry = co2ByTransport[transport];
		co2SumByTransport[transport] = Number(entry.sum.toFixed(2));
	});

	const co2SumByFlights = {};
	Object.keys(co2ByFlights).forEach((bucket) => {
		const entry = co2ByFlights[bucket];
		co2SumByFlights[bucket] = Number(entry.sum.toFixed(2));
	});

	const co2SumByHeating = {};
	Object.keys(co2ByHeating).forEach((heating) => {
		const entry = co2ByHeating[heating];
		co2SumByHeating[heating] = Number(entry.sum.toFixed(2));
	});

	const co2SumByWarmWater = {};
	Object.keys(co2ByWarmWater).forEach((warmWater) => {
		const entry = co2ByWarmWater[warmWater];
		co2SumByWarmWater[warmWater] = Number(entry.sum.toFixed(2));
	});

	const orderedFlights = {};
	FLIGHT_BUCKET_ORDER.forEach((bucket) => {
		if (flights[bucket] !== undefined) {
			orderedFlights[bucket] = flights[bucket];
		}
	});
	Object.keys(flights).forEach((bucket) => {
		if (orderedFlights[bucket] === undefined) {
			orderedFlights[bucket] = flights[bucket];
		}
	});

	const orderedCo2ByFlights = {};
	FLIGHT_DISTANCE_ORDER.forEach((bucket) => {
		if (co2SumByFlights[bucket] !== undefined) {
			orderedCo2ByFlights[bucket] = co2SumByFlights[bucket];
		}
	});

	const orderedFlightsByDistance = {};
	FLIGHT_DISTANCE_ORDER.forEach((bucket) => {
		if (flightsByDistance[bucket] !== undefined) {
			orderedFlightsByDistance[bucket] = flightsByDistance[bucket];
		}
	});

	const co2AreasTotal = Object.values(co2Areas).reduce((sum, value) => sum + Number(value || 0), 0);
	const co2AreaScale = co2AreasTotal > 0 && totalCo2 > 0 ? totalCo2 / co2AreasTotal : 1;
	const scaleAndRoundValues = (obj) => Object.fromEntries(
		Object.entries(obj).map(([key, value]) => [
			key,
			Number((Number(value || 0) * co2AreaScale).toFixed(2)),
		])
	);

	const scaledCo2ByTransport = scaleAndRoundValues(co2SumByTransport);
	const scaledCo2ByFlights = scaleAndRoundValues(orderedCo2ByFlights);
	const scaledCo2ByHeating = scaleAndRoundValues(co2SumByHeating);
	const scaledCo2ByWarmWater = scaleAndRoundValues(co2SumByWarmWater);
	const normalizedCo2Areas = Object.fromEntries(
		Object.entries(co2Areas).map(([key, value]) => [key, Number(value || 0) * co2AreaScale])
	);
	const roundedCo2Areas = Object.fromEntries(
		Object.entries(normalizedCo2Areas).map(([key, value]) => [key, Number(value.toFixed(2))])
	);

	return {
		count: surveys.length,
		avgCo2Kg: surveys.length ? Number((totalCo2 / surveys.length).toFixed(2)) : 0,
		byTransport,
		avgCo2ByTransport: scaledCo2ByTransport,
		avgCo2ByFlights: scaledCo2ByFlights,
		flightsByDistance: orderedFlightsByDistance,
		avgCo2ByHeating: scaledCo2ByHeating,
		avgCo2ByWarmWater: scaledCo2ByWarmWater,
		flights: orderedFlights,
		byHeating,
		byWarmWater,
		byElectricity,
		co2Areas: roundedCo2Areas,
	};
}

module.exports = {
	buildSurveyAggregations,
};