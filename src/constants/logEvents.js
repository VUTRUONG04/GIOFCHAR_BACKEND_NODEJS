export const LOG_ACTIONS = {
  SYSTEM: {
    SERVER: "server",
    DATABASE_CONNECTION: "database_connection",
    HTTP_REQUEST: "http_request",
    UNHANDLED_ERROR: "unhandled_error",

    APPLICATION_STARTUP: "application_startup",
    APPLICATION_SHUTDOWN: "application_shutdown",
    PROCESS_ERROR: "process_error",
  },
  AUTH: {
    REGISTER: "register",
    LOGIN: "login",
    LOGOUT: "logout",
    AUTHENTICATE: "authenticate",
    AUTHORIZE_ACCESS: "authorize_access",
  },
  CART: {
    CHANGE_ITEM: "change_cart_item",
    CLEAR: "clear_cart",
    MERGE_TO_USER: "merge_cart_to_user",
  },
  CATEGORY: {
    CREATE: "create_category",
    UPDATE: "update_category",
    DELETE: "delete_category",
  },
  AI: {
    REQUEST: "ai_request",
    PREPARE_CONTEXT: "prepare_ai_context",
    SLOT_FILLING: "ai_slot_filling",
  },
  CLOUDINARY: {
    UPLOAD_IMAGE: "upload_cloudinary_image",
    DELETE_IMAGE: "delete_cloudinary_image",
    CLEANUP_IMAGE: "cleanup_cloudinary_image",
  },
  FILE: {
    DELETE_TEMPORARY: "delete_temporary_file",
  },
  USER: {
    CREATE: "create_user",
    UPDATE: "update_user",
    DELETE: "delete_user",
  },
  ORDER: {
    CHECKOUT: "checkout",
    CREATE: "create_order",
    ATTACH_TO_USER: "attach_order_to_user",
    CREATE_ITEMS: "create_order_items",
  },
  PAYMENT: {
    CREATE: "payment",
    BUILD_URL: "build_payment_url",
    VERIFY_CALLBACK: "verify_payment_callback",
    VALIDATE_CALLBACK: "validate_payment_callback",
    PROCESS_CALLBACK: "process_payment_callback",
  },
  EMAIL: {
    WORKER: "email_worker",
  },
  TRANSACTION: "transaction",
};

export const LOG_STATUSES = {
  STARTED: "started",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CREATED: "created",
  COMPLETED: "completed",
  COMMITTED: "committed",
  ROLLED_BACK: "rolled_back",
  ALLOWED: "allowed",
  DENIED: "denied",
  RETRYING: "retrying",
  PREPARED: "prepared",
  SKIPPED: "skipped",
  ABORTED: "aborted",
};
