const express = require("express");
const {
  getPublicSummary,
  getPrivateSummary,
  getPublicSurveys,
  getPrivateSurveys,
} = require("../controllers/partials.controller");
const { auth } = require("../middleware/auth.middleware");

const router = express.Router();

// Public partials (no auth required)
router.get("/summary/public", getPublicSummary);
router.get("/surveys/public", getPublicSurveys);

// Private partials (auth required)
router.get("/summary/private", auth, getPrivateSummary);
router.get("/surveys/private", auth, getPrivateSurveys);

module.exports = router;
