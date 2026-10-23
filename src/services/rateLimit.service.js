import redisClient from "../config/redis.js";
const slidingWindowScript = `
  local key = KEYS[1]

  local now = tonumber(ARGV[1])
  local windowMs = tonumber(ARGV[2])
  local maxRequests = tonumber(ARGV[3])
  local requestId = ARGV[4]

  local windowStart = now - windowMs

  redis.call("ZREMRANGEBYSCORE", key, "-inf", windowStart)

  local requestCount = redis.call("ZCARD", key)

  if requestCount >= maxRequests then
    local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
    local retryAfterMs = 0

    if #oldest >= 2 then
      retryAfterMs = math.max(0, tonumber(oldest[2]) + windowMs - now)
    end

    return {1, requestCount, retryAfterMs}
  end

  redis.call("ZADD", key, now, requestId)
  redis.call("PEXPIRE", key, windowMs)

  return {0, requestCount + 1, 0}
`;

export async function checkSlidingWindowLimit({
  key,
  windowMs,
  maxRequests,
  requestId,
}) {
  if (!redisClient?.isReady) {
    throw new Error("Redis client is not ready");
  }

  if (
    typeof key !== "string" ||
    key.trim() === "" ||
    typeof requestId !== "string" ||
    requestId.trim() === "" ||
    !Number.isInteger(windowMs) ||
    windowMs <= 0 ||
    !Number.isInteger(maxRequests) ||
    maxRequests <= 0
  ) {
    throw new TypeError("Invalid sliding window rate-limit configuration");
  }

  const result = await redisClient.eval(slidingWindowScript, {
    keys: [key],
    arguments: [
      String(Date.now()),
      String(windowMs),
      String(maxRequests),
      requestId,
    ],
  });

  return {
    allowed: result[0] === 0,
    requestCount: result[1],
    retryAfterMs: result[2],
  };
}
