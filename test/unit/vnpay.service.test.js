import { beforeEach, describe, expect, it, vi } from "vitest";

const { createPendingEvent } = vi.hoisted(() => ({
  createPendingEvent: vi.fn(),
}));

// 1. Mock cấu hình VNPay cố định
vi.mock("../../src/config/vnpay.js", () => ({
  vnpayConfig: {
    tmnCode: "TEST_TMN_CODE",
    secretKey: "TEST_SECRET_KEY",
    vnpUrl: "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html",
    returnUrl: "http://localhost:3000/order/vnpay-return",
  },
}));

// 2. Mock orderService
vi.mock("../../src/services/order.service.js", () => ({
  default: {
    updatePaymentStatus: vi.fn(),
  },
}));

// 3. Mock paymentService
vi.mock("../../src/services/payment.service.js", () => ({
  default: {
    updatePaymentById: vi.fn(),
  },
}));

vi.mock("../../src/repositories/outbox.repository.js", () => ({
  default: class MockOutboxRepository {
    createPendingEvent(...args) {
      return createPendingEvent(...args);
    }
  },
}));

vi.mock("../../src/config/db.js", () => ({
  default: {},
}));

import {
  buildVnpayPaymentUrl,
  signVnpayParams,
  processIpn,
} from "../../src/services/payments/vnpay.service.js";
import orderService from "../../src/services/order.service.js";
import paymentService from "../../src/services/payment.service.js";
import { vnpayConfig } from "../../src/config/vnpay.js";
import outboxConstants from "../../src/constants/outbox.cjs";

const { OUTBOX_EVENT_TYPES } = outboxConstants;

describe("vnpay.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createPendingEvent.mockResolvedValue("event-id");
  });

  const MOCK_ORDER_ID = 99;
  const MOCK_ORDER_CODE = "DH2026-0001";
  const MOCK_AMOUNT = 90000;
  const MOCK_IP_ADDRESS = "::1";
  const MOCK_BANK_CODE = "VNPAY";
  const MOCK_ORDER_TYPE = "other";
  const MOCK_LOCALE = "vn";

  // Bài test đầu tiên chúng ta sẽ viết ở đây...
  describe("buildVnpayPaymentUrl", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });
    it("generates a valid VNPay payment URL with correct query parameters and HMAC signature", () => {
      const paymentUrl = buildVnpayPaymentUrl({
        orderId: MOCK_ORDER_CODE,
        amount: MOCK_AMOUNT,
        ipAddr: MOCK_IP_ADDRESS,
      });
      // 1. Đảm bảo URL chứa domain vnpUrl
      expect(paymentUrl).toContain(vnpayConfig.vnpUrl);
      // 2. Kiểm tra các tham số truyền vào URL
      expect(paymentUrl).toContain("vnp_TmnCode=" + vnpayConfig.tmnCode);
      expect(paymentUrl).toContain("vnp_TxnRef=" + MOCK_ORDER_CODE);
      expect(paymentUrl).toContain("vnp_Amount=" + (MOCK_AMOUNT * 100));
      expect(paymentUrl).toContain("vnp_IpAddr=127.0.0.1");
      expect(paymentUrl).toContain("vnp_SecureHash=");
    });
  });

  describe("processIpn", () => {
    const mockOrder = {
      orderId: MOCK_ORDER_ID,
      orderCode: MOCK_ORDER_CODE,
      customerName: "Nguyen Van A",
      email: "a@example.com",
    };
    const mockPayment = {
      paymentId: 202,
      paymentStatus: "pending",
      paymentType: "CARD",
      amount: MOCK_AMOUNT,
    };
    const mockConnection = {};

    it("updates order and payment status to success when vnp_ResponseCode is '00'", async () => {
      const vnpParams = {
        vnp_ResponseCode: "00",
        vnp_TransactionNo: "14123456",
      };

      const result = await processIpn({
        order: mockOrder,
        payment: mockPayment,
        vnp_Params: vnpParams,
        connection: mockConnection,
      });

      expect(result).toEqual({
        RspCode: "00",
        Message: "Success",
        outcome: "processed",
        paymentStatus: "success",
        providerResponseCode: "00",
      });

      expect(orderService.updatePaymentStatus).toHaveBeenCalledWith(
        {
          orderId: mockOrder.orderId,
          paymentStatus: "success",
        },
        mockConnection,
      );

      expect(paymentService.updatePaymentById).toHaveBeenCalledWith(
        {
          paymentId: mockPayment.paymentId,
          paymentStatus: "success",
          paymentType: "CARD",
          transactionId: "14123456",
        },
        mockConnection,
      );

      expect(createPendingEvent).toHaveBeenCalledWith(
        {
          eventType: OUTBOX_EVENT_TYPES.PAYMENT_SUCCEEDED,
          aggregateType: "order",
          aggregateId: MOCK_ORDER_ID,
          payload: {
            email: mockOrder.email,
            orderCode: mockOrder.orderCode,
            customerName: mockOrder.customerName,
            amount: mockPayment.amount,
            transactionId: "14123456",
          },
        },
        mockConnection,
      );
      expect(
        paymentService.updatePaymentById.mock.invocationCallOrder[0],
      ).toBeLessThan(createPendingEvent.mock.invocationCallOrder[0]);
    });

    it("updates status to failed when vnp_ResponseCode is not '00'", async () => {
      const vnpParams = {
        vnp_ResponseCode: "51", // Lỗi tài khoản không đủ tiền
        vnp_TransactionNo: "14123457",
      };

      const result = await processIpn({
        order: mockOrder,
        payment: mockPayment,
        vnp_Params: vnpParams,
        connection: mockConnection,
      });

      expect(result.paymentStatus).toBe("failed");
      expect(orderService.updatePaymentStatus).toHaveBeenCalledWith(
        {
          orderId: mockOrder.orderId,
          paymentStatus: "failed",
        },
        mockConnection,
      );
      expect(createPendingEvent).not.toHaveBeenCalled();
    });

    it("returns RspCode '02' duplicate when payment is not in pending status", async () => {
      const completedPayment = {
        ...mockPayment,
        paymentStatus: "success", // Đã xử lý từ trước
      };

      const result = await processIpn({
        order: mockOrder,
        payment: completedPayment,
        vnp_Params: { vnp_ResponseCode: "00" },
        connection: mockConnection,
      });

      expect(result.RspCode).toBe("02");
      expect(result.outcome).toBe("duplicate");
      expect(orderService.updatePaymentStatus).not.toHaveBeenCalled();
      expect(paymentService.updatePaymentById).not.toHaveBeenCalled();
      expect(createPendingEvent).not.toHaveBeenCalled();
    });

    it("propagates outbox persistence errors so the IPN transaction can roll back", async () => {
      createPendingEvent.mockRejectedValue(new Error("Outbox insert failed"));

      await expect(
        processIpn({
          order: mockOrder,
          payment: mockPayment,
          vnp_Params: {
            vnp_ResponseCode: "00",
            vnp_TransactionNo: "14123456",
          },
          connection: mockConnection,
        }),
      ).rejects.toThrow("Outbox insert failed");
    });
  });
});
