import { describe, expect, it } from "vitest";

import brandTokens from "@giocha/brand-tokens";
import buildEmail from "../../src/services/email/buildEmail.js";

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
  });
});
