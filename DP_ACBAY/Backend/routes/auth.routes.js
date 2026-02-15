const express = require("express");
const {
  login,
  loginHx,
  register,
  registerHx,
  getMe,
} = require("../controllers/auth.controller");
const { auth } = require("../middleware/auth.middleware");

const router = express.Router();

// JSON API endpoints
router.post("/login", login);
router.post("/register", register);
router.get("/me", auth, getMe);

// HTMX endpoints
router.post("/login-hx", loginHx);
router.post("/register-hx", registerHx);

module.exports = router;