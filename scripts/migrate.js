import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigrations() {
  console.log("🚀 Starting database migrations...");

  const host = process.env.DB_HOST || "localhost";
  const user = process.env.DB_USER || "root";
  const password = process.env.DB_PASSWORD || "";
  const database = process.env.DB_NAME || "GIOFCHAR";
  const port = Number(process.env.DB_PORT) || 3306;

  // 1. Connect to MySQL server (without specifying DB first to ensure DB exists)
  let connection;
  try {
    connection = await mysql.createConnection({ host, user, password, port, multipleStatements: true });
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
    await connection.changeUser({ database });
    console.log(`✅ Connected to database '${database}' on ${host}:${port}`);
  } catch (error) {
    console.error("❌ Failed to connect to MySQL database:", error.message);
    process.exit(1);
  }

  try {
    // 2. Ensure schema_migrations tracking table exists
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`schema_migrations\` (
        \`version\` VARCHAR(255) PRIMARY KEY,
        \`applied_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 3. Get applied migration versions
    const [rows] = await connection.query("SELECT version FROM `schema_migrations`");
    const appliedVersions = new Set(rows.map((row) => row.version));

    // 4. Read migration files
    const migrationsDir = path.join(__dirname, "..", "migrations");
    if (!fs.existsSync(migrationsDir)) {
      fs.mkdirSync(migrationsDir, { recursive: true });
    }

    const files = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort();

    if (files.length === 0) {
      console.log("ℹ️ No migration files found in ./migrations");
      await connection.end();
      return;
    }

    let appliedCount = 0;
    for (const file of files) {
      if (appliedVersions.has(file)) {
        console.log(`  - ⏩ Migration '${file}' already applied. Skipping.`);
        continue;
      }

      console.log(`  - ⚡ Executing migration '${file}'...`);
      const filePath = path.join(migrationsDir, file);
      const sqlContent = fs.readFileSync(filePath, "utf-8");

      if (sqlContent.trim().length > 0) {
        await connection.query(sqlContent);
      }

      await connection.query("INSERT INTO `schema_migrations` (`version`) VALUES (?)", [file]);
      console.log(`    ✅ Successfully applied '${file}'`);
      appliedCount++;
    }

    if (appliedCount === 0) {
      console.log("🎉 Database is up to date! No new migrations to run.");
    } else {
      console.log(`🎉 Migrations completed successfully! (${appliedCount} file(s) executed)`);
    }
  } catch (error) {
    console.error("❌ Error executing migration script:", error);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

runMigrations();
