const { loginUser, registerUser, getCurrentUser } = require("../services/auth.services");

/**
 * Login user - JSON response
 */
async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res
      .status(400)
      .json({ error: "Email und Passwort erforderlich" });
  }

  try {
    const result = await loginUser(email, password);
    if (!result) {
      return res
        .status(401)
        .json({ error: "Ungültige Anmeldedaten" });
    }
    res.json(result);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
}

/**
 * Login user - HTMX response
 */
async function loginHx(req, res) {
  console.log("🔵 loginHx called", { body: req.body });
  
  const { email, password } = req.body;
  if (!email || !password) {
    console.log("❌ Missing email or password");
    return res
      .status(400)
      .send(
        `<div class="text-sm text-red-700">Email und Passwort sind erforderlich.</div>`
      );
  }

  try {
    console.log("🟡 Calling loginUser...");
    const result = await loginUser(email, password);
    if (!result) {
      console.log("❌ Login invalid credentials");
      return res
        .status(401)
        .send(`<div class="text-sm text-red-700">Login fehlgeschlagen.</div>`);
    }

    console.log("✅ Login successful");
    res.setHeader(
      "HX-Trigger",
      JSON.stringify({ authChanged: { token: result.token, role: result.role } })
    );
    return res.send(
      `<div class="text-sm text-emerald-700">Login erfolgreich (${result.role}).</div>`
    );
  } catch (err) {
    console.error("❌ Login error:", err.message, err.stack);
    return res
      .status(500)
      .send(`<div class="text-sm text-red-700">Login fehlgeschlagen.</div>`);
  }
}

/**
 * Register user - JSON response
 */
async function register(req, res) {
  const { email, password, name } = req.body;
  if (!email || !password) {
    return res
      .status(400)
      .json({ error: "Email und Passwort erforderlich" });
  }

  try {
    const result = await registerUser(email, password, name);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * Register user - HTMX response
 */
async function registerHx(req, res) {
  console.log("═══════════════════════════════════════");
  console.log("🔵 REGISTER-HX CALLED");
  console.log("Request Body:", JSON.stringify(req.body, null, 2));
  console.log("Content-Type:", req.headers["content-type"]);
  console.log("═══════════════════════════════════════");
  
  const { email, password, name } = req.body;
  if (!email || !password) {
    console.log("❌ Missing email or password");
    return res
      .status(400)
      .send(
        `<div class="text-sm text-red-700">Email und Passwort sind erforderlich.</div>`
      );
  }

  try {
    console.log("🟡 Calling registerUser...");
    const result = await registerUser(email, password, name);
    const token = result.token;
    
    console.log("✅ Registration successful");
    res.setHeader(
      "HX-Trigger",
      JSON.stringify({ authChanged: { token, role: result.role } })
    );
    return res.send(
      `<div class="text-sm text-emerald-700">Registrierung erfolgreich (${result.role}).</div>`
    );
  } catch (err) {
    console.error("❌ Register error:", err.message, err.stack);
    return res
      .status(400)
      .send(
        `<div class="text-sm text-red-700">${err.message || "Registrierung fehlgeschlagen."}</div>`
      );
  }
}

/**
 * Get current user info
 */
async function getMe(req, res) {
  try {
    const user = await getCurrentUser(req.authUser.id);
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  login,
  loginHx,
  register,
  registerHx,
  getMe,
};