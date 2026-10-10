import logger from "./logger.js";
import { LOG_ACTIONS, LOG_STATUSES } from "../constants/logEvents.js";

/**
 * Validates mandatory and optional environment variables at application startup.
 */
export function validateEnv() {
  const requiredEnv = [
    "DB_HOST",
    "DB_USER",
    "DB_NAME",
    "ACCESS_TOKEN_SECRET",
    "REFRESH_TOKEN_SECRET",
  ];

  const optionalIntegrations = [
    { name: "CLOUDINARY_CLOUD_NAME", feature: "Cloudinary Image Upload" },
    { name: "CLOUDINARY_API_KEY", feature: "Cloudinary Image Upload" },
    { name: "CLOUDINARY_API_SECRET", feature: "Cloudinary Image Upload" },
    { name: "GEMINI_API_KEYS", feature: "Google Gemini AI Consultant" },
    { name: "VNP_TMN_CODE", feature: "VNPay Online Payment" },
    { name: "VNP_HASH_SECRET", feature: "VNPay Online Payment" },
  ];

  const missingRequired = requiredEnv.filter((key) => !process.env[key]);

  if (missingRequired.length > 0) {
    const errorMsg = `Missing mandatory environment variables: ${missingRequired.join(", ")}. Please check your .env file.`;
    logger.error(LOG_ACTIONS.SYSTEM.APPLICATION_STARTUP, {
      status: LOG_STATUSES.FAILED,
      reason: "MISSING_ENV_VARS",
      missingKeys: missingRequired,
      message: errorMsg,
    });
    console.error(`\n❌ CRITICAL STARTUP ERROR:\n${errorMsg}\n👉 Tip: Copy .env_example to .env and configure mandatory values.\n`);
    process.exit(1);
  }

  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  const emailFrom = process.env.EMAIL_FROM?.trim();
  if (Boolean(resendApiKey) !== Boolean(emailFrom)) {
    const missingEmailConfig = [
      ["RESEND_API_KEY", resendApiKey],
      ["EMAIL_FROM", emailFrom],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);
    const errorMsg =
      "RESEND_API_KEY and EMAIL_FROM must both be configured to enable the email worker.";

    logger.error(LOG_ACTIONS.SYSTEM.APPLICATION_STARTUP, {
      status: LOG_STATUSES.FAILED,
      reason: "INCOMPLETE_EMAIL_CONFIG",
      missingKeys: missingEmailConfig,
      message: errorMsg,
    });
    console.error(
      `\n❌ CRITICAL STARTUP ERROR:\n${errorMsg}\n👉 Configure both values in your .env file or leave both empty to disable the email worker.\n`,
    );
    process.exit(1);
    return;
  }

  // Check optional external service dependencies
  const missingOptional = optionalIntegrations.filter((item) => !process.env[item.name]);
  if (missingOptional.length > 0) {
    const missingFeatureNames = [...new Set(missingOptional.map((i) => i.feature))];
    console.warn(`\n⚠️  ENVIRONMENT WARNING: Some optional external service keys are not configured.`);
    console.warn(`   Affected features: ${missingFeatureNames.join(", ")}`);
    console.warn(`   Missing keys: ${missingOptional.map((i) => i.name).join(", ")}\n`);
  } else {
    console.log("✅ All environment variables validated successfully.");
  }
}

export default validateEnv;
