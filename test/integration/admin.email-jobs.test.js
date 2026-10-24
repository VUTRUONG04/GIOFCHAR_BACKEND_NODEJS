import { beforeEach, describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import request from "supertest";

vi.mock("../../src/services/rateLimit.service.js", () => ({
  checkSlidingWindowLimit: async () => ({
    allowed: true,
    requestCount: 1,
    retryAfterMs: 0,
  }),
}));

vi.mock("../../src/services/emailJob.service.js", () => ({
  default: {
    listEmailJobs: vi.fn(),
    getEmailJobById: vi.fn(),
    retryEmailJob: vi.fn(),
  },
}));

import app from "../../src/app.js";
import emailJobService from "../../src/services/emailJob.service.js";

const ACCESS_TOKEN_SECRET =
  process.env.ACCESS_TOKEN_SECRET || "test-access-token-secret";
process.env.ACCESS_TOKEN_SECRET = ACCESS_TOKEN_SECRET;

const createToken = (role) =>
  jwt.sign({ userId: 10, role }, ACCESS_TOKEN_SECRET);

describe("Admin email job endpoints", () => {
  const adminToken = createToken("admin");
  const userToken = createToken("user");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists jobs for an authenticated admin with filters", async () => {
    emailJobService.listEmailJobs.mockResolvedValue({
      events: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    });

    const response = await request(app)
      .get("/api/admin/email-jobs?page=1&pageSize=20&status=failed")
      .set("Origin", "http://localhost:3000")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(emailJobService.listEmailJobs).toHaveBeenCalledWith({
      page: "1",
      pageSize: "20",
      status: "failed",
    });
  });

  it("returns event detail for an authenticated admin", async () => {
    emailJobService.getEmailJobById.mockResolvedValue({
      id: 3,
      attemptCount: 2,
      lastAttemptAt: "2026-10-15T10:00:00.000Z",
      lastError: "Provider unavailable",
    });

    const response = await request(app)
      .get("/api/admin/email-jobs/3")
      .set("Origin", "http://localhost:3000")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.event.attemptCount).toBe(2);
    expect(emailJobService.getEmailJobById).toHaveBeenCalledWith("3");
  });

  it("queues a failed event for retry for an authenticated admin", async () => {
    emailJobService.retryEmailJob.mockResolvedValue({
      id: "3",
      status: "pending",
      attemptCount: 0,
    });

    const response = await request(app)
      .post("/api/admin/email-jobs/3/retry")
      .set("Origin", "http://localhost:3000")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("pending");
    expect(emailJobService.retryEmailJob).toHaveBeenCalledWith("3");
  });

  it("denies access to non-admin users", async () => {
    const response = await request(app)
      .get("/api/admin/email-jobs")
      .set("Origin", "http://localhost:3000")
      .set("Authorization", `Bearer ${userToken}`);

    expect(response.status).toBe(403);
    expect(emailJobService.listEmailJobs).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    const response = await request(app)
      .get("/api/admin/email-jobs")
      .set("Origin", "http://localhost:3000");

    expect(response.status).toBe(401);
    expect(emailJobService.listEmailJobs).not.toHaveBeenCalled();
  });
});
