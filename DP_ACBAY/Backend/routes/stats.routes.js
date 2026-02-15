const express = require("express");
const {
  getPublicSurveys,
  getUserSurveys,
  getMySurveys,
  getEmissionFactors,
  getPublicAggregations,
  getHrAggregations,
} = require("../controllers/stats.controller");
const { auth, requireRole } = require("../middleware/auth.middleware");
const { ROLE } = require("../services/auth.services");

const router = express.Router();

// Public endpoints
router.get("/public", getPublicSurveys);
router.get("/emission-factors", getEmissionFactors);
router.get("/aggregations", getPublicAggregations);

// Authenticated endpoints
router.get("/", auth, getUserSurveys);
router.get("/me", auth, requireRole(ROLE.EMPLOYEE), getMySurveys);

// HR/Admin aggregations
router.get(
  "/hr/aggregations",
  auth,
  requireRole(ROLE.HR, ROLE.ADMIN, ROLE.SUPER_ADMIN),
  getHrAggregations
);

module.exports = router;
