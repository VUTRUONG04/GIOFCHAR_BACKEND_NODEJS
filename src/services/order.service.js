import pool from "../config/db.js";
import OutboxRepository from "../repositories/outbox.repository.js";
import outboxConstants from "../constants/outbox.cjs";
import logger from "../config/logger.js";
import { ORDER_STATUS, PAYMENT_STATUS } from "../constants/field.js";
import { LOG_ACTIONS, LOG_STATUSES } from "../constants/logEvents.js";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../errors/AppError.js";
import {
  calculateOrderValues,
  generateOrderCode,
  groupOrders,
} from "../utils/order.util.js";
import { switchCustomer } from "../utils/switchCustomer.js";
import cartService from "./cart.service.js";
import cartItemService from "./cartItem.service.js";
import order_itemService from "./order_item.service.js";
import paymentService from "./payment.service.js";
import { buildVnpayPaymentUrl } from "./payments/vnpay.service.js";
import { validateOwner } from "./validators.js";
import { deductStockForOrder } from "./variant.service.js";

const outboxRepository = new OutboxRepository(pool);
const { OUTBOX_EVENT_TYPES } = outboxConstants;

const getAllOrders = async () => {
  const [rows] = await pool.execute(`
      SELECT
        o.id AS orderId,
        o.orderCode,
        o.status,
        o.paymentStatus,
        o.customerName,
        o.email,
        o.phone,
        o.address AS deliveryAddress,
        o.createdAt AS time,

        SUM(oi.quantity ) as totalQuantity,
        SUM(oi.totalPrice ) as amount
      FROM orders o 
      JOIN order_items oi  ON o.id = oi.orderID
      GROUP BY o.id
      ORDER BY o.createdAt DESC`);
  return rows;
};

const countTodayOrders = async (conn = pool) => {
  const [result] = await conn.execute(
    `
      SELECT COUNT(o.id) as countOrdered
      FROM orders o
      WHERE o.createdAt >= CURDATE() AND o.createdAt < CURDATE() + INTERVAL 1 DAY
      `,
  );
  return result[0].countOrdered;
};

const countYesterdayOrders = async (conn = pool) => {
  const [result] = await conn.execute(
    `
      SELECT COUNT(o.id) as countOrdered
      FROM orders o
      WHERE o.createdAt >= CURDATE() - INTERVAL 1 DAY AND o.createdAt < CURDATE()
      `,
  );
  return result[0].countOrdered;
};

const getOrderById = async (orderId, conn = pool) => {
  const [rows] = await conn.execute(
    `SELECT
        o.id AS orderId,
        o.orderCode,
        o.status,
        o.paymentStatus,
        o.address AS deliveryAddress,
        o.createdAt AS time
      FROM orders o 
      WHERE id = ?`,
    [orderId],
  );
  return rows[0];
};

const assertOrderUpdatable = async (orderId, conn = pool) => {
  const order = await getOrderById(orderId, conn);

  if (!order) throw new NotFoundError("Order not found");

  const { status: currentStatus } = order;
  if (currentStatus === "cancelled" || currentStatus === "delivered")
    throw new BadRequestError("Order cannot be updated");
};

const getOrdersByUserId = async (userId) => {
  const [rows] = await pool.execute(
    `SELECT
        o.id AS orderId,
        o.orderCode,
        o.status,
        o.createdAt AS time,

        (SELECT SUM(oi2.totalPrice )
        FROM order_items oi2 
        WHERE oi2.orderID = o.id
        ) AS amount,

        oi.id as orderItemId,
        f.foodName,
        f.image,
        fv.weight_gram,
        oi.totalPrice,
        oi.quantity
      FROM orders o 
      JOIN order_items oi  ON o.id = oi.orderID
      JOIN food_variants fv ON oi.food_variantID = fv.id
      JOIN foods f ON fv.foodID = f.id
      WHERE o.userID = ?
      ORDER BY o.createdAt DESC`,
    [userId],
  );
  const newRows = groupOrders(rows);
  return newRows;
};

const createOrder = async (
  connection,
  { userId, guestToken },
  customerName,
  email,
  phone,
  address,
) => {
  validateOwner({ userId, guestToken });

  let field, value;
  if (userId) {
    field = "userID";
    value = userId;
  } else {
    field = "guestToken";
    value = guestToken;
  }

  const [result] = await connection.execute(
    `INSERT INTO orders (${field}, customerName, email, phone, address) VALUES (?, ?, ?, ?, ?)`,
    [value, customerName, email, phone, address],
  );

  const orderId = result.insertId;
  const orderCode = generateOrderCode(orderId);

  await connection.execute("UPDATE orders SET orderCode = ? WHERE id = ?", [
    orderCode,
    orderId,
  ]);

  logger.info(LOG_ACTIONS.ORDER.CREATE, {
    status: LOG_STATUSES.SUCCEEDED,
    orderId: result.insertId,
    actorType: userId ? "user" : "guest",
    userId,
  });
  return { orderId: result.insertId, orderCode };
};

const updateOrder = async (orderId, status) => {
  if (!ORDER_STATUS.includes(status))
    throw new BadRequestError("Invalid order status");
  const connection = await pool.getConnection();
  const transactionStartedAt = Date.now();

  try {
    await connection.beginTransaction();

    if (status !== "delivered") {
      await updateOrderStatus(orderId, status, connection);
      await connection.commit();
      logger.debug(LOG_ACTIONS.TRANSACTION, {
        status: LOG_STATUSES.COMMITTED,
        operation: "update_order",
        orderId,
        orderStatus: status,
        durationMs: Date.now() - transactionStartedAt,
      });
      return true;
    }

    const payment = await paymentService.getByOrderId(orderId, connection);
    if (!payment) throw new NotFoundError("Payment not found");

    if (payment.paymentType === "COD") {
      await confirmCodOrderPayment(orderId, status, connection);
    } else {
      await updateOrderStatus(orderId, status, connection);
    }

    await connection.commit();
    logger.debug(LOG_ACTIONS.TRANSACTION, {
      status: LOG_STATUSES.COMMITTED,
      operation: "update_order",
      orderId,
      orderStatus: status,
      durationMs: Date.now() - transactionStartedAt,
    });
    return true;
  } catch (err) {
    await connection.rollback();
    logger.warn(LOG_ACTIONS.TRANSACTION, {
      status: LOG_STATUSES.ROLLED_BACK,
      operation: "update_order",
      reason: err.code || "UNEXPECTED_ERROR",
      orderId,
      orderStatus: status,
      durationMs: Date.now() - transactionStartedAt,
    });
    throw err;
  } finally {
    connection.release();
  }
};

const updateOrderStatus = async (orderId, status, conn = pool) => {
  if (!ORDER_STATUS.includes(status))
    throw new BadRequestError("Invalid order status");
  await assertOrderUpdatable(orderId, conn); // check order đang ở một trạng thái cuối ko thể cập nhật lại: đã giao | đã hủy
  const [result] = await conn.execute(
    "UPDATE orders o SET status = ? WHERE id = ?",
    [status, orderId],
  );
  if (result.affectedRows !== 1) throw new NotFoundError("Order not found");
  return result.affectedRows === 1;
};

const updateOrderDeliveredCOD = async (
  orderId,
  paymentStatus,
  orderStatus,
  conn = pool,
) => {
  if (!PAYMENT_STATUS.includes(paymentStatus))
    throw new BadRequestError("Invalid status payment");
  if (!ORDER_STATUS.includes(orderStatus))
    throw new BadRequestError("Invalid order status");

  const sql = `
      UPDATE orders
      SET paymentStatus = ?, status = ?
      WHERE id = ?
    `;
  const [result] = await conn.execute(sql, [
    paymentStatus,
    orderStatus,
    orderId,
  ]);
  return result.affectedRows === 1;
};

const updatePaymentStatus = async ({ orderId, paymentStatus }, conn = pool) => {
  const [result] = await conn.execute(
    "UPDATE orders o SET paymentStatus = ? WHERE id = ?",
    [paymentStatus, orderId],
  );
  return result;
};

const confirmCodOrderPayment = async (
  orderId,
  status = "delivered",
  conn = pool,
) => {
  if (status !== "delivered")
    throw new BadRequestError("Invalid status order.");

  const payment = await paymentService.getByOrderId(orderId, conn);
  if (!payment) throw new NotFoundError("Payment not found for this order.");

  const { paymentId, paymentType } = payment;
  if (paymentType !== "COD")
    throw new BadRequestError("Only COD orders can be confirmed manually"); // không thể update trạng thái payment cho order CARD được

  await assertOrderUpdatable(orderId, conn);

  const newPaymentStatus = "success";
  const updatedOrder = await updateOrderDeliveredCOD(
    orderId,
    newPaymentStatus,
    status,
    conn,
  );
  if (!updatedOrder) throw new NotFoundError("Order not found");

  await paymentService.updatePaymentById(
    {
      paymentId,
      paymentStatus: newPaymentStatus,
      paymentType,
      transactionId: "COD",
    },
    conn,
  );
  return true;
};

const deleteOrder = async (orderId) => {
  const [result] = await pool.execute("DELETE FROM orders WHERE id = ?", [
    orderId,
  ]);

  return result;
};

const getOrderByIdAndUser = async (orderId, { userId, guestToken }) => {
  const { field, value } = switchCustomer({ userId, guestToken });
  const [result] = await pool.execute(
    `SELECT * FROM orders WHERE id = ? AND ${field} = ?`,
    [orderId, value],
  );
  return result.length > 0 ? result[0] : null;
};

const tryAttachOrderToUser = async ({ email, userId }) => {
  try {
    const [result] = await pool.execute(
      `
    UPDATE orders
    SET userID = ?, guestToken = NULL
    WHERE email = ? 
      `,
      [userId, email],
    );
    logger.debug(LOG_ACTIONS.ORDER.ATTACH_TO_USER, {
      status: LOG_STATUSES.SUCCEEDED,
      userId,
      affectedOrders: result.affectedRows,
    });
  } catch (error) {
    //ignore
    logger.warn(LOG_ACTIONS.ORDER.ATTACH_TO_USER, {
      status: LOG_STATUSES.FAILED,
      userId,
      reason: error.code || "UNKNOWN_DATABASE_ERROR",
    });
  }
};

const revenue = async (conn = pool, time = "default") => {
  const optionTime =
    time === "today"
      ? "WHERE o.createdAt >= CURDATE() AND o.createdAt < CURDATE() + INTERVAL 1 DAY"
      : time === "yesterday"
        ? "WHERE o.createdAt >= CURDATE() - INTERVAL 1 DAY AND o.createdAt < CURDATE()"
        : "";
  const [result] = await conn.execute(
    `
        SELECT 
          SUM(amount) as revenue
        FROM (SELECT 
                SUM(oi.totalPrice ) as amount
                FROM orders o
                JOIN order_items oi ON o.id = oi.orderID 
                ${optionTime}
                GROUP BY o.id) ordersAmount;
      `,
  );
  return result[0].revenue ? Number(result[0].revenue) : 0;
};

const getPaymentStatus = async (orderId) => {
  const sql = `SELECT id as orderId, paymentStatus FROM orders WHERE id = ?`;
  const [rows] = await pool.execute(sql, [orderId]);
  return rows.length > 0 ? rows[0] : null;
};

const getByOrderCode = async ({ orderCode }, conn = pool) => {
  const sql = `
      SELECT
        o.id as orderId,
        o.status,
        o.paymentStatus,
        o.has_viewed_payment_result,
        SUM(oi.totalPrice) as amount
      FROM orders o 
      JOIN order_items oi ON o.id = oi.orderID 
      WHERE o.orderCode = ?
      GROUP BY  o.id
    `;
  const [rows] = await conn.execute(sql, [orderCode]);
  return rows.length > 0 ? rows[0] : null;
};

const markPaymentResultViewed = async ({ orderId }, conn = pool) => {
  const sql = `
      UPDATE orders o
      SET has_viewed_payment_result = TRUE, payment_result_viewed_at = CURRENT_TIMESTAMP()
      WHERE id = ? 
        AND o.has_viewed_payment_result = FALSE
    `;
  const [rows] = await conn.execute(sql, [orderId]);
  return rows;
};

const checkout = async (
  {
    cartId,
    customerName,
    email,
    phone,
    address,
    paymentMethod,
    userId,
    guestToken,
    ipAddr,
  },
  conn = pool,
) => {
  //Lay ve cartItem cua nguoi dung hien tai
  const cartItems = await cartItemService.getCartItemsByCartId(
    cartId,
    conn,
    true,
  );
  if (cartItems.length === 0) {
    const error = new BadRequestError("Your shopping cart is empty.");
    error.context = { reason: "CART_EMPTY", cartId };
    throw error;
  }

  // Kiểm tra và trừ đi quatity trước khi thêm vào orderItems
  await deductStockForOrder(conn, cartItems);

  //Tao order
  const { orderId, orderCode } = await createOrder(
    conn,
    { userId, guestToken },
    customerName,
    email,
    phone,
    address,
  );

  // Tinh cac gia tri de dua vao tao orderItem
  const { orderValues, totalPriceOrder } = calculateOrderValues(
    cartItems,
    orderId,
  );
  await order_itemService.createOrderItem(conn, orderValues);

  // Nếu paymentMethod = card | ? => build url return để trả về thêm field paymentUrl => Fe kiểm tra nếu có trường này -> redirect sang url đó .
  const transactionDefault = paymentMethod === "COD" ? "COD" : "";
  const paymentStatusDefault = "pending";

  const paymentResult = await paymentService.createPayment(
    conn,
    orderId,
    paymentMethod,
    totalPriceOrder,
    transactionDefault,
    paymentStatusDefault,
  );
  let paymentUrl = "";
  if (paymentMethod === "CARD") {
    paymentUrl = buildVnpayPaymentUrl({
      orderId: orderCode,
      amount: totalPriceOrder,
      ipAddr,
    });
  }
  await cartService.clearCart(cartId, conn);
  await outboxRepository.createPendingEvent(
    {
      eventType: OUTBOX_EVENT_TYPES.ORDER_CREATED,
      aggregateType: "order",
      aggregateId: orderId,
      payload: {
        orderId,
        orderCode,
        customerName,
        email,
        phone,
        address,
        totalPriceOrder,
        paymentMethod,
      },
    },
    conn,
  );

  return {
    orderId,
    orderCode,
    totalPriceOrder,
    paymentUrl,
    paymentId: paymentResult.insertId,
    paymentStatus: paymentStatusDefault,
  };
};

export default {
  getAllOrders,
  countTodayOrders,
  countYesterdayOrders,
  getOrdersByUserId,
  createOrder,
  updateOrder,
  updateOrderStatus,
  deleteOrder,
  getOrderById,
  getOrderByIdAndUser,
  tryAttachOrderToUser,
  revenue,
  confirmCodOrderPayment,
  getByOrderCode,
  getPaymentStatus,
  markPaymentResultViewed,
  updatePaymentStatus,
  checkout,
};
