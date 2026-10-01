import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/services/cartItem.service.js", () => ({
    default: {
        getCartItemsByCartId: vi.fn(),
    },
}));

vi.mock("../../src/services/variant.service.js", () => ({
    deductStockForOrder: vi.fn(),
}));

vi.mock("../../src/services/payment.service.js", () => ({
    default: {
      createPayment: vi.fn(),
    },
}));

vi.mock("../../src/services/cart.service.js", () => ({
    default: {
      clearCart: vi.fn(),
    },
}));

vi.mock("../../src/services/order_item.service.js", () => ({
    default: {
      createOrderItem: vi.fn(),  
    }
}));

vi.mock("../../src/services/payments/vnpay.service.js", () => ({
    buildVnpayPaymentUrl: vi.fn(),
}));

import cartItemService from "../../src/services/cartItem.service.js";
import orderService from "../../src/services/order.service.js";
import cartService from "../../src/services/cart.service.js";
import { deductStockForOrder } from "../../src/services/variant.service.js";
import paymentService from "../../src/services/payment.service.js";
import order_itemService from "../../src/services/order_item.service.js";
import { buildVnpayPaymentUrl } from "../../src/services/payments/vnpay.service.js";
import { vnpayConfig } from "../../src/config/vnpay.js";
import outboxConstants from "../../src/constants/outbox.cjs";

const { OUTBOX_EVENT_TYPES } = outboxConstants;

describe("orderService.checkout", () => {
    const MOCK_USER_ID = 20;
    const MOCK_CART_ID = 1;
    const MOCK_VARIANT_ID = 10;
    const MOCK_FOOD_NAME = "Burger";
    const MOCK_WEIGHT_GRAM = 150;
    const MOCK_ORIGINAL_PRICE = 50000;
    const MOCK_PRICE = 45000;
    const MOCK_QUANTITY = 2;
    const MOCK_DISCOUNT_FIXED = 0;
    const MOCK_TOTAL_PRICE = MOCK_PRICE * MOCK_QUANTITY; // 90000

    // COD order constants
    const MOCK_COD_ORDER_ID = 99;
    const MOCK_COD_PAYMENT_ID = 202;

    // CARD/VNPAY order constants
    const MOCK_CARD_ORDER_ID = 100;
    const MOCK_CARD_PAYMENT_ID = 205;

    const conn = {
      execute: vi.fn(),
    };

    const checkoutInput = {
      cartId: MOCK_CART_ID,
      customerName: "Nguyen Van A",
      email: "a@example.com",
      phone: "0900000000",
      address: "Ho Chi Minh City",
      paymentMethod: "COD",
      userId: MOCK_USER_ID,
      guestToken: undefined,
      ipAddr: "127.0.0.1",
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("throws CART_EMPTY when the cart has no items", async () => {
        cartItemService.getCartItemsByCartId.mockResolvedValue([]);

        await expect(
            orderService.checkout(checkoutInput, conn),
        ).rejects.toMatchObject({
            statusCode: 400,
            context: {
                reason: "CART_EMPTY",
                cartId: MOCK_CART_ID,
            },
        });

        expect(cartItemService.getCartItemsByCartId).toHaveBeenCalledWith(
            MOCK_CART_ID,
            conn,
            true,
        );
        expect(deductStockForOrder).not.toHaveBeenCalled();
        expect(order_itemService.createOrderItem).not.toHaveBeenCalled();
        expect(paymentService.createPayment).not.toHaveBeenCalled();
        expect(cartService.clearCart).not.toHaveBeenCalled();
        expect(conn.execute).not.toHaveBeenCalled();
    });

    it("processes COD payment successfully", async () => {
        cartItemService.getCartItemsByCartId.mockResolvedValue([
            {
                variantId: MOCK_VARIANT_ID,
                foodName: MOCK_FOOD_NAME,
                weight_gram: MOCK_WEIGHT_GRAM,
                originalPrice: MOCK_ORIGINAL_PRICE,
                price: MOCK_PRICE,
                quantity: MOCK_QUANTITY,
                discountFixed: MOCK_DISCOUNT_FIXED,
            },
        ]);
        
        // Giả lập kết quả thực thi SQL cho createOrder
        conn.execute
            .mockResolvedValueOnce([{ insertId: MOCK_COD_ORDER_ID }]) // INSERT order
            .mockResolvedValueOnce([]); // UPDATE orderCode

        // Giả lập tạo payment
        paymentService.createPayment.mockResolvedValue({ insertId: MOCK_COD_PAYMENT_ID });

        const result = await orderService.checkout(checkoutInput, conn);

        // 1. Kiểm tra kết quả trả về
        const currentYear = new Date().getFullYear();
        expect(result).toEqual({
            orderId: MOCK_COD_ORDER_ID,
            orderCode: `DH${currentYear}-000099`,
            totalPriceOrder: MOCK_TOTAL_PRICE,
            paymentUrl: "",
            paymentId: MOCK_COD_PAYMENT_ID,
            paymentStatus: "pending",
        });

        // 2. Kiểm tra thứ tự gọi: Phải trừ kho hàng (deductStockForOrder) TRƯỚC KHI tạo order (conn.execute)
        expect(deductStockForOrder.mock.invocationCallOrder[0])
            .toBeLessThan(conn.execute.mock.invocationCallOrder[0]);

        // 3. Kiểm tra các hàm dependency được gọi với đúng tham số
        expect(deductStockForOrder).toHaveBeenCalledWith(conn, expect.any(Array));
        expect(order_itemService.createOrderItem).toHaveBeenCalledWith(conn, [
            [MOCK_COD_ORDER_ID, MOCK_VARIANT_ID, MOCK_FOOD_NAME, MOCK_WEIGHT_GRAM, MOCK_ORIGINAL_PRICE, null, null, MOCK_DISCOUNT_FIXED, MOCK_PRICE, MOCK_QUANTITY, MOCK_TOTAL_PRICE]
        ]);
        expect(paymentService.createPayment).toHaveBeenCalledWith(
            conn,
            MOCK_COD_ORDER_ID,
            "COD",
            MOCK_TOTAL_PRICE,
            "COD",
            "pending",
        );
        expect(cartService.clearCart).toHaveBeenCalledWith(MOCK_CART_ID, conn);
        expect(conn.execute).toHaveBeenCalledWith(
            expect.stringContaining("INSERT INTO outbox_events"),
            [
                expect.any(String),
                OUTBOX_EVENT_TYPES.ORDER_CREATED,
                "order",
                MOCK_COD_ORDER_ID,
                JSON.stringify({
                    orderId: MOCK_COD_ORDER_ID,
                    orderCode: `DH${currentYear}-000099`,
                    customerName: checkoutInput.customerName,
                    email: checkoutInput.email,
                    totalPriceOrder: MOCK_TOTAL_PRICE,
                    paymentMethod: "COD",
                }),
            ],
        );
        expect(
            conn.execute.mock.invocationCallOrder[
                conn.execute.mock.invocationCallOrder.length - 1
            ],
        ).toBeGreaterThan(cartService.clearCart.mock.invocationCallOrder[0]);
    });

    it("processes VNPAY payment successfully", async () => {
        cartItemService.getCartItemsByCartId.mockResolvedValue([
            {
                variantId: MOCK_VARIANT_ID,
                foodName: MOCK_FOOD_NAME,
                weight_gram: MOCK_WEIGHT_GRAM,
                originalPrice: MOCK_ORIGINAL_PRICE,
                price: MOCK_PRICE,
                quantity: MOCK_QUANTITY,
                discountFixed: MOCK_DISCOUNT_FIXED,
            },
        ]);
        const checkoutInputCARD = {
            ...checkoutInput,
            paymentMethod: "CARD",
        };
        // Giả lập kết quả thực thi SQL cho createOrder
        conn.execute
            .mockResolvedValueOnce([{ insertId: MOCK_CARD_ORDER_ID }]) // INSERT order
            .mockResolvedValueOnce([]); // UPDATE orderCode

        // Giả lập tạo payment
        paymentService.createPayment.mockResolvedValue({ insertId: MOCK_CARD_PAYMENT_ID });
        buildVnpayPaymentUrl.mockReturnValue(vnpayConfig.vnpUrl);

        const result = await orderService.checkout(checkoutInputCARD, conn);

        // 1. Kiểm tra kết quả trả về
        const currentYear = new Date().getFullYear();
        expect(result).toEqual({
            orderId: MOCK_CARD_ORDER_ID,
            orderCode: `DH${currentYear}-000100`,
            totalPriceOrder: MOCK_TOTAL_PRICE,
            paymentUrl: vnpayConfig.vnpUrl,
            paymentId: MOCK_CARD_PAYMENT_ID,
            paymentStatus: "pending",
        });

        // 2. Kiểm tra thứ tự gọi: Phải trừ kho hàng (deductStockForOrder) TRƯỚC KHI tạo order (conn.execute)
        expect(deductStockForOrder.mock.invocationCallOrder[0])
            .toBeLessThan(conn.execute.mock.invocationCallOrder[0]);

        // 3. Kiểm tra các hàm dependency được gọi với đúng tham số
        expect(deductStockForOrder).toHaveBeenCalledWith(conn, expect.any(Array));
        expect(order_itemService.createOrderItem).toHaveBeenCalledWith(conn, [
            [MOCK_CARD_ORDER_ID, MOCK_VARIANT_ID, MOCK_FOOD_NAME, MOCK_WEIGHT_GRAM, MOCK_ORIGINAL_PRICE, null, null, MOCK_DISCOUNT_FIXED, MOCK_PRICE, MOCK_QUANTITY, MOCK_TOTAL_PRICE]
        ]);
        expect(paymentService.createPayment).toHaveBeenCalledWith(
            conn,
            MOCK_CARD_ORDER_ID,
            "CARD",
            MOCK_TOTAL_PRICE,
            "",
            "pending",
        );
        expect(buildVnpayPaymentUrl).toHaveBeenCalledWith({
            orderId: `DH${currentYear}-000100`,
            amount: MOCK_TOTAL_PRICE,
            ipAddr: "127.0.0.1",
        });
        expect(cartService.clearCart).toHaveBeenCalledWith(MOCK_CART_ID, conn);
        expect(conn.execute).toHaveBeenCalledWith(
            expect.stringContaining("INSERT INTO outbox_events"),
            [
                expect.any(String),
                OUTBOX_EVENT_TYPES.ORDER_CREATED,
                "order",
                MOCK_CARD_ORDER_ID,
                JSON.stringify({
                    orderId: MOCK_CARD_ORDER_ID,
                    orderCode: `DH${currentYear}-000100`,
                    customerName: checkoutInputCARD.customerName,
                    email: checkoutInputCARD.email,
                    totalPriceOrder: MOCK_TOTAL_PRICE,
                    paymentMethod: "CARD",
                }),
            ],
        );
    });

    it("throws OUT_OF_STOCK error and halts execution if stock is insufficient", async () => {
        cartItemService.getCartItemsByCartId.mockResolvedValue([
            {
                variantId: MOCK_VARIANT_ID,
                foodName: MOCK_FOOD_NAME,
                weight_gram: MOCK_WEIGHT_GRAM,
                originalPrice: MOCK_ORIGINAL_PRICE,
                price: MOCK_PRICE,
                quantity: MOCK_QUANTITY,
                discountFixed: MOCK_DISCOUNT_FIXED,
            },
        ]);

        // Giả lập deductStockForOrder ném ra lỗi hết hàng (OutOfStock)
        const mockError = new Error("Insufficient stock for product");
        mockError.statusCode = 409;
        mockError.code = "OUT_OF_STOCK";
        deductStockForOrder.mockRejectedValue(mockError);

        await expect(
            orderService.checkout(checkoutInput, conn)
        ).rejects.toThrow("Insufficient stock for product");

        // Đảm bảo không tạo order, không tạo order item, không tạo payment, không xóa giỏ hàng
        expect(conn.execute).not.toHaveBeenCalled();
        expect(order_itemService.createOrderItem).not.toHaveBeenCalled();
        expect(paymentService.createPayment).not.toHaveBeenCalled();
        expect(cartService.clearCart).not.toHaveBeenCalled();
    });

    it("propagates database errors and halts execution if INSERT order fails", async () => {
        cartItemService.getCartItemsByCartId.mockResolvedValue([
            {
                variantId: MOCK_VARIANT_ID,
                foodName: MOCK_FOOD_NAME,
                weight_gram: MOCK_WEIGHT_GRAM,
                originalPrice: MOCK_ORIGINAL_PRICE,
                price: MOCK_PRICE,
                quantity: MOCK_QUANTITY,
                discountFixed: MOCK_DISCOUNT_FIXED,
            },
        ]);

        // Giả lập deductStockForOrder chạy thành công
        deductStockForOrder.mockResolvedValue(true);

        // Giả lập conn.execute ném ra lỗi Database
        const dbError = new Error("Database connection lost");
        dbError.code = "ER_CON_COUNT_ERROR";
        conn.execute.mockRejectedValue(dbError);

        await expect(
            orderService.checkout(checkoutInput, conn)
        ).rejects.toThrow("Database connection lost");

        // Đảm bảo không tạo order item, không tạo payment, không xóa giỏ hàng
        expect(order_itemService.createOrderItem).not.toHaveBeenCalled();
        expect(paymentService.createPayment).not.toHaveBeenCalled();
        expect(cartService.clearCart).not.toHaveBeenCalled();
    });
});