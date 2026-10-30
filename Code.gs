/**
 * ============================================================
 *  Kindle Drive Sync  —  Google Drive ➜ Send to Kindle (email)
 * ============================================================
 *  Flow: you upload an ebook into one Drive folder  ➜  a 15-minute
 *  trigger sweeps the folder  ➜  each file is emailed to your Send
 *  to Kindle address  ➜  the file is moved into the "_sent" subfolder.
 *
 *  Trigger entry point      : syncKindle()
 *  Install / create trigger : setup()
 *  Preview, send nothing    : dryRun()
 *  Forget "already reported": resetReported()
 * ============================================================
 */

// ------------------------------------------------------------
//  1. CONFIG — this is the only block you need to edit
// ------------------------------------------------------------
const CONFIG = {
  // Your Send to Kindle address (Manage Your Content and Devices ➜
  // Send to Kindle Email Address). NOT your Amazon login email.
  KINDLE_EMAIL: 'your-name_xxxxxx@kindle.com',

  // Display name of the sender
  SENDER_NAME: 'Kindle Drive Sync',

  // How the source folder is resolved: FOLDER_ID wins when set,
  // otherwise the folder named FOLDER_NAME is used (created if missing).
  FOLDER_ID: '',
  FOLDER_NAME: 'Kindle',

  // Subfolder that receives files after a successful send
  SENT_SUBFOLDER: '_sent',

  // Files above this size are NOT sent (Gmail caps a message at ~25MB)
  // and are reported instead. 20MB is the safe value; 24MB at most.
  MAX_FILE_BYTES: 20 * 1024 * 1024,

  // Formats Amazon accepts by email (E001 = unsupported format).
  // AZW/AZW3/MOBI/KFX were dropped — convert to EPUB before uploading.
  ALLOWED_EXT: ['epub', 'pdf', 'txt', 'rtf', 'htm', 'html', 'png', 'jpg', 'jpeg', 'gif', 'bmp'],

  // Export Google Docs sitting in the folder to PDF and send them
  CONVERT_GOOGLE_DOCS: true,

  // Where problem reports go; '' = the account running the script
  NOTIFY_EMAIL: '',

  // Subject prefix for the emails sent to Kindle — keep it short
  SUBJECT_PREFIX: '[Kindle] '
};

// ------------------------------------------------------------
//  2. TRIGGER
// ------------------------------------------------------------

/**
 * Run once after editing CONFIG. Creates the folder if missing and
 * registers the 15-minute trigger.
 */
function setup() {
  const folder = getSourceFolder_();

  // drop existing triggers for the same handler so they do not pile up
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncKindle') ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('syncKindle').timeBased().everyMinutes(15).create();

  Logger.log('OK. Source folder: %s (id=%s)', folder.getName(), folder.getId());
  Logger.log('Created a trigger that runs every 15 minutes. Kindle: %s', CONFIG.KINDLE_EMAIL);

  // warn while the placeholder address is still in place
  if (CONFIG.KINDLE_EMAIL.indexOf('@kindle.com') === -1) {
    Logger.log('WARNING: CONFIG.KINDLE_EMAIL is not an @kindle.com address.');
  }
}

/**
 * Turn the automation off (leaves Drive files untouched, only removes the trigger).
 */
function uninstall() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncKindle') ScriptApp.deleteTrigger(t);
  });
  Logger.log('Trigger removed.');
}

// ------------------------------------------------------------
//  3. MAIN SWEEP
// ------------------------------------------------------------

function syncKindle() {
  // Keeps the timer and a manual run from overlapping and sending twice
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) {
    Logger.log('Skipping this run: the previous one has not finished.');
    return;
  }
  try {
    runSync_(false);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Dry run: list what would be sent, send nothing, move nothing.
 */
function dryRun() {
  runSync_(true);
}

function runSync_(isDryRun) {
  const srcFolder = getSourceFolder_();
  const sentFolder = getOrCreateSubfolder_(srcFolder, CONFIG.SENT_SUBFOLDER);

  // "already reported this file" memory, so a stuck file does not email
  // you every 15 minutes
  const props = PropertiesService.getScriptProperties();
  const reported = readReported_(props);

  const seen = {};        // keys of the files considered in this run
  const problems = [];    // new problems to report
  const sent = [];

  const files = srcFolder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    const name = file.getName();

    // skip junk files and files that are still uploading
    if (!name || name.charAt(0) === '.' || name.charAt(0) === '~') continue;

    // ---- work out the extension and the blob to send ----
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

    // ---- format check ----
    if (CONFIG.ALLOWED_EXT.indexOf(ext) === -1) {
      seen[key] = true;
      Logger.log('Skipped (unsupported format): %s', name);
      addProblem_(key, reported, problems, {
        file: name,
        reason: 'Format .' + (ext || '?') + ' is not supported by Send to Kindle' +
                ' (Amazon accepts EPUB, PDF, TXT, RTF, HTML, images).' +
                ' The file was left in the folder.'
      });
      continue;
    }

    // ---- size check ----
    if (sizeBytes > CONFIG.MAX_FILE_BYTES) {
      seen[key] = true;
      Logger.log('Skipped (too large): %s (%sMB)', name, mb_(sizeBytes));
      addProblem_(key, reported, problems, {
        file: name,
        reason: 'Size ' + mb_(sizeBytes) + 'MB exceeds the ' +
                mb_(CONFIG.MAX_FILE_BYTES) + 'MB limit (Gmail cannot send it).' +
                ' The file was left in the folder — upload it manually at' +
                ' https://www.amazon.com/sendtokindle'
      });
      continue;
    }

    // ---- send ----
    if (isDryRun) {
      Logger.log('[DRY RUN] would send: %s (%sMB)', outName, mb_(sizeBytes));
      sent.push(outName);
      continue;
    }

    try {
      MailApp.sendEmail({
        to: CONFIG.KINDLE_EMAIL,
        subject: CONFIG.SUBJECT_PREFIX + outName,
        body: 'Sent automatically from Google Drive: ' + outName,
        name: CONFIG.SENDER_NAME,
        attachments: [blob]
      });

      // move only after the mail went out
      file.moveTo(sentFolder);
      sent.push(outName);
      Logger.log('Sent: %s (%sMB)', outName, mb_(sizeBytes));
    } catch (err) {
      seen[key] = true;
      Logger.log('Send failed: %s — %s', name, err.message);
      addProblem_(key, reported, problems, {
        file: name,
        reason: 'Send failed: ' + err.message +
                ' — the file is still in the folder and will be retried on the next run.'
      });
    }
  }

  // garbage-collect the memory: keep only files that are still in the folder
  if (!isDryRun) writeReported_(props, seen);

  if (problems.length > 0 && !isDryRun) notifyProblems_(problems);

  Logger.log('Done. Sent %s file(s), %s problem(s).', sent.length, problems.length);
  return { sent: sent, problems: problems };
}

// ------------------------------------------------------------
//  4. HELPERS
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

/** Queue a problem for the report, but only if this file was not reported yet. */
function addProblem_(key, reported, problems, info) {
  if (reported[key]) return;
  problems.push(info.file + '\n    -> ' + info.reason);
}

function notifyProblems_(problems) {
  const to = CONFIG.NOTIFY_EMAIL || Session.getEffectiveUser().getEmail();
  if (!to) return;
  try {
    MailApp.sendEmail({
      to: to,
      subject: '[Kindle Sync] ' + problems.length + ' file(s) could not be sent',
      body: 'The script could not send these files to Kindle:\n\n' +
            problems.join('\n\n') +
            '\n\n--\nThe files are still in the source folder. Each file is reported once.'
    });
  } catch (e) {
    Logger.log('Could not send the problem report: ' + e.message);
  }
}

/** Forget the reported-files memory so every problem is reported again. */
function resetReported() {
  PropertiesService.getScriptProperties().deleteProperty('REPORTED');
  Logger.log('Reported-files memory cleared.');
}
