# Giofchar Express SQL Backend

## 1. System Architecture

Dự án áp dụng mô hình **Layered Architecture** (Kiến trúc phân tầng) vững chắc, tách biệt rõ ràng các nhiệm vụ, giúp code dễ đọc, dễ bảo trì và dễ mở rộng (scale):

**Route -> Middleware -> Controller -> Service**

- **Routes (`src/routes`)**: Chịu trách nhiệm định tuyến các request đến các controller tương ứng. Route cũng là nơi gắn các Middleware như xác thực (Auth), phân quyền (Roles) hay xử lý File Upload.
- **Middlewares (`src/middlewares`)**: Lớp trung gian chặn bắt và xử lý dữ liệu trước khi nhảy vào Controller. Tại đây, dự án thực hiện việc xác thực `JWT token`, check quyền `admin`, phân tích `X-Guest-Token`, và xử lý các dịch vụ tích hợp như Cloudinary upload.
- **Controllers (`src/controllers`)**: Controller được thiết kế rất "mỏng" (Thin Controller), chỉ đóng vai trò tiếp nhận `req`, `res`, `next`. Controller nhận nhiệm vụ trích xuất dữ liệu (body, params, query, user profile từ middleware) và truyền sang cho Service. Thường Controller không can thiệp sâu vào logic dữ liệu.
- **Services (`src/services`)**: Nơi tập trung toàn bộ "chất xám" của ứng dụng. Mọi tương tác trực tiếp tới Database (Database Queries, Transactions), thuật toán xử lý luồng, việc kiểm tra tính hợp lệ nghiệp vụ đều được đặt ở lớp Service. Việc bóc tách này giúp tái sử dụng lại các hàm trong Service ở bất kỳ đâu trong dự án.

---

## 2. API Endpoints & Data Flow

Dưới đây là luồng Data flow chính của các Domain/Entities cốt lõi của hệ thống:

### Users API

| Method | Endpoint              | Description                          | Auth Required | Expected Response / Payload                                          |
| :----: | --------------------- | ------------------------------------ | :-----------: | -------------------------------------------------------------------- |
| `GET`  | `/users`              | Lấy danh sách toàn bộ hệ thống Users |     Admin     | `[ { id, email, role, customerName... } ]`                           |
| `GET`  | `/users/:userId`      | Xem chi tiết thông tin một User      |   Guest/No    | `{ id, email, customerName, phone... }`                              |
| `PUT`  | `/users/updateMyInfo` | Cập nhật hồ sơ cá nhân               |      Yes      | **Payload:** `{ phone, address... }`<br>**Res:** Thâm báo thành công |
| `POST` | `/users`              | Admin chủ động tạo mới một User      |     Admin     | **Payload:** `{ email, password, role }`                             |

### Foods (Products) API

| Method | Endpoint         | Description                           | Auth Required | Expected Response / Payload                          |
| :----: | ---------------- | ------------------------------------- | :-----------: | ---------------------------------------------------- |
| `GET`  | `/foods`         | Lấy danh sách sản phẩm                |   Guest/No    | `[ { id, foodName, image, category... } ]`           |
| `GET`  | `/foods/:foodId` | Xem chi tiết món và danh sách Variant |   Guest/No    | `{ id, foodName, variants: [...] }`                  |
| `POST` | `/foods`         | Thêm mới món ăn (kèm file Upload)     |     Admin     | **Payload:** `FormData` (`imageFood`, `foodName`...) |
| `PUT`  | `/foods/:foodId` | Cập nhật thông tin món ăn / Hình ảnh  |     Admin     | **Payload:** `FormData` (có thể update file ảnh)     |

### Carts API

|  Method  | Endpoint              | Description                 | Auth Required | Expected Response / Payload                  |
| :------: | --------------------- | --------------------------- | :-----------: | -------------------------------------------- |
|  `GET`   | `/carts/my-cartItems` | Giỏ hàng cá nhân            |   Yes/Guest   | `[ { variantId, quantity, totalPrice... } ]` |
|  `POST`  | `/carts/cartItem`     | Thêm items vào giỏ hàng     |   Yes/Guest   | **Payload:** `{ variantId, quantity }`       |
| `DELETE` | `/carts/:cartItemId`  | Bỏ 1 sản phẩm khỏi giỏ hàng |   Yes/Guest   | JSON `{ message: "Success" }`                |
| `DELETE` | `/carts`              | Reset / Làm sạch giỏ hàng   |   Yes/Guest   | JSON `{ message: "Cart cleared" }`           |

### Orders API

| Method | Endpoint                 | Description                        | Auth Required | Expected Response / Payload                                    |
| :----: | ------------------------ | ---------------------------------- | :-----------: | -------------------------------------------------------------- |
| `POST` | `/orders/user/cod`       | Đặt hàng cho tài khoản đã login    |      Yes      | **Payload:** `{ customerName, email, phone, address, cartId }` |
| `POST` | `/orders/guest/cod`      | Đặt hàng dưới dạng vãng lai        |     Guest     | **Payload:** Giống như trên                                    |
| `GET`  | `/orders/user/my-orders` | Trích xuất lịch sử đơn hàng        |      Yes      | `[ { orderId, orderCode, amount, status... } ]`                |
| `GET`  | `/orders`                | Tổng hợp thông tin Orders hệ thống |     Admin     | Danh sách thống kê tất cả Đơn hàng                             |

---

## 3. API Security & Authentication

- **JWT (JSON Web Tokens)**: Quá trình xác thực phiên người dùng chạy hoàn toàn qua stateless JWT. Backend cấp `accessToken` (được ký bằng `ACCESS_TOKEN_SECRET`). Tầng Middleware (`requireAuth`) sẽ bóc tách `Bearer Token`, xác minh và pass định danh qua biến `req.user` dành cho Controller.
- **Role-based Access Control (RBAC)**: Phân ranh giới quyền sắc nét. Các route nhạy cảm được chèn thêm middleware `checkAdmin`, bảo đảm người dùng thường không thể chỉnh sửa Menu, Giá cả hay xem Báo cáo doanh thu.
- **Guest Session qua `X-Guest-Token` & Merge Cart**:
  - Không bắt ép khách hàng phải tạo tài khoản ngay lập tức. Nếu Request đi lướt qua chưa có JWT, middleware `optionalAuth` sẽ đọc header thông qua `x-guest-token` và nhận diện đây là một "Guest Session".
  - Với Guest Token, khách vãng lai đã có thể lưu giỏ hàng `carts` (thông qua `guestToken` identifier) và tiến hành đặt hàng `orders` trơn tru. Khi khách quyết định Đăng ký hoặc Đăng nhập, hệ thống sẽ thực hiện luồng đồng bộ "Merge Cart" và liên kết các hóa đơn khách đã đặt (Attach Order to User) xuyên suốt từ guest sang tài khoản chính thức.

---

## 4. Technical Highlights

- **Centralized Error Handling**: Thay vì rải rác cú pháp `try-catch` lặp lại trên toàn bộ ứng dụng, code base sử dụng hàm Wrapper `asyncHandler` ở các routes tích hợp chạy với Error Middleware (trong `src/errors/errorHandler.js`). Mọi lỗi Logic (thông qua Custom Error Class như `BadRequestError`, `NotFoundError`) đến lỗi Database sẽ được gom về một mối xử lý và format dạng JSON chuẩn nhất để response về Frontend.
- **Database Transactions & Anti Race Condition**:
  - Do bài toán thương mại điện tử khá khắc nghiệt ở pha Checkout, các hàm Service nghiệp vụ cao dùng Transaction cứng (`conn.beginTransaction()`).
  - Toàn bộ flow như: _Update Stock -> Khởi tạo Order -> Tạo Order Items -> Gắn phương thức Payment -> Clear Cart_ diễn ra nguyên vẹn và atomic.
  - Vấn đề quá dòng đặt hàng (Race Condition) được xử lý thông qua Row Locking (`FOR UPDATE` reads) hoặc bằng Atomic Updates tự thân của hệ CSDL quan hệ (`UPDATE food_variants SET stock = stock - ? WHERE id = ? AND stock >= ?` - nếu kho không đủ sẽ gây fail query), đảm bảo không bao giờ có hiện tượng Overselling kho.
- **Connection Pool Management**: Không kết nối DB tùy tiện. Tận dụng `mysql2/promise` thông qua hệ đệm với `connectionLimit: 10`, `maxIdle: 10`, và auto `idleTimeout`. Vừa giúp CSDL duy trì Performance ở lượng người truy cập cao, vừa không bị sập tràn Connection.

---

## 5. Developer Onboarding & Quick Start Guide

Dành cho Developer mới (Fresher): Bạn có thể clone repository, khởi tạo database và chạy dự án trơn tru mà **không cần phải biết trước cấu trúc database** hay tự tay gõ từng câu lệnh tạo bảng.

### Yêu cầu tiền đề (Prerequisites)

- **Node.js**: phiên bản `>= 18.x`
- **MySQL**: phiên bản `5.7` hoặc `8.0` (Hoặc đã cài sẵn Docker & Docker Compose)

---

### Cách 1: Chạy Local bằng Node.js + MySQL Server

#### Bước 1: Clone Repository & Cài đặt Dependencies

```bash
git clone <repository_url>
cd GIOFCHAR_BACKEND_NODEJS
npm install
```

#### Bước 2: Thao tác file Cấu hình Môi trường (`.env`)

Tạo file `.env` từ file mẫu `.env_example`:

```bash
cp .env_example .env
```

Mở file `.env` và cập nhật thông tin kết nối MySQL Local của bạn:

```env
DB_HOST=127.0.0.1
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=GIOFCHAR
DB_PORT=3306
```

> **Lưu ý kiểm tra biến môi trường**: Khi khởi chạy ứng dụng, hệ thống tự động kiểm tra các biến môi trường bắt buộc (`DB_HOST`, `ACCESS_TOKEN_SECRET`...). Nếu thiếu biến bắt buộc, ứng dụng sẽ in thông báo cảnh báo trực quan để hỗ trợ bạn khắc phục ngay.

#### Bước 3: Khởi tạo Database & Seed Data

Chạy lệnh khởi tạo tự động toàn bộ Database Schema có quản lý phiên bản (Migration) cùng bộ Seed Data tối thiểu dành cho môi trường Development:

```bash
# Chạy cả Migration và Seed Data
npm run db:setup
```

Hoặc chạy từng lệnh riêng lẻ khi cần:

```bash
# Chạy Migration tạo bảng & version tracking
npm run db:migrate

# Seed dữ liệu mẫu (Admin, Test User, Danh mục, Món ăn mẫu)
npm run db:seed
```

#### Bước 4: Khởi chạy Ứng dụng

- **Môi trường Development (dùng Nodemon hot-reload)**:
  ```bash
  npm run dev
  ```
- **Môi trường Production (dùng Node.js tiêu chuẩn)**:
  ```bash
  npm start
  ```

---

### Chạy test với MySQL riêng

Vitest sử dụng database `giofchar_test`, tách biệt với database development. Tạo file cấu hình local từ mẫu:

```bash
cp .env.test.example .env.test
```

Cập nhật thông tin MySQL trong `.env.test`. Với MySQL chạy qua Docker Compose, host port mặc định là `3309`. Sau đó chạy migration và test:

```bash
docker compose up -d mysql
npm run db:migrate:test
npm test
```

Migration test chỉ chấp nhận tên database có hậu tố `_test`. Không chạy `db:seed` cho test repository.
Test MySQL thật cho outbox repository dọn các bản ghi fixture của chính nó trước và sau mỗi test. Có thể chạy riêng bằng:

```bash
npx vitest run test/integration/outbox.repository.test.js
```

Email `order.created` được dựng bởi `src/services/email/buildEmail.js`; worker dùng builder trước khi gọi email provider. Màu và nhận diện thương hiệu lấy từ package private `@giocha/brand-tokens`.

Để `npm ci` chạy được trên máy local, tài khoản Git cần quyền SSH đọc repository `VUTRUONG04/giocha-brand-tokens`. GitHub Actions cần secret `BRAND_TOKENS_DEPLOY_KEY`, chứa private key của deploy key chỉ có quyền đọc package repository. Tạo deploy key trong repository brand tokens, thêm public key dưới dạng read-only deploy key, rồi lưu private key trong Actions secrets của repository backend. Các môi trường build/deploy khác cũng cần quyền đọc repository này.

---

### Tài khoản thử nghiệm (Development Seed Accounts)

Sau khi chạy seed thành công, bạn có thể sử dụng các tài khoản có sẵn để test:

| Quyền hạn | Email                | Password | Ghi chú                                                 |
| --------- | -------------------- | -------- | ------------------------------------------------------- |
| **Admin** | `admin@giofchar.com` | `123456` | Quyền quản trị tối cao (Tạo món, đổi trạng thái đơn...) |
| **User**  | `user@giofchar.com`  | `123456` | Tài khoản khách hàng cơ bản                             |

---

## 6. External Service Dependencies (Dịch vụ bên ngoài)

Hệ thống kết nối và tích hợp các dịch vụ bên ngoài sau:

1. **MySQL (Database Engine)**:
   - **Phiên bản khuyến nghị**: `8.0+`.
   - **Vai trò**: CSDL quan hệ chính lưu trữ toàn bộ người dùng, món ăn, biến thể, giỏ hàng, đơn hàng, thanh toán và lịch sử giao dịch.

2. **Cloudinary (Quản lý & Lưu trữ hình ảnh)**:
   - **File cấu hình**: `src/config/cloudinary.js`
   - **Vai trò**: Lưu trữ hình ảnh sản phẩm được upload bởi Admin.
   - **Biến môi trường**: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.

3. **Google Gemini AI (`@google/genai`)**:
   - **File cấu hình**: `src/config/gemini.js`, `src/utils/switchGeminiKey.js`
   - **Vai trò**: Tư vấn món ăn thông minh cho khách hàng, tự động đưa ra gợi ý sản phẩm phù hợp.
   - **Biến môi trường**: `GEMINI_API_KEYS`.

4. **VNPay (Cổng thanh toán điện tử)**:
   - **File cấu hình**: `src/config/vnpay.js`
   - **Vai trò**: Tạo liên kết thanh toán an toàn qua cổng VNPay Sandbox/Production và nhận thông báo IPN Webhook xác nhận giao dịch thành công.
   - **Biến môi trường**: `VNP_TMN_CODE`, `VNP_HASH_SECRET`, `VNP_PAY_URL`, `VNP_RETURN_URL`, `VNP_IPN_URL`.
