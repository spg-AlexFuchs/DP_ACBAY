const { loginUser, registerUser, getCurrentUser } = require("../services/auth.services");

function maskSensitiveAuthBody(body) {
  if (!body || typeof body !== "object") return body;
  const masked = { ...body };

  ["password", "newPassword", "confirmPassword"].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(masked, key) && masked[key] !== undefined) {
      masked[key] = "***";
    }
  });

  return masked;
}

function mapLoginError(error) {
  switch (error?.code) {
    case "MISSING_CREDENTIALS":
      return { status: 400, message: "Email und Passwort sind erforderlich." };
    case "INVALID_EMAIL_FORMAT":
      return { status: 400, message: "Bitte eine gueltige Email eingeben." };
    case "USER_NOT_FOUND":
      return { status: 401, message: "User existiert nicht." };
    case "INVALID_PASSWORD":
      return { status: 401, message: "Falsches Passwort." };
    default:
      return { status: 500, message: "Login fehlgeschlagen." };
  }
}

function mapRegisterError(error) {
  switch (error?.code) {
    case "MISSING_CREDENTIALS":
      return { status: 400, message: "Email und Passwort sind erforderlich." };
    case "INVALID_EMAIL_FORMAT":
      return { status: 400, message: "Bitte eine gueltige Email eingeben." };
    case "PASSWORD_TOO_SHORT":
      return { status: 400, message: "Passwort ist zu kurz. Mindestens 6 Zeichen." };
    case "EMAIL_EXISTS":
      return { status: 400, message: "Diese Email ist bereits registriert." };
    default:
      return { status: 400, message: error?.message || "Registrierung fehlgeschlagen." };
  }
}

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
    res.json(result);
  } catch (err) {
    const mapped = mapLoginError(err);
    res.status(mapped.status).json({ error: mapped.message });
  }
}

/**
 * Login user - HTMX response
 */
async function loginHx(req, res) {
  console.log("🔵 loginHx called", { body: maskSensitiveAuthBody(req.body) });
  
  const { email, password } = req.body;
  if (!email || !password) {
    console.log("❌ Missing email or password");
    res.setHeader("HX-Trigger", JSON.stringify({ authError: { message: "Email und Passwort sind erforderlich." } }));
    return res
      .status(200)
      .send(
        `<div class="text-sm text-red-700">Email und Passwort sind erforderlich.</div>`
      );
  }

  try {
    console.log("🟡 Calling loginUser...");
    const result = await loginUser(email, password);

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
    const mapped = mapLoginError(err);
    res.setHeader("HX-Trigger", JSON.stringify({ authError: { message: mapped.message } }));
    return res
      .status(200)
      .send(`<div class="text-sm text-red-700">${mapped.message}</div>`);
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
    const mapped = mapRegisterError(err);
    res.status(mapped.status).json({ error: mapped.message });
  }
}

/**
 * Register user - HTMX response
 */
async function registerHx(req, res) {
  console.log("═══════════════════════════════════════");
  console.log("🔵 REGISTER-HX CALLED");
  console.log("Request Body:", JSON.stringify(maskSensitiveAuthBody(req.body), null, 2));
  console.log("Content-Type:", req.headers["content-type"]);
  console.log("═══════════════════════════════════════");
  
  const { email, password, name } = req.body;
  if (!email || !password) {
    console.log("❌ Missing email or password");
    res.setHeader("HX-Trigger", JSON.stringify({ authError: { message: "Email und Passwort sind erforderlich." } }));
    return res
      .status(200)
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
    const mapped = mapRegisterError(err);
    res.setHeader("HX-Trigger", JSON.stringify({ authError: { message: mapped.message } }));
    return res
      .status(200)
      .send(
        `<div class="text-sm text-red-700">${mapped.message}</div>`
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