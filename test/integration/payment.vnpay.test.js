import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

import app from "../../src/app.js";
import orderService from "../../src/services/order.service.js";
import paymentService from "../../src/services/payment.service.js";
import { signVnpayParams } from "../../src/services/payments/vnpay.service.js";
import outboxConstants from "../../src/constants/outbox.cjs";

const { OUTBOX_EVENT_TYPES } = outboxConstants;

// Mock cấu hình VNPay cố định để chữ ký đồng nhất
vi.mock("../../src/config/vnpay.js", () => ({
  vnpayConfig: {
    tmnCode: "TEST_TMN_CODE",
    secretKey: "TEST_SECRET_KEY",
    vnpUrl: "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html",
    returnUrl: "http://localhost:3000/order/vnpay-return",
  },
}));

// Mock các Service làm việc với DB
vi.mock("../../src/services/order.service.js", () => ({
  default: {
    getByOrderCode: vi.fn(),
    updatePaymentStatus: vi.fn(),
  },
}));

vi.mock("../../src/services/payment.service.js", () => ({
  default: {
    getByOrderId: vi.fn(),
    updatePaymentById: vi.fn(),
  },
}));

// Mock Connection Pool cho DB Transaction
const mockConnection = {
  beginTransaction: vi.fn(),
  execute: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
};

vi.mock("../../src/config/db.js", () => ({
  default: {
    getConnection: vi.fn(() => Promise.resolve(mockConnection)),
  },
}));

describe("GET /api/payments/vnpay/ipn (VNPay Webhook Integration)", () => {
  // Test Constants
  const MOCK_ORDER_ID = 99;
  const MOCK_ORDER_CODE = "DH2026-000099";
  const MOCK_AMOUNT = 90000;
  const MOCK_PAYMENT_ID = 202;

  const MOCK_ORDER_DB = {
    orderId: MOCK_ORDER_ID,
    orderCode: MOCK_ORDER_CODE,
    amount: MOCK_AMOUNT,
    customerName: "Nguyen Van A",
    email: "a@example.com",
  };

  const MOCK_PAYMENT_DB = {
    paymentId: MOCK_PAYMENT_ID,
    orderId: MOCK_ORDER_ID,
    amount: MOCK_AMOUNT,
    paymentStatus: "pending",
    paymentType: "CARD",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnection.execute.mockResolvedValue([{}]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns RspCode 97 (Checksum failed) when secure hash is invalid", async () => {
    const invalidQuery = {
      vnp_Amount: "9000000",
      vnp_TxnRef: MOCK_ORDER_CODE,
      vnp_ResponseCode: "00",
      vnp_SecureHash: "INVALID_HASH_123456",
    };

    const res = await request(app)
      .get("/api/payments/vnpay/ipn")
      .set("Origin", "http://localhost:3000")
      .query(invalidQuery);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      RspCode: "97",
      Message: "Checksum failed",
    });

    expect(orderService.getByOrderCode).not.toHaveBeenCalled();
  });

  it("returns RspCode 01 (Order not found) when order code does not exist in DB", async () => {
    orderService.getByOrderCode.mockResolvedValue(null);

    const params = {
      vnp_Amount: "9000000",
      vnp_TxnRef: "UNKNOWN_ORDER",
      vnp_ResponseCode: "00",
    };
    const secureHash = signVnpayParams(params);

    const res = await request(app)
      .get("/api/payments/vnpay/ipn")
      .set("Origin", "http://localhost:3000")
      .query({ ...params, vnp_SecureHash: secureHash });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      RspCode: "01",
      Message: "Order not found",
    });

    expect(orderService.getByOrderCode).toHaveBeenCalledWith({
      orderCode: "UNKNOWN_ORDER",
    });
  });

  it("returns RspCode 04 (Amount invalid) when vnp_Amount does not match order amount", async () => {
    orderService.getByOrderCode.mockResolvedValue(MOCK_ORDER_DB);
    paymentService.getByOrderId.mockResolvedValue(MOCK_PAYMENT_DB);

    const params = {
      vnp_Amount: "5000000", // 50,000 VND - Lệch với 90,000 VND trong DB
      vnp_TxnRef: MOCK_ORDER_CODE,
      vnp_ResponseCode: "00",
    };
    const secureHash = signVnpayParams(params);

    const res = await request(app)
      .get("/api/payments/vnpay/ipn")
      .set("Origin", "http://localhost:3000")
      .query({ ...params, vnp_SecureHash: secureHash });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      RspCode: "04",
      Message: "Amount invalid",
    });
  });

  it("returns RspCode 00 (Success) and commits transaction when IPN is valid", async () => {
    orderService.getByOrderCode.mockResolvedValue(MOCK_ORDER_DB);
    paymentService.getByOrderId.mockResolvedValue(MOCK_PAYMENT_DB);

    const params = {
      vnp_Amount: "9000000", // 90,000 * 100
      vnp_TxnRef: MOCK_ORDER_CODE,
      vnp_ResponseCode: "00",
      vnp_TransactionNo: "14123456",
    };
    const secureHash = signVnpayParams(params);

    const res = await request(app)
      .get("/api/payments/vnpay/ipn")
      .set("Origin", "http://localhost:3000")
      .query({ ...params, vnp_SecureHash: secureHash });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      RspCode: "00",
      Message: "Success",
    });

    expect(mockConnection.beginTransaction).toHaveBeenCalled();
    expect(orderService.updatePaymentStatus).toHaveBeenCalledWith(
      {
        orderId: MOCK_ORDER_ID,
        paymentStatus: "success",
      },
      mockConnection,
    );
    expect(paymentService.updatePaymentById).toHaveBeenCalledWith(
      {
        paymentId: MOCK_PAYMENT_ID,
        paymentStatus: "success",
        paymentType: "CARD",
        transactionId: "14123456",
      },
      mockConnection,
    );
    const [outboxInsertQuery, outboxValues] = mockConnection.execute.mock.calls
      .find(([query]) => query.includes("INSERT INTO outbox_events"));
    expect(outboxInsertQuery).toContain("INSERT INTO outbox_events");
    expect(outboxValues[1]).toBe(OUTBOX_EVENT_TYPES.PAYMENT_SUCCEEDED);
    expect(outboxValues[4]).toEqual(
      JSON.stringify({
        email: MOCK_ORDER_DB.email,
        orderCode: MOCK_ORDER_DB.orderCode,
        customerName: MOCK_ORDER_DB.customerName,
        amount: MOCK_PAYMENT_DB.amount,
        transactionId: "14123456",
      }),
    );
    expect(mockConnection.commit).toHaveBeenCalled();
    expect(mockConnection.release).toHaveBeenCalled();
  });
});
