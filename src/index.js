import dotenv from "dotenv";
dotenv.config();

import { validateEnv } from "./config/env.js";
validateEnv();

import app from "./app.js";
import pool, { checkDBConnection } from "./config/db.js";
import logger from "./config/logger.js";
import ResendProvider from "./services/email/ResendProvider.js";
import EmailWorker from "./workers/email.worker.js";
import {
  LOG_ACTIONS,
  LOG_STATUSES,
} from "./constants/logEvents.js";

const port = process.env.PORT || 8081;

let server;
let emailWorker;
let isShuttingDown = false;
const SHUTDOWN_TIMEOUT_MS = 10_000;

function closeHttpServer() {
  return new Promise((resolve, reject) => {
    if (!server?.listening) {
      return resolve();
    }

    server.close((error) => {
      if (error) return reject(error);
      return resolve();
    });
  });
}

async function shutdown({ reason, exitCode }) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(LOG_ACTIONS.SYSTEM.APPLICATION_SHUTDOWN, {
    status: LOG_STATUSES.STARTED,
    reason,
    exitCode,
  });

  const forceShutdownTimer = setTimeout(() => {
    logger.error(LOG_ACTIONS.SYSTEM.APPLICATION_SHUTDOWN, {
      status: LOG_STATUSES.FAILED,
      reason: "SHUTDOWN_TIMEOUT",
      timeoutMs: SHUTDOWN_TIMEOUT_MS,
    });
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  forceShutdownTimer.unref();

  let shutdownFailed = false;

  try {
    try {
      await closeHttpServer();
    } catch (error) {
      logger.error(LOG_ACTIONS.SYSTEM.APPLICATION_SHUTDOWN, {
        status: LOG_STATUSES.FAILED,
        reason: error.code || "SHUTDOWN_FAILED",
        operation: "close_http_server",
        message: error.message,
      });
      shutdownFailed = true;
    }

    try {
      if (emailWorker) {
        await emailWorker.stop();
        logger.info(LOG_ACTIONS.EMAIL.WORKER, {
          status: LOG_STATUSES.COMPLETED,
          operation: "stop",
        });
      }
    } catch (error) {
      logger.error(LOG_ACTIONS.EMAIL.WORKER, {
        status: LOG_STATUSES.FAILED,
        operation: "stop",
        reason: error.code || error.name || "WORKER_STOP_FAILED",
        message: error.message,
      });
      shutdownFailed = true;
    }

    try {
      await pool.end();
    } catch (error) {
      logger.error(LOG_ACTIONS.SYSTEM.APPLICATION_SHUTDOWN, {
        status: LOG_STATUSES.FAILED,
        reason: error.code || "SHUTDOWN_FAILED",
        operation: "close_database_pool",
        message: error.message,
      });
      shutdownFailed = true;
    }

    if (!shutdownFailed) {
      logger.info(LOG_ACTIONS.SYSTEM.APPLICATION_SHUTDOWN, {
        status: LOG_STATUSES.COMPLETED,
        reason,
        exitCode,
      });
    } else {
      exitCode = 1;
    }
  } finally {
    clearTimeout(forceShutdownTimer);
    process.exitCode = exitCode;
  }
}

function createEmailWorker() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();

  if (!apiKey && !from) {
    logger.info(LOG_ACTIONS.EMAIL.WORKER, {
      status: LOG_STATUSES.SKIPPED,
      reason: "EMAIL_PROVIDER_NOT_CONFIGURED",
    });
    return null;
  }

  return new EmailWorker(new ResendProvider({ apiKey, from }));
}

function handleEmailWorkerError(error) {
  logger.error(LOG_ACTIONS.EMAIL.WORKER, {
    status: LOG_STATUSES.FAILED,
    operation: "run",
    reason: error.code || error.name || "WORKER_RUN_FAILED",
    message: error.message,
    stack: error.stack,
  });

  void shutdown({
    reason: "email_worker_failed",
    exitCode: 1,
  });
}

function startEmailWorker() {
  logger.info(LOG_ACTIONS.EMAIL.WORKER, {
    status: LOG_STATUSES.STARTED,
    operation: "start",
  });

  let runPromise;
  try {
    runPromise = emailWorker.start();
  } catch (error) {
    handleEmailWorkerError(error);
    return;
  }

  runPromise.catch(handleEmailWorkerError);
}

function normalizeError(reason) {
  if (reason instanceof Error) return reason;

  return new Error(
    typeof reason === "string" ? reason : "Unknown rejected promise",
  );
}

function handleFatalError(type, reason) {
  if (isShuttingDown) return;

  const error = normalizeError(reason);

  logger.error(LOG_ACTIONS.SYSTEM.PROCESS_ERROR, {
    status: LOG_STATUSES.FAILED,
    type,
    reason: error.code || "UNEXPECTED_ERROR",
    message: error.message,
    stack: error.stack,
  });

  void shutdown({
    reason: type,
    exitCode: 1,
  });
}

function handleStartupError(error) {
  logger.error(LOG_ACTIONS.SYSTEM.APPLICATION_STARTUP, {
    status: LOG_STATUSES.FAILED,
    phase: "http_listen",
    reason: error.code || "STARTUP_FAILED",
    message: error.message,
  });

  void shutdown({
    reason: "startup_error",
    exitCode: 1,
  });
}

async function startApplication() {
  let phase = "database_connection";
  try {
    await checkDBConnection();

    phase = "email_worker_configuration";
    emailWorker = createEmailWorker();

    phase = "http_listen";
    server = app.listen(port, () => {
      logger.info(LOG_ACTIONS.SYSTEM.APPLICATION_STARTUP, {
        status: LOG_STATUSES.SUCCEEDED,
        port,
        environment: process.env.NODE_ENV,
      });
      if (emailWorker) startEmailWorker();
    });
    server.on("error", handleStartupError);
  } catch (error) {
    logger.error(LOG_ACTIONS.SYSTEM.APPLICATION_STARTUP, {
      status: LOG_STATUSES.FAILED,
      phase,
      ...(phase === "database_connection" ? { databaseType: "mysql" } : {}),
      reason: error.code || "STARTUP_FAILED",
      message: error.message,
    });

    try {
      await pool.end();
    } catch (closeError) {
      logger.error(LOG_ACTIONS.SYSTEM.APPLICATION_SHUTDOWN, {
        status: LOG_STATUSES.FAILED,
        operation: "close_database_pool",
        reason: closeError.code || "SHUTDOWN_FAILED",
        message: closeError.message,
      });
    } finally {
      process.exitCode = 1;
    }
  }
}

process.on("SIGTERM", () => {
  void shutdown({
    reason: "SIGTERM",
    exitCode: 0,
  });
});

process.on("SIGINT", () => {
  void shutdown({
    reason: "SIGINT",
    exitCode: 0,
  });
});

process.on("uncaughtException", (error) => {
  handleFatalError("uncaught_exception", error);
});

process.on("unhandledRejection", (reason) => {
  handleFatalError("unhandled_rejection", reason);
});

void startApplication();
