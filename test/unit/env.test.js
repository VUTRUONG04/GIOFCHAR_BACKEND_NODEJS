import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { validateEnv } from "../../src/config/env.js";

describe("validateEnv", () => {
  beforeEach(() => {
    vi.stubEnv("DB_HOST", "127.0.0.1");
    vi.stubEnv("DB_USER", "root");
    vi.stubEnv("DB_NAME", "giofchar_test");
    vi.stubEnv("ACCESS_TOKEN_SECRET", "test-access-secret");
    vi.stubEnv("REFRESH_TOKEN_SECRET", "test-refresh-secret");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    vi.spyOn(process, "exit").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("allows both email settings to be empty", () => {
    validateEnv();

    expect(process.exit).not.toHaveBeenCalled();
  });

  it("rejects an incomplete email configuration", () => {
    vi.stubEnv("RESEND_API_KEY", "test-resend-key");

    validateEnv();

    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("allows both email settings to be configured", () => {
    vi.stubEnv("RESEND_API_KEY", "test-resend-key");
    vi.stubEnv("EMAIL_FROM", "orders@example.com");

    validateEnv();

    expect(process.exit).not.toHaveBeenCalled();
  });
});
