const {
	computeCommuteKgFromSurveyRecord,
	computeSurveyComponentKgFromRecord,
} = require("./calculation.service");

function bucketFlights(flightsPerYear) {
	const value = Number(flightsPerYear ?? -1);
	if (!Number.isFinite(value) || value <= 0) return "0";
	if (value <= 2) return "1-2";
	if (value <= 5) return "2-5";
	return "5-10";
}

function flightDistanceBucket(flightDistanceKm) {
	const distance = Number(flightDistanceKm);
	if (!Number.isFinite(distance)) return null;
	if (distance < 1500) return "Kurzstrecke";
	if (distance <= 3500) return "Mittelstrecke";
	return "Langstrecke";
}

const FLIGHT_BUCKET_ORDER = ["0", "1-2", "2-5", "5-10"];
const FLIGHT_DISTANCE_ORDER = ["Kurzstrecke", "Mittelstrecke", "Langstrecke"];

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
	const byMonth = {};
	let totalCo2 = 0;

	surveys.forEach((survey) => {
		const transport = survey.transportMain || "UNKNOWN";
		byTransport[transport] = (byTransport[transport] || 0) + 1;

		const commuteKg = computeCommuteKgFromSurveyRecord(survey, factors);

		co2ByTransport[transport] = co2ByTransport[transport] || { sum: 0, count: 0 };
		co2ByTransport[transport].sum += Number(commuteKg || 0);
		co2ByTransport[transport].count += 1;

		const flightCountBucket = bucketFlights(survey.flightsPerYear);
		flights[flightCountBucket] = (flights[flightCountBucket] || 0) + 1;

		const flightDistanceGroup = Number(survey.flightsPerYear || 0) > 0
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

		const heating = survey.heatingType || "UNKNOWN";
		const heatingParts = String(heating)
			.split(/\s*\+\s*/)
			.map((part) => part.trim())
			.filter(Boolean);

		if (heatingParts.length > 1) {
			const heatingShareKg = Number(components.heatingKg || 0) / heatingParts.length;
			heatingParts.forEach((part) => {
				byHeating[part] = (byHeating[part] || 0) + 1;
				co2ByHeating[part] = co2ByHeating[part] || { sum: 0, count: 0 };
				co2ByHeating[part].sum += heatingShareKg;
				co2ByHeating[part].count += 1;
			});
		} else {
			byHeating[heating] = (byHeating[heating] || 0) + 1;
			co2ByHeating[heating] = co2ByHeating[heating] || { sum: 0, count: 0 };
			co2ByHeating[heating].sum += Number(components.heatingKg || 0);
			co2ByHeating[heating].count += 1;
		}

		const warmWater = survey.warmWaterType || "UNKNOWN";
		byWarmWater[warmWater] = (byWarmWater[warmWater] || 0) + 1;
		co2ByWarmWater[warmWater] = co2ByWarmWater[warmWater] || { sum: 0, count: 0 };
		co2ByWarmWater[warmWater].sum += Number(components.warmWaterKg || 0);
		co2ByWarmWater[warmWater].count += 1;

		const electricity = survey.usesGreenElectricity || "UNKNOWN";
		byElectricity[electricity] = (byElectricity[electricity] || 0) + 1;

		totalCo2 += Number(survey.totalCo2Kg || 0);

		if (survey.createdAt) {
			const date = new Date(survey.createdAt);
			const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
			byMonth[monthKey] = byMonth[monthKey] || { sum: 0, count: 0 };
			byMonth[monthKey].sum += Number(survey.totalCo2Kg || 0);
			byMonth[monthKey].count += 1;
		}
	});

	const avgCo2ByTransport = {};
	Object.keys(co2ByTransport).forEach((transport) => {
		const entry = co2ByTransport[transport];
		avgCo2ByTransport[transport] = Number(entry.sum.toFixed(2));
	});

	const avgCo2ByFlights = {};
	Object.keys(co2ByFlights).forEach((bucket) => {
		const entry = co2ByFlights[bucket];
		avgCo2ByFlights[bucket] = Number(entry.sum.toFixed(2));
	});

	const avgCo2ByHeating = {};
	Object.keys(co2ByHeating).forEach((heating) => {
		const entry = co2ByHeating[heating];
		avgCo2ByHeating[heating] = Number(entry.sum.toFixed(2));
	});

	const avgCo2ByWarmWater = {};
	Object.keys(co2ByWarmWater).forEach((warmWater) => {
		const entry = co2ByWarmWater[warmWater];
		avgCo2ByWarmWater[warmWater] = Number(entry.sum.toFixed(2));
	});

	const months = Object.keys(byMonth).sort();
	const avgCo2ByMonth = months.map((month) =>
		Number((byMonth[month].sum / byMonth[month].count).toFixed(2))
	);

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
		if (avgCo2ByFlights[bucket] !== undefined) {
			orderedCo2ByFlights[bucket] = avgCo2ByFlights[bucket];
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

	const scaledAvgCo2ByTransport = scaleAndRoundValues(avgCo2ByTransport);
	const scaledAvgCo2ByFlights = scaleAndRoundValues(orderedCo2ByFlights);
	const scaledAvgCo2ByHeating = scaleAndRoundValues(avgCo2ByHeating);
	const scaledAvgCo2ByWarmWater = scaleAndRoundValues(avgCo2ByWarmWater);
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
		avgCo2ByTransport: scaledAvgCo2ByTransport,
		avgCo2ByFlights: scaledAvgCo2ByFlights,
		flightsByDistance: orderedFlightsByDistance,
		avgCo2ByHeating: scaledAvgCo2ByHeating,
		avgCo2ByWarmWater: scaledAvgCo2ByWarmWater,
		flights: orderedFlights,
		byHeating,
		byWarmWater,
		byElectricity,
		co2Areas: roundedCo2Areas,
		months,
		avgCo2ByMonth,
	};
}

module.exports = {
	buildSurveyAggregations,
};