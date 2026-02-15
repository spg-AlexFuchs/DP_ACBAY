const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || "import@localhost";
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || "Admin123!";

const ROLE = {
  EMPLOYEE: "EMPLOYEE",
  HR: "HR",
  ADMIN: "ADMIN",
  SUPER_ADMIN: "SUPER_ADMIN",
};

/**
 * Generate JWT token for user
 */
function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

/**
 * Register a new user
 */
async function registerUser(email, password, name = null) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new Error("Email already exists");
  }

  const hash = await bcrypt.hash(password, 10);
  const role = email === SUPER_ADMIN_EMAIL ? ROLE.SUPER_ADMIN : ROLE.EMPLOYEE;

  const user = await prisma.user.create({
    data: { email, password: hash, name: name || null, role },
  });

  return {
    token: signToken(user),
    role: user.role,
    id: user.id,
    email: user.email,
  };
}

/**
 * Login user with email and password
 */
async function loginUser(email, password) {
  if (!email || !password) {
    throw new Error("Email and password required");
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new Error("Invalid credentials");
  }

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) {
    throw new Error("Invalid credentials");
  }

  return {
    token: signToken(user),
    role: user.role,
    id: user.id,
    email: user.email,
  };
}

/**
 * Verify JWT token and get user
 */
async function verifyToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });
    if (!user) throw new Error("Invalid token");
    return user;
  } catch (err) {
    throw new Error("Invalid token");
  }
}

/**
 * Get current user info
 */
async function getCurrentUser(userId) {
  return await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
    },
  });
}

/**
 * Ensure initial admin user exists
 */
async function ensureInitialAdmin() {
  const adminCount = await prisma.user.count({
    where: { role: { in: [ROLE.ADMIN, ROLE.SUPER_ADMIN] } },
  });
  if (adminCount > 0) return;

  const byEmail = await prisma.user.findUnique({
    where: { email: SUPER_ADMIN_EMAIL },
  });
  if (byEmail) {
    const passwordNeedsHash = !byEmail.password.startsWith("$2");
    const pwd = passwordNeedsHash
      ? await bcrypt.hash(SUPER_ADMIN_PASSWORD, 10)
      : byEmail.password;
    await prisma.user.update({
      where: { id: byEmail.id },
      data: { role: ROLE.SUPER_ADMIN, password: pwd },
    });
    return;
  }

  const hash = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 10);
  await prisma.user.create({
    data: {
      email: SUPER_ADMIN_EMAIL,
      password: hash,
      name: "Bootstrap Admin",
      role: ROLE.SUPER_ADMIN,
    },
  });
}

module.exports = {
  signToken,
  registerUser,
  loginUser,
  verifyToken,
  getCurrentUser,
  ensureInitialAdmin,
  ROLE,
  JWT_SECRET,
};