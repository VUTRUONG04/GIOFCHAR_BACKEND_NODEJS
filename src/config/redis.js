import { createClient } from "redis";

import logger from "./logger.js";
import { LOG_ACTIONS, LOG_STATUSES } from "../constants/logEvents.js";

const redisClient = createClient({
  url: process.env.REDIS_URL,
});

redisClient.on("error", (error) => {
  logger.error(LOG_ACTIONS.SYSTEM.REDIS_CONNECTION, {
    status: LOG_STATUSES.FAILED,
    reason: error.code || error.name || "REDIS_ERROR",
    message: error.message,
  });
});

export async function connectRedis() {
  if (redisClient.isOpen) return;

  await redisClient.connect();
  await redisClient.ping();

  logger.info(LOG_ACTIONS.SYSTEM.REDIS_CONNECTION, {
    status: LOG_STATUSES.SUCCEEDED,
  });
}

export async function closeRedis() {
  if (!redisClient.isOpen) return;

  await redisClient.close();
}

export default redisClient;
