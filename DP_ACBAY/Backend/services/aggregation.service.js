const { computeCommuteKgFromSurveyRecord } = require("./calculation.service");

function bucketFlights(flightsPerYear) {
	const value = flightsPerYear ?? -1;
	if (value <= 0) return "0";
	if (value <= 2) return "1-2";
	if (value <= 5) return "2-5";
	return ">5";
}

const FLIGHT_BUCKET_ORDER = ["0", "1-2", "2-5", ">5"];

function buildSurveyAggregations(surveys, factors = []) {
	const byTransport = {};
	const co2ByTransport = {};
	const flights = {};
	const byHeating = {};
	const byElectricity = {};
	const byMonth = {};
	let totalCo2 = 0;

	surveys.forEach((survey) => {
		const transport = survey.transportMain || "UNKNOWN";
		byTransport[transport] = (byTransport[transport] || 0) + 1;

		const commuteKg = computeCommuteKgFromSurveyRecord(survey, factors);

		co2ByTransport[transport] = co2ByTransport[transport] || { sum: 0, count: 0 };
		co2ByTransport[transport].sum += Number(commuteKg || 0);
		co2ByTransport[transport].count += 1;

		const flightBucket = bucketFlights(survey.flightsPerYear);
		flights[flightBucket] = (flights[flightBucket] || 0) + 1;

		const heating = survey.heatingType || "UNKNOWN";
		byHeating[heating] = (byHeating[heating] || 0) + 1;

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
		avgCo2ByTransport[transport] = entry.count
			? Number((entry.sum / entry.count).toFixed(2))
			: 0;
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

	return {
		count: surveys.length,
		avgCo2Kg: surveys.length ? Number((totalCo2 / surveys.length).toFixed(2)) : 0,
		byTransport,
		avgCo2ByTransport,
		flights: orderedFlights,
		byHeating,
		byElectricity,
		months,
		avgCo2ByMonth,
	};
}

module.exports = {
	buildSurveyAggregations,
};