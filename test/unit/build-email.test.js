import { describe, expect, it } from "vitest";

import brandTokens from "@giocha/brand-tokens";
import outboxConstants from "../../src/constants/outbox.cjs";
import buildEmail from "../../src/services/email/buildEmail.js";

const { OUTBOX_EVENT_TYPES } = outboxConstants;

describe("buildEmail", () => {
  it("builds a branded order-created email with inline styles", () => {
    const email = buildEmail("order.created", {
      orderCode: "DH-123",
      customerName: "Lan",
      phone: "0900000000",
      address: "123 Nguyễn Trãi, Quận 1",
      totalPriceOrder: 125000,
      paymentMethod: "COD",
    });

    expect(email.subject).toContain("DH-123");
    expect(email.subject).toContain(brandTokens.name);
    expect(email.html).toContain(`background-color:${brandTokens.colors.primary}`);
    expect(email.html).toContain(`font-family:${brandTokens.fonts.body}`);
    expect(email.html).toContain("125.000");
    expect(email.html).toContain("Lan");
    expect(email.html).toContain("0900000000");
    expect(email.html).toContain("123 Nguyễn Trãi, Quận 1");
    expect(email.html).toContain("Thanh toán khi nhận hàng");
  });

  it("builds an order status update email", () => {
    const email = buildEmail(OUTBOX_EVENT_TYPES.ORDER_STATUS_UPDATED, {
      orderCode: "DH-123",
      customerName: "Lan",
      status: "delivering",
    });

    expect(email.subject).toContain("DH-123");
    expect(email.subject).toContain("đang được giao");
    expect(email.html).toContain("Lan");
    expect(email.html).toContain("Đơn hàng đang được giao");
    expect(email.html).toContain(brandTokens.name);
  });

  it("builds a payment succeeded email", () => {
    const email = buildEmail(OUTBOX_EVENT_TYPES.PAYMENT_SUCCEEDED, {
      orderCode: "DH-123",
      customerName: "Lan",
      amount: 125000,
      transactionId: "VNPAY-456",
    });

    expect(email.subject).toContain("Thanh toán thành công");
    expect(email.subject).toContain("DH-123");
    expect(email.html).toContain("Lan");
    expect(email.html).toContain("125.000");
    expect(email.html).toContain("VNPAY-456");
    expect(email.html).toContain(brandTokens.name);
  });

  it("escapes user-controlled values in the HTML", () => {
    const email = buildEmail("order.created", {
      orderCode: "<script>alert(1)</script>",
      customerName: "<img src=x onerror=alert(1)>",
      phone: "<img src=x>",
      address: "<script>bad address</script>",
      totalPriceOrder: 50000,
      paymentMethod: "CARD",
    });

    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<img");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("&lt;script&gt;bad address&lt;/script&gt;");
    expect(email.html).toContain("&lt;img src=x&gt;");
    expect(email.html).toContain("Thanh toán trực tuyến qua VNPay");
  });

  it("rejects unsupported event types and invalid event payloads", () => {
    expect(() => buildEmail("unknown.event", {})).toThrow(
      "Unsupported email event type: unknown.event",
    );
    expect(() => buildEmail("order.created", {})).toThrow(TypeError);
    expect(() =>
      buildEmail("order.created", {
        orderCode: "DH-123",
        totalPriceOrder: null,
      }),
    ).toThrow(TypeError);
    expect(() =>
      buildEmail(OUTBOX_EVENT_TYPES.ORDER_STATUS_UPDATED, {
        orderCode: "DH-123",
        status: "unknown",
      }),
    ).toThrow(TypeError);
    expect(() =>
      buildEmail(OUTBOX_EVENT_TYPES.PAYMENT_SUCCEEDED, {
        orderCode: "DH-123",
        amount: "invalid",
      }),
    ).toThrow(TypeError);
  });

  it("escapes user-controlled values in order status update emails", () => {
    const email = buildEmail(OUTBOX_EVENT_TYPES.ORDER_STATUS_UPDATED, {
      orderCode: "<script>bad</script>",
      customerName: "<img src=x>",
      status: "cancelled",
    });

    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<img");
    expect(email.html).toContain("&lt;script&gt;bad&lt;/script&gt;");
    expect(email.html).toContain("&lt;img src=x&gt;");
  });

  it("escapes user-controlled values in payment succeeded emails", () => {
    const email = buildEmail(OUTBOX_EVENT_TYPES.PAYMENT_SUCCEEDED, {
      orderCode: "<script>bad</script>",
      customerName: "<img src=x>",
      amount: 50000,
      transactionId: "<script>transaction</script>",
    });

    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<img");
    expect(email.html).toContain("&lt;script&gt;bad&lt;/script&gt;");
    expect(email.html).toContain("&lt;img src=x&gt;");
    expect(email.html).toContain("&lt;script&gt;transaction&lt;/script&gt;");
  });
});
