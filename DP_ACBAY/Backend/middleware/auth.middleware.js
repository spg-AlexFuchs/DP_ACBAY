const { verifyToken, ROLE } = require("../services/auth.services");

/**
 * Authentication middleware
 * Verifies JWT token and attaches user to request
 */
async function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    req.authUser = await verifyToken(token);
    return next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

/**
 * Role-based authorization middleware
 */
function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.authUser) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    if (!allowed.includes(req.authUser.role)) {
      return res.status(403).json({ error: "Insufficient role" });
    }
    return next();
  };
}

module.exports = {
  auth,
  requireRole,
};
