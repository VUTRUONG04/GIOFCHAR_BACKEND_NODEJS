import dotenv from "dotenv";

dotenv.config({ path: ".env.test", override: true });

process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.CLIENT_ORIGINS = process.env.CLIENT_ORIGINS || "http://localhost:3000";
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret";
process.env.DB_HOST = process.env.DB_HOST || "127.0.0.1";
process.env.DB_USER = process.env.DB_USER || "root";
process.env.DB_PASSWORD = process.env.DB_PASSWORD || "root";
process.env.DB_NAME = process.env.DB_NAME || "giofchar_test";
process.env.DB_PORT = process.env.DB_PORT || "3306";

if (!process.env.DB_NAME.toLowerCase().endsWith("_test")) {
	throw new Error("Tests require a dedicated database whose name ends with '_test'. Configure .env.test.");
}
