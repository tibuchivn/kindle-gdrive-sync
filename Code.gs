/**
 * ============================================================
 *  Kindle Drive Sync  —  Google Drive ➜ Send to Kindle (email)
 * ============================================================
 *  Luồng: bạn upload ebook vào 1 folder Drive  ➜  trigger 15 phút
 *  quét folder  ➜  gửi từng file vào email Send to Kindle của bạn
 *  ➜  file được chuyển vào subfolder "_sent".
 *
 *  Entry point chạy tự động : syncKindle()
 *  Cài đặt / tạo trigger  : setup()
 *  Xem trước, không gửi   : dryRun()
 *  Xoá ký ức "đã báo lỗi": resetReported()
 * ============================================================
 */

// ------------------------------------------------------------
//  1. CẤU HÌNH  — sửa mỗi phần này
// ------------------------------------------------------------
const CONFIG = {
  // Email Send to Kindle của bạn (Settings ➜ Send to Kindle Email Address)
  // KHÔNG phải email đăng nhập Amazon.
  KINDLE_EMAIL: 'ten-ban_xxxxxx@kindle.com',

  // Tên hiển thị của người gửi
  SENDER_NAME: 'Kindle Drive Sync',

  // Cách xác định folder nguồn: nếu FOLDER_ID có giá trị thì dùng nó,
  // ngược lại tìm folder theo tên FOLDER_NAME (tạo mới nếu chưa có).
  FOLDER_ID: '',
  FOLDER_NAME: 'Kindle',

  // Folder con nhận file đã gửi xong
  SENT_SUBFOLDER: '_sent',

  // File lớn hơn ngưỡng này sẽ KHÔNG gửi (Gmail cap ~25MB) mà báo cho bạn.
  // 20MB là mức an toàn; có thể nâng lên 24MB nếu ebook thường to.
  MAX_FILE_BYTES: 20 * 1024 * 1024,

  // Định dạng Amazon nhận qua email (E001 = format không hỗ trợ).
  // AZW/AZW3/MOBI/KFX đã bị bỏ — cần convert sang EPUB trước khi upload.
  ALLOWED_EXT: ['epub', 'pdf', 'txt', 'rtf', 'htm', 'html', 'png', 'jpg', 'jpeg', 'gif', 'bmp'],

  // Google Docs/Sheets nằm trong folder thì export thành PDF rồi gửi
  CONVERT_GOOGLE_DOCS: true,

  // Nơi nhận email báo lỗi; '' = gửi về chính tài khoản đang chạy script
  NOTIFY_EMAIL: '',

  // Chủ đề email gửi Kindle — giữ ngắn gọn
  SUBJECT_PREFIX: '[Kindle] '
};

// ------------------------------------------------------------
//  2. TRIGGER
// ------------------------------------------------------------

/**
 * Chạy 1 lần sau khi sửa CONFIG. Tạo folder nếu chưa có, tạo trigger 15 phút.
 */
function setup() {
  const folder = getSourceFolder_();

  // xoá trigger cũ của cùng handler để không bị nhân đôi
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncKindle') ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('syncKindle').timeBased().everyMinutes(15).create();

  Logger.log('OK. Folder nguồn: %s (id=%s)', folder.getName(), folder.getId());
  Logger.log('Đã tạo trigger chạy mỗi 15 phút. Kindle: %s', CONFIG.KINDLE_EMAIL);

  // nhắc nếu còn để nguyên email mẫu
  if (CONFIG.KINDLE_EMAIL.indexOf('@kindle.com') === -1) {
    Logger.log('CẢNH BÁO: CONFIG.KINDLE_EMAIL chưa phải địa chỉ @kindle.com.');
  }
}

/**
 * Tắt tự động hoá (giữ nguyên file Drive, chỉ bỏ trigger).
 */
function uninstall() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncKindle') ScriptApp.deleteTrigger(t);
  });
  Logger.log('Đã xoá trigger.');
}

// ------------------------------------------------------------
//  3. LUỒNG CHÍNH
// ------------------------------------------------------------

function syncKindle() {
  // Tránh 2 lượt chạy chồng nhau (trigger 15' + chạy tay) gửi trùng file
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) {
    Logger.log('Bỏ qua lượt này: lượt trước chưa chạy xong.');
    return;
  }
  try {
    runSync_(false);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Chạy thử: liệt kê file sẽ gửi, không gửi và không di chuyển gì.
 */
function dryRun() {
  runSync_(true);
}

function runSync_(isDryRun) {
  const srcFolder = getSourceFolder_();
  const sentFolder = getOrCreateSubfolder_(srcFolder, CONFIG.SENT_SUBFOLDER);

  // Ký ức "đã báo lỗi file này" để không spam email mỗi 15 phút
  const props = PropertiesService.getScriptProperties();
  const reported = readReported_(props);

  const seen = {};        // key các file được xét trong lượt này
  const problems = [];    // nội dung báo lỗi mới
  const sent = [];

  const files = srcFolder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    const name = file.getName();

    // bỏ qua file rác / file đang upload dở
    if (!name || name.charAt(0) === '.' || name.charAt(0) === '~') continue;

    // ---- xác định ext + blob sẽ gửi ----
    const mime = file.getMimeType();
    let ext, sizeBytes, blob, outName = name;

    if (mime === 'application/vnd.google-apps.document') {
      if (!CONFIG.CONVERT_GOOGLE_DOCS) continue;
      ext = 'pdf';
      outName = baseName_(name) + '.pdf';
      if (!isDryRun) {
        blob = file.getAs('application/pdf');
        blob.setName(outName);
        sizeBytes = blob.getBytes().length;
      } else {
        sizeBytes = 0;
      }
    } else if (mime === 'application/vnd.google-apps.folder') {
      continue;
    } else {
      ext = extOf_(name);
      sizeBytes = file.getSize();
      if (!isDryRun) {
        blob = file.getBlob();
        blob.setName(name);
      }
    }

    const key = file.getId() + ':' + sizeBytes;

    // ---- kiểm tra định dạng ----
    if (CONFIG.ALLOWED_EXT.indexOf(ext) === -1) {
      seen[key] = true;
      addProblem_(key, reported, problems, {
        file: name,
        reason: 'Định dạng .' + (ext || '?') + ' không được Send to Kindle hỗ trợ' +
                ' (Amazon nhận EPUB, PDF, TXT, RTF, HTML, ảnh). File được để nguyên trong folder.'
      });
      continue;
    }

    // ---- kiểm tra dung lượng ----
    if (sizeBytes > CONFIG.MAX_FILE_BYTES) {
      seen[key] = true;
      addProblem_(key, reported, problems, {
        file: name,
        reason: 'Dung lượng ' + mb_(sizeBytes) + 'MB vượt ngưỡng ' +
                mb_(CONFIG.MAX_FILE_BYTES) + 'MB (Gmail không gửi được).' +
                ' File được để nguyên — hãy upload thủ công tại https://www.amazon.com/sendtokindle'
      });
      continue;
    }

    // ---- gửi ----
    if (isDryRun) {
      Logger.log('[DRY RUN] sẽ gửi: %s (%sMB)', outName, mb_(sizeBytes));
      sent.push(outName);
      continue;
    }

    try {
      MailApp.sendEmail({
        to: CONFIG.KINDLE_EMAIL,
        subject: CONFIG.SUBJECT_PREFIX + outName,
        body: 'Tự động gửi từ Google Drive: ' + outName,
        name: CONFIG.SENDER_NAME,
        attachments: [blob]
      });

      // chỉ di chuyển sau khi gửi thành công
      file.moveTo(sentFolder);
      sent.push(outName);
      Logger.log('Đã gửi: %s (%sMB)', outName, mb_(sizeBytes));
    } catch (err) {
      seen[key] = true;
      addProblem_(key, reported, problems, {
        file: name,
        reason: 'Gửi thất bại: ' + err.message + ' — file vẫn nằm trong folder, sẽ thử lại lượt sau.'
      });
    }
  }

  // dọn ký ức: chỉ giữ các file còn nằm trong folder
  if (!isDryRun) writeReported_(props, seen);

  if (problems.length > 0 && !isDryRun) notifyProblems_(problems);

  Logger.log('Xong. Gửi %s file, %s vấn đề.', sent.length, problems.length);
  return { sent: sent, problems: problems };
}

// ------------------------------------------------------------
//  4. TIỆN ÍCH
// ------------------------------------------------------------

function getSourceFolder_() {
  if (CONFIG.FOLDER_ID) return DriveApp.getFolderById(CONFIG.FOLDER_ID);
  const it = DriveApp.getFoldersByName(CONFIG.FOLDER_NAME);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(CONFIG.FOLDER_NAME);
}

function getOrCreateSubfolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function extOf_(name) {
  const m = /\.([A-Za-z0-9]{1,6})$/.exec(name);
  return m ? m[1].toLowerCase() : '';
}

function baseName_(name) {
  return name.replace(/\.[^./]+$/, '');
}

function mb_(bytes) {
  return (Math.round(bytes / 1024 / 1024 * 10) / 10);
}

function readReported_(props) {
  try {
    return JSON.parse(props.getProperty('REPORTED') || '{}');
  } catch (e) {
    return {};
  }
}

function writeReported_(props, map) {
  props.setProperty('REPORTED', JSON.stringify(map));
}

/** Thêm vấn đề vào danh sách báo cáo, nhưng chỉ khi chưa báo cho file này. */
function addProblem_(key, reported, problems, info) {
  if (reported[key]) return;
  problems.push(info.file + '\n    → ' + info.reason);
}

function notifyProblems_(problems) {
  const to = CONFIG.NOTIFY_EMAIL || Session.getEffectiveUser().getEmail();
  if (!to) return;
  try {
    MailApp.sendEmail({
      to: to,
      subject: '[Kindle Sync] ' + problems.length + ' file không gửi được',
      body: 'Script không gửi được các file sau lên Kindle:\n\n' +
            problems.join('\n\n') +
            '\n\n--\nFile vẫn nằm trong folder nguồn. Mỗi file chỉ được báo 1 lần.'
    });
  } catch (e) {
    Logger.log('Không gửi được email báo lỗi: ' + e.message);
  }
}

/** Xoá ký ức đã-báo để lần sau báo lại toàn bộ vấn đề. */
function resetReported() {
  PropertiesService.getScriptProperties().deleteProperty('REPORTED');
  Logger.log('Đã xoá ký ức báo lỗi.');
}
