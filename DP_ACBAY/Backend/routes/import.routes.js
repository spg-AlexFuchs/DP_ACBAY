const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { auth, requireRole } = require("../middleware/auth.middleware");
const { ROLE } = require("../services/auth.services");
const {
  importEmissionFactors,
  importSurvey,
  ensureDefaultUser,
} = require("../services/import/import-excel");

const router = express.Router();

// Setup upload directory
const uploadDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      cb(null, `${Date.now()}_${safeName}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

/**
 * Import data from Excel files
 * POST /import
 */
router.post("/", auth, requireRole(ROLE.ADMIN, ROLE.SUPER_ADMIN), async (req, res) => {
  try {
    const userId = await ensureDefaultUser();
    const factors = await importEmissionFactors();
    if (userId && factors.length) {
      await importSurvey(factors, userId);
    }
    return res.json({
      message: "Import erfolgreich",
      imported: {
        factors: factors.length,
      },
    });
  } catch (err) {
    console.error("Import failed:", err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;