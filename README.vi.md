# Kindle Drive Sync

Upload ebook lên một folder Google Drive → sau tối đa 15 phút ebook tự được
gửi vào email Send to Kindle của bạn → file được chuyển vào `_sent`.

Thuần Google Apps Script: không cần server, không cần VPS, không cần máy bật
24/7.

*English: [README.md](README.md)*

```
  bạn upload             trigger Apps Script            Amazon Send to Kindle
  ──────────►   folder Drive "Kindle"   ──(mỗi 15 phút)──►   email ──►  Kindle
                        │
                        └── gửi xong thì file được chuyển vào "Kindle/_sent"
```

---

## 1. Chuẩn bị phía Amazon (làm 1 lần)

1. **Lấy địa chỉ Send to Kindle**
   - Vào https://www.amazon.com/sendtokindle/email (hoặc
     `Manage Your Content and Devices` → tab `Devices` → chọn máy Kindle
     → xem email dạng `ten_ban_ab12cd@kindle.com`).
   - Đây là email **riêng của thiết bị**, không phải email đăng nhập Amazon.
     Nếu bạn có nhiều Kindle/ứng dụng Kindle thì mỗi cái một địa chỉ —
     dùng địa chỉ của máy bạn muốn nhận.

2. **Cho phép Gmail của bạn làm người gửi** ← bước hay bị bỏ sót nhất
   - Vào https://www.amazon.com/mycd → `Preferences` →
     `Personal Document Settings`.
   - Mục `Approved Personal Document E-mail List` → `Add a new approved
     e-mail address` → nhập địa chỉ Gmail bạn sẽ chạy script
     (chính là Gmail của tài khoản Google chứa folder Drive).
   - Không thêm bước này, Amazon sẽ trả mã lỗi **E014** và không giao file.

3. **Tạo folder trên Drive**
   - Tạo folder tên `Kindle` (đổi tên được, xem `FOLDER_NAME` bên dưới).
   - Không cần share, không cần public.

---

## 2. Cài script (làm 1 lần)

1. Mở https://script.google.com → `New project`.
2. Xoá nội dung `Code.gs` mặc định, dán toàn bộ file `Code.gs` trong repo này.
3. Bật manifest: `Project Settings` (icon bánh răng) → tick
   `Show "appsscript.json" manifest file in editor` → quay lại tab
   `Editor`, mở `appsscript.json`, dán nội dung file cùng tên trong repo.
4. Sửa khối `CONFIG` ở đầu `Code.gs`:

```js
KINDLE_EMAIL: 'your-name_xxxxxx@kindle.com',  // ← bắt buộc
FOLDER_NAME:  'Kindle',                     // ← tên folder nguồn
FOLDER_ID:    '',                           // ← tuỳ chọn, ưu tiên hơn FOLDER_NAME
MAX_FILE_BYTES: 20 * 1024 * 1024,           // ← ngưỡng an toàn của Gmail
```

   Muốn khoá cứng vào 1 folder: mở folder trên Drive, ID là đoạn
   `1AbC...xyz` trong URL `drive.google.com/drive/folders/1AbC...xyz`,
   dán vào `FOLDER_ID`.

5. Chọn hàm `setup` trong dropdown → `Run`.
   - Lần đầu Google hỏi cấp quyền: `Review permissions` → chọn tài khoản
     → `Advanced` → `Go to Kindle Drive Sync (unsafe)` → `Allow`.
     ("unsafe" chỉ vì script tự viết chưa qua kiểm duyệt của Google.)
   - Script tạo folder nếu chưa có, tạo trigger 15 phút, và in log.

Kiểm tra: `Triggers` (icon đồng hồ) phải thấy `syncKindle` /
`Time-driven` / `Minutes timer` / `Every 15 minutes`.

---

## 3. Dùng

Upload/chép `.epub` hoặc `.pdf` vào folder `Kindle`. Sau tối đa 15 phút:

- File bay vào email → Kindle tự tải về (máy cần có wifi).
- File gốc được chuyển vào `Kindle/_sent/` (vẫn nằm trong Drive, không mất).
- Amazon gửi email xác nhận "đã gửi tới Kindle" — đó là dấu hiệu thành công.

Kiểm tra ngay mà không chờ trigger: chọn hàm `syncKindle` → `Run`.
Muốn xem trước mà không gửi gì: chọn hàm `dryRun` → `Executions`
để xem log `[DRY RUN] sẽ gửi: ...`.

Tắt tự động hoá: chọn hàm `uninstall` → `Run`.

---

## 4. Giới hạn & cách xử lý

| Vấn đề | Chi tiết |
|---|---|
| Định dạng | Amazon nhận: `EPUB`, `PDF`, `TXT`, `RTF`, `HTML/HTM`, `PNG/JPG/GIF/BMP`. **AZW/AZW3/MOBI/KFX không nhận** — phải convert sang EPUB trước (Calibre) rồi upload. File sai định dạng bị bỏ qua + email báo 1 lần. |
| Dung lượng | Amazon cho 50MB/file, nhưng **Gmail chỉ gửi được ~25MB** nên script chặn ở 20MB (đổi bằng `MAX_FILE_BYTES`, tối đa nên để 24MB). File quá lớn: bỏ qua, không di chuyển + email báo, kèm gợi ý upload thủ công tại https://www.amazon.com/sendtokindle (web uploader cho tới 200MB). |
| Số lượng | 25 file/email, 50MB/email phía Amazon. Script gửi **1 email cho 1 file** để tránh vượt hạn mức → 1 file 21MB vẫn gửi được dù tổng lớn. |
| Chậm 1 nhịp | File mới có thể được gửi chậm tối đa 15 phút. Muốn nhanh hơn: sửa `everyMinutes(15)` → `everyMinutes(5)` trong `setup()`. |
| Quota Gmail | Tài khoản thường: 100 email/ngày (quá đủ). Google Workspace: 1500. |
| File lỗi | Không bị chuyển vào `_sent`, sẽ thử lại ở lượt sau. Email báo lỗi chỉ gửi 1 lần cho mỗi file để khỏi spam. |
| Chống gửi trùng | Dùng `LockService` (chặn 2 lượt chạy chồng nhau) + chuyển file vào `_sent` ngay sau khi gửi thành công. Kéo file từ `_sent` trở lại folder = gửi lại. |

Mã lỗi Amazon hay gặp (Amazon gửi email cho bạn khi lỗi):

- **E014** – email người gửi chưa nằm trong Approved List → làm lại bước 1.2.
- **E001** – định dạng không hỗ trợ → convert sang EPUB.
- **E004/E005** – PDF bị khoá mật khẩu hoặc hỏng.
- **E007** – file > 50MB.

---

## 5. Chạy thử logic ở máy (không cần Google)

```bash
node test/simulate.js
```

Test giả lập Drive/Gmail bằng stub và kiểm tra: chỉ gửi file hợp lệ, file
quá lớn/sai định dạng bị chặn và báo 1 lần, không gửi lại lượt sau,
gửi lỗi thì file không bị chuyển đi, `dryRun` không gửi mail.

## 6. (Tuỳ chọn) Deploy bằng clasp thay vì copy-paste

```bash
npx @google/clasp login
npx @google/clasp create --title "Kindle Drive Sync" --type standalone
npx @google/clasp push
npx @google/clasp open
```

Sau đó vẫn phải vào editor chạy `setup()` một lần để cấp quyền + tạo trigger.
(Nếu dùng clasp, `appsscript.json` đã sẵn sàng, không cần tick manifest.)
