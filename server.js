
const express = require("express");
const { Pool } = require("pg");
const path = require("path");
const session = require("express-session");
const bcrypt = require("bcrypt");

require("dotenv").config({
  path: path.join(__dirname, "..", ".env")
});

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

const issueTypes = [
  "Pothole",
  "Damaged Streetlight",
  "Traffic Congestion",
  "Road Damage",
  "Waterlogging",
  "Road Hazard"
];

const statuses = ["Pending", "In Progress", "Resolved"];

app.use(express.json());

app.use(session({
  name: "roadwatch.sid",
  secret: process.env.SESSION_SECRET || "development-only-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 4 * 60 * 60 * 1000
  }
}));

app.use(express.static(path.join(__dirname, "..", "public")));

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.admin) {
    return res.status(401).json({
      error: "Please log in as an administrator first."
    });
  }

  next();
}

// Create the admin table and initial admin account.
async function setupAdmin() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  const secret = process.env.SESSION_SECRET;

  if (!username || !password || password.length < 7) {
    throw new Error(
      "Set ADMIN_USERNAME and a strong ADMIN_PASSWORD in the root .env file."
    );
  }

  if (!secret || secret.length < 8) {
    throw new Error(
      "SESSION_SECRET must contain at least 32 characters in the root .env file."
    );
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const result = await pool.query(
    "SELECT id FROM app_users WHERE username = $1",
    [username]
  );

  if (result.rows.length === 0) {
    const passwordHash = await bcrypt.hash(password, 12);

    await pool.query(
      "INSERT INTO app_users (username, password_hash) VALUES ($1, $2)",
      [username, passwordHash]
    );

    console.log("Admin account created.");
  } else {
    console.log("Admin account already exists.");
  }
}

// Return the date/time in a readable format in Pakistan Standard Time.
function formatPakistanTime(value) {
  return new Intl.DateTimeFormat("en-PK", {
    timeZone: "Asia/Karachi",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  }).format(new Date(value));
}

// Validate report details before saving.
function checkReport(body) {
  const issueType = String(body.issue_type || "").trim();
  const description = String(body.description || "").trim();

  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);

  if (!issueTypes.includes(issueType)) {
    return { error: "Please select a valid issue type." };
  }

  if (!description || description.length > 500) {
    return { error: "Description is required and must be under 500 characters." };
  }

  if (
    body.latitude === "" ||
    body.latitude === undefined ||
    body.latitude === null ||
    body.longitude === "" ||
    body.longitude === undefined ||
    body.longitude === null ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return { error: "Please enter valid coordinates." };
  }

  return { issueType, description, latitude, longitude };
}

// API home.
app.get("/api", (req, res) => {
  res.json({ message: "RoadWatch WebGIS API is running." });
});

// Check current login status.
app.get("/api/me", (req, res) => {
  res.json({
    loggedIn: Boolean(req.session && req.session.admin),
    username: req.session?.admin?.username || null
  });
});

// Admin login.
app.post("/api/login", async (req, res, next) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    if (!username || !password) {
      return res.status(400).json({
        error: "Enter your username and password."
      });
    }

    const result = await pool.query(
      "SELECT id, username, password_hash FROM app_users WHERE username = $1",
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: "Incorrect username or password."
      });
    }

    const admin = result.rows[0];
    const correctPassword = await bcrypt.compare(
      password,
      admin.password_hash
    );

    if (!correctPassword) {
      return res.status(401).json({
        error: "Incorrect username or password."
      });
    }

    req.session.regenerate((error) => {
      if (error) return next(error);

      req.session.admin = {
        id: admin.id,
        username: admin.username
      };

      req.session.save((saveError) => {
        if (saveError) return next(saveError);

        res.json({
          message: "Login successful.",
          username: admin.username
        });
      });
    });
  } catch (error) {
    next(error);
  }
});

// Admin logout.
app.post("/api/logout", (req, res, next) => {
  if (!req.session) {
    return res.json({ message: "Already logged out." });
  }

  req.session.destroy((error) => {
    if (error) return next(error);

    res.clearCookie("roadwatch.sid", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    });

    res.json({ message: "Logout successful." });
  });
});

// Get reports, with optional issue-type and status filters.
app.get("/api/reports", async (req, res, next) => {
  try {
    const conditions = [];
    const values = [];

    if (req.query.type) {
      if (!issueTypes.includes(req.query.type)) {
        return res.status(400).json({ error: "Invalid issue type." });
      }

      values.push(req.query.type);
      conditions.push(`issue_type = $${values.length}`);
    }

    if (req.query.status) {
      if (!statuses.includes(req.query.status)) {
        return res.status(400).json({ error: "Invalid status." });
      }

      values.push(req.query.status);
      conditions.push(`status = $${values.length}`);
    }

    const where = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const result = await pool.query(`
      SELECT
        id,
        issue_type,
        description,
        status,
        ST_Y(geom) AS latitude,
        ST_X(geom) AS longitude,
        created_at,
        updated_at
      FROM road_reports
      ${where}
      ORDER BY created_at DESC, id DESC
    `, values);

    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

// Get one report by ID.
app.get("/api/reports/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "Invalid report ID." });
    }

    const result = await pool.query(`
      SELECT
        id,
        issue_type,
        description,
        status,
        ST_Y(geom) AS latitude,
        ST_X(geom) AS longitude,
        created_at,
        updated_at
      FROM road_reports
      WHERE id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Report not found." });
    }

    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

// Dashboard statistics.
app.get("/api/stats", async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'Pending')::int AS pending,
        COUNT(*) FILTER (WHERE status = 'In Progress')::int AS in_progress,
        COUNT(*) FILTER (WHERE status = 'Resolved')::int AS resolved
      FROM road_reports
    `);

    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

// Add a report. Only an admin can do this.
app.post("/api/reports", requireAdmin, async (req, res, next) => {
  try {
    const report = checkReport(req.body);

    if (report.error) {
      return res.status(400).json({ error: report.error });
    }

    const result = await pool.query(`
      INSERT INTO road_reports
        (issue_type, description, status, geom, created_at, updated_at)
      VALUES
        ($1, $2, 'Pending',
         ST_SetSRID(ST_MakePoint($3, $4), 4326),
         NOW(), NOW())
      RETURNING
        id, issue_type, description, status,
        ST_Y(geom) AS latitude,
        ST_X(geom) AS longitude,
        created_at, updated_at
    `, [
      report.issueType,
      report.description,
      report.longitude,
      report.latitude
    ]);

    res.status(201).json({
      message: "Report added successfully.",
      report: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

// Update report status. Only an admin can do this.
app.patch("/api/reports/:id", requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const status = String(req.body.status || "");

    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "Invalid report ID." });
    }

    if (!statuses.includes(status)) {
      return res.status(400).json({ error: "Please select a valid status." });
    }

    const result = await pool.query(`
      UPDATE road_reports
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING
        id, issue_type, description, status,
        ST_Y(geom) AS latitude,
        ST_X(geom) AS longitude,
        created_at, updated_at
    `, [status, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Report not found." });
    }

    res.json({
      message: "Report updated successfully.",
      report: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

// Return useful error messages without exposing internal database details.
app.use((error, req, res, next) => {
  console.error(error);

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    error: "Something went wrong. Check the server terminal."
  });
});

async function startServer() {
  try {
    await pool.query("SELECT 1");
    console.log("PostgreSQL connection successful.");

    await setupAdmin();

    app.listen(PORT, () => {
      console.log(`RoadWatch running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Could not start the server:", error.message);
    process.exitCode = 1;
  }
}

startServer();
