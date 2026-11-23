require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const db = new Database(path.join(__dirname, "novahost.db"));
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error("Set JWT_SECRET to a random value of at least 32 characters in .env");
  process.exit(1);
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || false }));
app.use(express.json({ limit: "30kb" }));
app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, limit: 180 }));
app.use(express.static(path.join(__dirname, "public")));

db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'customer', balance INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS servers (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, ptero_server_id INTEGER,
 identifier TEXT, name TEXT NOT NULL, plan_key TEXT NOT NULL, ram_mb INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'provisioning', panel_url TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS orders (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, plan_key TEXT NOT NULL,
 amount INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

const plans = {
  free: { name: "Free", price: 0, ram: 2048, disk: 5120, cpu: 100, servers: 1, databases: 0, backups: 1 },
  starter: { name: "Starter", price: 149, ram: 4096, disk: 10240, cpu: 150, servers: 1, databases: 1, backups: 2 },
  pro: { name: "Pro", price: 299, ram: 8192, disk: 20480, cpu: 250, servers: 2, databases: 2, backups: 3 },
  premium: { name: "Premium", price: 599, ram: 16384, disk: 40960, cpu: 400, servers: 3, databases: 5, backups: 5 }
};

const stmt = {
  userByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
  userById: db.prepare("SELECT id,username,email,role,balance,created_at FROM users WHERE id = ?"),
  createUser: db.prepare("INSERT INTO users(username,email,password_hash,role,balance) VALUES(?,?,?,?,?)"),
  userCount: db.prepare("SELECT COUNT(*) AS n FROM users WHERE id = ?"),
  serversForUser: db.prepare("SELECT * FROM servers WHERE user_id = ? ORDER BY id DESC"),
  allUsers: db.prepare("SELECT id,username,email,role,balance,created_at FROM users ORDER BY id DESC"),
  allServers: db.prepare("SELECT s.*,u.email FROM servers s JOIN users u ON u.id=s.user_id ORDER BY s.id DESC"),
  createServer: db.prepare("INSERT INTO servers(user_id,ptero_server_id,identifier,name,plan_key,ram_mb,status,panel_url) VALUES(?,?,?,?,?,?,?,?)"),
  createOrder: db.prepare("INSERT INTO orders(user_id,plan_key,amount,status) VALUES(?,?,?,'pending')"),
  orders: db.prepare("SELECT o.*,u.email FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC")
};

function tokenFor(user) {
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: "12h" });
}
function auth(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: "Please log in again." }); }
}
function admin(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin access required." });
  next();
}
function safeUser(row) {
  return { id: row.id, username: row.username, email: row.email, role: row.role, balance: row.balance, created_at: row.created_at };
}
function configReady() {
  return process.env.PTERO_URL && process.env.PTERO_APPLICATION_KEY &&
    process.env.PTERO_EGG_ID && process.env.PTERO_ALLOCATION_ID;
}
async function ptero(endpoint, method = "GET", body) {
  if (!configReady()) throw new Error("Pterodactyl is not configured yet. Add the Pterodactyl settings to .env.");
  const base = process.env.PTERO_URL.replace(/\/+$/, "");
  const response = await fetch(base + "/api/application" + endpoint, {
    method,
    headers: {
      Authorization: "Bearer " + process.env.PTERO_APPLICATION_KEY,
      Accept: "Application/vnd.pterodactyl.v1+json",
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.errors?.map(e => e.detail || e.code).join("; ") || `Pterodactyl returned ${response.status}`;
    throw new Error(detail);
  }
  return data;
}

app.get("/api/health", (req, res) => res.json({ ok: true, service: "NovaHost API", pterodactylConfigured: !!configReady() }));
app.get("/api/plans", (req, res) => res.json(Object.entries(plans).map(([key,p]) => ({ key, ...p }))));

app.post("/api/auth/register", async (req, res) => {
  const { username, email, password } = req.body || {};
  if (!username || username.trim().length < 3 || username.length > 24) return res.status(400).json({ error: "Username must be 3–24 characters." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "")) return res.status(400).json({ error: "Enter a valid email address." });
  if (typeof password !== "string" || password.length < 10 || password.length > 100) return res.status(400).json({ error: "Password must be 10–100 characters." });
  if (stmt.userByEmail.get(email.toLowerCase())) return res.status(409).json({ error: "That email is already registered." });
  const hash = await bcrypt.hash(password, 12);
  const result = stmt.createUser.run(username.trim(), email.toLowerCase(), hash, "customer", 0);
  const user = stmt.userById.get(result.lastInsertRowid);
  res.status(201).json({ token: tokenFor(user), user });
});
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  const user = stmt.userByEmail.get((email || "").toLowerCase());
  if (!user || !(await bcrypt.compare(password || "", user.password_hash))) return res.status(401).json({ error: "Incorrect email or password." });
  res.json({ token: tokenFor(user), user: safeUser(user) });
});
app.get("/api/me", auth, (req, res) => {
  const user = stmt.userById.get(req.user.id);
  if (!user) return res.status(404).json({ error: "Account not found." });
  res.json({ user, servers: stmt.serversForUser.all(user.id), plans });
});

app.post("/api/orders", auth, (req, res) => {
  const plan = plans[req.body?.plan];
  if (!plan || plan.price === 0) return res.status(400).json({ error: "Choose a paid plan for an order." });
  const result = stmt.createOrder.run(req.user.id, req.body.plan, plan.price);
  res.status(201).json({ message: "Order created. An admin must confirm payment before provisioning.", orderId: result.lastInsertRowid });
});

app.post("/api/servers", auth, async (req, res) => {
  try {
    const key = req.body?.plan;
    const plan = plans[key];
    const name = String(req.body?.name || "My Minecraft Server").trim().slice(0, 40);
    if (!plan) return res.status(400).json({ error: "Invalid plan." });
    const existing = stmt.serversForUser.all(req.user.id);
    if (existing.length >= plan.servers && key !== "free") return res.status(400).json({ error: "Your account has reached its server limit for this plan." });
    if (key === "free" && existing.some(s => s.plan_key === "free")) return res.status(400).json({ error: "Free plan is limited to one server per account." });
    const user = stmt.userById.get(req.user.id);
    if (user.balance < plan.price) return res.status(402).json({ error: `Insufficient account credit. Your balance is ₹${user.balance}; this plan costs ₹${plan.price}.` });
    const panelBase = process.env.PTERO_URL?.replace(/\/+$/, "");
    const pteroUser = await ptero("/users", "POST", {
      email: user.email, username: ("nh" + user.id + user.email.split("@")[0]).toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24),
      first_name: user.username.slice(0, 24), last_name: "NovaHost", password: require("crypto").randomBytes(18).toString("base64url"),
      root_admin: false, language: "en"
    });
    const pteroUserId = pteroUser.attributes.id;
    const created = await ptero("/servers", "POST", {
      name, user: pteroUserId, egg: Number(process.env.PTERO_EGG_ID),
      docker_image: process.env.PTERO_DOCKER_IMAGE || "ghcr.io/pterodactyl/yolks:java_21",
      startup: process.env.PTERO_STARTUP || "java -Xms128M -XX:MaxRAMPercentage=95.0 -jar {{SERVER_JARFILE}}",
      environment: { SERVER_JARFILE: process.env.PTERO_SERVER_JARFILE || "server.jar", BUILD_NUMBER: "latest", VANILLA_VERSION: "latest" },
      limits: { memory: plan.ram, swap: 0, disk: plan.disk, io: 500, cpu: plan.cpu },
      feature_limits: { databases: plan.databases, allocations: 1, backups: plan.backups },
      allocation: { default: Number(process.env.PTERO_ALLOCATION_ID) },
      deploy: process.env.PTERO_LOCATION_ID ? { locations: [Number(process.env.PTERO_LOCATION_ID)], dedicated_ip: false, port_range: [] } : undefined,
      start_on_completion: false
    });
    const s = created.attributes;
    db.prepare("UPDATE users SET balance=balance-? WHERE id=?").run(plan.price, req.user.id);
    stmt.createServer.run(req.user.id, s.id, s.identifier, name, key, plan.ram, "created", panelBase);
    res.status(201).json({ message: "Server created successfully.", server: { id: s.id, identifier: s.identifier, name, panel_url: panelBase } });
  } catch (e) {
    console.error("Provisioning error:", e.message);
    res.status(502).json({ error: e.message });
  }
});

app.get("/api/admin/overview", auth, admin, (req, res) => {
  res.json({
    users: stmt.allUsers.all(), servers: stmt.allServers.all(), orders: stmt.orders.all(),
    stats: { users: db.prepare("SELECT COUNT(*) n FROM users").get().n, servers: db.prepare("SELECT COUNT(*) n FROM servers").get().n,
      pendingOrders: db.prepare("SELECT COUNT(*) n FROM orders WHERE status='pending'").get().n }
  });
});
app.post("/api/admin/users/:id/credit", auth, admin, (req, res) => {
  const amount = Number(req.body?.amount);
  if (!Number.isInteger(amount) || amount < 1 || amount > 100000) return res.status(400).json({ error: "Credit amount must be ₹1–₹100000." });
  const result = db.prepare("UPDATE users SET balance=balance+? WHERE id=?").run(amount, Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: "User not found." });
  res.json({ message: `₹${amount} credit added.` });
});
app.post("/api/admin/orders/:id/approve", auth, admin, (req, res) => {
  const order = db.prepare("SELECT * FROM orders WHERE id=? AND status='pending'").get(Number(req.params.id));
  if (!order) return res.status(404).json({ error: "Pending order not found." });
  const tx = db.transaction(() => {
    db.prepare("UPDATE orders SET status='approved' WHERE id=?").run(order.id);
    db.prepare("UPDATE users SET balance=balance+? WHERE id=?").run(order.amount, order.user_id);
  });
  tx();
  res.json({ message: "Order approved and account credit added. The customer can now provision their server." });
});
app.post("/api/admin/users/:id/suspend", auth, admin, (req, res) => {
  const userId = Number(req.params.id);
  const result = db.prepare("UPDATE users SET role='suspended' WHERE id=? AND role!='admin'").run(userId);
  if (!result.changes) return res.status(404).json({ error: "User not found or cannot suspend admin." });
  res.json({ message: "Account suspended." });
});
app.get("/api/admin/config-status", auth, admin, (req, res) => res.json({
  pterodactylConfigured: !!configReady(),
  required: ["PTERO_URL","PTERO_APPLICATION_KEY","PTERO_EGG_ID","PTERO_ALLOCATION_ID"]
}));

async function bootstrap() {
  const email = (process.env.ADMIN_EMAIL || "admin@novahost.local").toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 14) {
    console.warn("Admin account not seeded: set ADMIN_PASSWORD to at least 14 characters in .env.");
  } else if (!stmt.userByEmail.get(email)) {
    const hash = await bcrypt.hash(password, 12);
    stmt.createUser.run("NovaHost Admin", email, hash, "admin", 0);
    console.log("Seeded admin account:", email);
  }
}
bootstrap().then(() => app.listen(PORT, () => console.log(`NovaHost running on http://localhost:${PORT}`)));
