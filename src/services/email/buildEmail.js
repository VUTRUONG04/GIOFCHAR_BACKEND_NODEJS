import brandTokens from "@giocha/brand-tokens";
import outboxConstants from "../../constants/outbox.cjs";

const { OUTBOX_EVENT_TYPES } = outboxConstants;

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });

const formatVnd = (amount) =>
  new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(amount);

const buildOrderCreatedEmail = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("order.created email payload must be an object");
  }

  const {
    orderCode,
    customerName,
    phone,
    address,
    totalPriceOrder,
    paymentMethod,
  } = payload;

  if (typeof orderCode !== "string" || !orderCode.trim()) {
    throw new TypeError("order.created email payload requires orderCode");
  }

  const numericTotal = Number(totalPriceOrder);
  if (
    (typeof totalPriceOrder !== "number" &&
      typeof totalPriceOrder !== "string") ||
    (typeof totalPriceOrder === "string" && !totalPriceOrder.trim()) ||
    !Number.isFinite(numericTotal) ||
    numericTotal < 0
  ) {
    throw new TypeError(
      "order.created email payload requires a non-negative totalPriceOrder",
    );
  }

  const safeCustomerName = escapeHtml(customerName || "Quý khách");
  const safeOrderCode = escapeHtml(orderCode.trim());
  const safeBrandName = escapeHtml(brandTokens.name);
  const amount = escapeHtml(formatVnd(numericTotal));
  const paymentMethodLabel =
    paymentMethod === "COD"
      ? "Thanh toán khi nhận hàng"
      : paymentMethod === "CARD"
        ? "Thanh toán trực tuyến qua VNPay"
        : null;
  const detailsRow = (label, value) =>
    value
      ? `<tr>
                    <td style="padding:8px 16px;color:${brandTokens.colors.secondary};vertical-align:top;">${label}</td>
                    <td style="padding:8px 16px;text-align:right;color:${brandTokens.colors.text};">${escapeHtml(value)}</td>
                  </tr>`
      : "";

  return {
    subject: `Xác nhận đơn hàng ${orderCode.trim()} - ${brandTokens.name}`,
    html: `<!doctype html>
      <html lang="vi">
        <body style="margin:0;padding:24px;background-color:${brandTokens.colors.background};font-family:${brandTokens.fonts.body};color:${brandTokens.colors.text};">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:0 auto;background-color:${brandTokens.colors.surface};border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:24px;background-color:${brandTokens.colors.primary};color:${brandTokens.colors.surface};">
                <div style="font-size:22px;font-weight:700;">${safeBrandName}</div>
                <div style="margin-top:4px;font-size:14px;">${escapeHtml(brandTokens.tagline)}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 24px;">
                <h1 style="margin:0 0 16px;font-size:22px;color:${brandTokens.colors.text};">Cảm ơn ${safeCustomerName} đã đặt hàng!</h1>
                <p style="margin:0 0 24px;line-height:1.6;color:${brandTokens.colors.secondary};">Chúng tôi đã tiếp nhận đơn hàng của bạn và sẽ sớm xử lý.</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:${brandTokens.colors.backgroundSoft};border-radius:8px;">
                  <tr>
                    <td style="padding:16px;color:${brandTokens.colors.secondary};">Mã đơn hàng</td>
                    <td style="padding:16px;text-align:right;font-weight:700;color:${brandTokens.colors.primaryDark};">${safeOrderCode}</td>
                  </tr>
                  <tr>
                    <td style="padding:0 16px 16px;color:${brandTokens.colors.secondary};">Tổng thanh toán</td>
                    <td style="padding:0 16px 16px;text-align:right;font-weight:700;color:${brandTokens.colors.primaryDark};">${amount}</td>
                  </tr>
                  ${paymentMethodLabel ? detailsRow("Phương thức thanh toán", paymentMethodLabel) : ""}
                </table>
                ${
                  phone || address
                    ? `<h2 style="margin:24px 0 8px;font-size:16px;color:${brandTokens.colors.text};">Thông tin giao hàng</h2>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:${brandTokens.colors.backgroundSoft};border-radius:8px;">
                  ${detailsRow("Số điện thoại", phone)}
                  ${detailsRow("Địa chỉ nhận hàng", address)}
                </table>`
                    : ""
                }
                <p style="margin:24px 0 0;line-height:1.6;color:${brandTokens.colors.secondary};">Trân trọng,<br/><strong style="color:${brandTokens.colors.primaryDark};">${safeBrandName}</strong></p>
              </td>
            </tr>
          </table>
        </body>
      </html>`,
  };
};

const ORDER_STATUS_LABELS = {
  unconfirmed: "Đơn hàng đang chờ xác nhận",
  delivering: "Đơn hàng đang được giao",
  cancelled: "Đơn hàng đã bị hủy",
  delivered: "Đơn hàng đã giao thành công",
};

const buildOrderStatusUpdatedEmail = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("order.status_updated email payload must be an object");
  }

  const { orderCode, customerName, status } = payload;
  if (typeof orderCode !== "string" || !orderCode.trim()) {
    throw new TypeError(
      "order.status_updated email payload requires orderCode",
    );
  }
  if (!Object.hasOwn(ORDER_STATUS_LABELS, status)) {
    throw new TypeError(
      "order.status_updated email payload requires a valid status",
    );
  }

  const safeBrandName = escapeHtml(brandTokens.name);
  const safeCustomerName = escapeHtml(customerName || "Quý khách");
  const safeOrderCode = escapeHtml(orderCode.trim());
  const statusLabel = ORDER_STATUS_LABELS[status];

  return {
    subject: `${statusLabel} ${orderCode.trim()} - ${brandTokens.name}`,
    html: `<!doctype html>
      <html lang="vi">
        <body style="margin:0;padding:24px;background-color:${brandTokens.colors.background};font-family:${brandTokens.fonts.body};color:${brandTokens.colors.text};">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:0 auto;background-color:${brandTokens.colors.surface};border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:24px;background-color:${brandTokens.colors.primary};color:${brandTokens.colors.surface};">
                <div style="font-size:22px;font-weight:700;">${safeBrandName}</div>
                <div style="margin-top:4px;font-size:14px;">${escapeHtml(brandTokens.tagline)}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 24px;">
                <h1 style="margin:0 0 16px;font-size:22px;color:${brandTokens.colors.text};">${escapeHtml(statusLabel)}</h1>
                <p style="margin:0 0 24px;line-height:1.6;color:${brandTokens.colors.secondary};">Xin chào ${safeCustomerName}, trạng thái đơn hàng của bạn đã được cập nhật.</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:${brandTokens.colors.backgroundSoft};border-radius:8px;">
                  <tr>
                    <td style="padding:16px;color:${brandTokens.colors.secondary};">Mã đơn hàng</td>
                    <td style="padding:16px;text-align:right;font-weight:700;color:${brandTokens.colors.primaryDark};">${safeOrderCode}</td>
                  </tr>
                  <tr>
                    <td style="padding:0 16px 16px;color:${brandTokens.colors.secondary};">Trạng thái</td>
                    <td style="padding:0 16px 16px;text-align:right;color:${brandTokens.colors.text};">${escapeHtml(statusLabel)}</td>
                  </tr>
                </table>
                <p style="margin:24px 0 0;line-height:1.6;color:${brandTokens.colors.secondary};">Trân trọng,<br/><strong style="color:${brandTokens.colors.primaryDark};">${safeBrandName}</strong></p>
              </td>
            </tr>
          </table>
        </body>
      </html>`,
  };
};

const buildPaymentSucceededEmail = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("payment.succeeded email payload must be an object");
  }

  const { orderCode, customerName, amount, transactionId } = payload;
  if (typeof orderCode !== "string" || !orderCode.trim()) {
    throw new TypeError("payment.succeeded email payload requires orderCode");
  }

  const numericAmount = Number(amount);
  if (
    (typeof amount !== "number" && typeof amount !== "string") ||
    (typeof amount === "string" && !amount.trim()) ||
    !Number.isFinite(numericAmount) ||
    numericAmount < 0
  ) {
    throw new TypeError(
      "payment.succeeded email payload requires a non-negative amount",
    );
  }

  const safeBrandName = escapeHtml(brandTokens.name);
  const safeCustomerName = escapeHtml(customerName || "Quý khách");
  const safeOrderCode = escapeHtml(orderCode.trim());
  const formattedAmount = escapeHtml(formatVnd(numericAmount));
  const safeTransactionId = transactionId
    ? escapeHtml(transactionId)
    : "";

  return {
    subject: `Thanh toán thành công đơn hàng ${orderCode.trim()} - ${brandTokens.name}`,
    html: `<!doctype html>
      <html lang="vi">
        <body style="margin:0;padding:24px;background-color:${brandTokens.colors.background};font-family:${brandTokens.fonts.body};color:${brandTokens.colors.text};">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:0 auto;background-color:${brandTokens.colors.surface};border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:24px;background-color:${brandTokens.colors.primary};color:${brandTokens.colors.surface};">
                <div style="font-size:22px;font-weight:700;">${safeBrandName}</div>
                <div style="margin-top:4px;font-size:14px;">${escapeHtml(brandTokens.tagline)}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 24px;">
                <h1 style="margin:0 0 16px;font-size:22px;color:${brandTokens.colors.text};">Thanh toán thành công</h1>
                <p style="margin:0 0 24px;line-height:1.6;color:${brandTokens.colors.secondary};">Xin chào ${safeCustomerName}, chúng tôi đã nhận được thanh toán cho đơn hàng của bạn.</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:${brandTokens.colors.backgroundSoft};border-radius:8px;">
                  <tr>
                    <td style="padding:16px;color:${brandTokens.colors.secondary};">Mã đơn hàng</td>
                    <td style="padding:16px;text-align:right;font-weight:700;color:${brandTokens.colors.primaryDark};">${safeOrderCode}</td>
                  </tr>
                  <tr>
                    <td style="padding:0 16px 16px;color:${brandTokens.colors.secondary};">Số tiền</td>
                    <td style="padding:0 16px 16px;text-align:right;font-weight:700;color:${brandTokens.colors.primaryDark};">${formattedAmount}</td>
                  </tr>
                  ${
                    safeTransactionId
                      ? `<tr>
                    <td style="padding:0 16px 16px;color:${brandTokens.colors.secondary};">Mã giao dịch</td>
                    <td style="padding:0 16px 16px;text-align:right;color:${brandTokens.colors.text};">${safeTransactionId}</td>
                  </tr>`
                      : ""
                  }
                </table>
                <p style="margin:24px 0 0;line-height:1.6;color:${brandTokens.colors.secondary};">Trân trọng,<br/><strong style="color:${brandTokens.colors.primaryDark};">${safeBrandName}</strong></p>
              </td>
            </tr>
          </table>
        </body>
      </html>`,
  };
};

const emailBuilders = {
  [OUTBOX_EVENT_TYPES.ORDER_CREATED]: buildOrderCreatedEmail,
  [OUTBOX_EVENT_TYPES.ORDER_STATUS_UPDATED]: buildOrderStatusUpdatedEmail,
  [OUTBOX_EVENT_TYPES.PAYMENT_SUCCEEDED]: buildPaymentSucceededEmail,
};

const buildEmail = (eventType, payload) => {
  const builder = emailBuilders[eventType];
  if (!builder) {
    throw new Error(`Unsupported email event type: ${eventType}`);
  }

  return builder(payload);
};

export default buildEmail;
