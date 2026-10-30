# Kindle Drive Sync

Drop an ebook into a Google Drive folder and it lands on your Kindle a few
minutes later. No server, no VPS, no desktop app running in the background —
just a Google Apps Script that polls the folder and emails new files to your
Kindle's *Send to Kindle* address.

*Tiếng Việt: [README.vi.md](README.vi.md)*

```
  you upload            Apps Script trigger            Amazon Send to Kindle
  ──────────►   Drive folder "Kindle"   ──(every 15 min)──►   e-mail ──►  Kindle
                        │
                        └── file moved to "Kindle/_sent" after a successful send
```

## Why

Amazon's Send to Kindle email service works great, but it means manually
attaching a file every time you buy a book. This project automates exactly
that hop: Drive folder in, Kindle library out. It runs on Google's
infrastructure, so your laptop can be asleep.

## Features

- **Zero infrastructure** — pure Apps Script, free tier, no Google Cloud
  project, no billing account.
- **Idempotent** — a script lock prevents overlapping runs, and a file is
  moved to `_sent/` only *after* the email was handed off successfully. A
  failed file stays in the queue and is retried on the next run.
- **Loud about problems, quiet otherwise** — unsupported formats and
  oversized files are reported by email exactly once per file, not every
  15 minutes.
- **Format and size guard** — validates against Amazon's accepted formats and
  against Gmail's real attachment ceiling before wasting a send.
- **Google Docs support** — a Google Doc sitting in the folder is exported to
  PDF and sent.
- **Dry run** — `dryRun()` prints what would be sent without sending anything.

## Requirements

- A Google account (the one that owns the Drive folder).
- A Kindle device or Kindle app registered to your Amazon account.
- That's it. No Node.js needed unless you want to run the local test suite.

## Quick start

### 1. Find your Send to Kindle address

Open <https://www.amazon.com/sendtokindle/email>, or go to
[Manage Your Content and Devices](https://www.amazon.com/mycd) → **Devices** →
select your Kindle → copy the address.

It looks like `yourname_ab12cd@kindle.com` and is **per device**, not the
email you sign in with. If you have several Kindles or the Kindle app, each
one has its own address — pick the device you actually read on.

### 2. Approve your Gmail as a sender

This is the step people skip, and it is the reason most "nothing arrived"
reports happen.

1. Go to <https://www.amazon.com/mycd> → **Preferences** →
   **Personal Document Settings**.
2. Under **Approved Personal Document E-mail List**, choose
   **Add a new approved e-mail address**.
3. Add the Gmail address of the Google account that will run the script
   (the account that owns the folder).

Without this, Amazon rejects the message with error **E014** and delivers
nothing.

### 3. Create the Drive folder

Create a folder named `Kindle` in your Drive (any name works, it is
configurable). No sharing is required — the script authenticates as you.

### 4. Create the Apps Script project

1. Open <https://script.google.com> → **New project**.
2. Replace the contents of `Code.gs` with [Code.gs](Code.gs) from this repo.
3. Turn on the manifest: **Project Settings** (gear icon) → tick
   **Show "appsscript.json" manifest file in editor**, then edit the
   `appsscript.json` tab and paste [appsscript.json](appsscript.json) from
   this repo.
4. Save (`⌘S` / `Ctrl+S`).

### 5. Configure

Edit the `CONFIG` block at the top of `Code.gs`:

```js
const CONFIG = {
  KINDLE_EMAIL: 'your-name_xxxxxx@kindle.com', // required
  FOLDER_NAME: 'Kindle',                       // folder to watch
  FOLDER_ID: '',                               // optional, wins over FOLDER_NAME
  MAX_FILE_BYTES: 20 * 1024 * 1024,            // raise to 24MB at most
  // ...
};
```

To pin the script to one folder regardless of its name, open the folder in
Drive and copy the ID from the URL:
`drive.google.com/drive/folders/`**`1AbC...xyz`** → `FOLDER_ID`.

Full option list: [Configuration reference](#configuration-reference).

### 6. Install the trigger

In the Apps Script editor, select the function **`setup`** in the toolbar
dropdown and click **Run**.

- Google asks for authorization the first time: **Review permissions** →
  pick your account → **Advanced** → **Go to Kindle Drive Sync (unsafe)** →
  **Allow**. "Unsafe" only means the script is your own and has not gone
  through Google's verification review; the scopes it requests are `drive`,
  `script.send_mail`, `script.scriptapp` and `userinfo.email`.
- `setup()` creates the folder if missing, registers the 15-minute trigger,
  and writes what it did to the execution log.

### 7. Verify

1. Check **Triggers** (clock icon in the left sidebar): you should see
   `syncKindle` / `Time-driven` / `Minutes timer` / `Every 15 minutes`.
2. Upload an `.epub` into the folder.
3. Wait up to 15 minutes (or select `syncKindle` and click **Run** to force a
   pass). The file moves into `_sent/`, and Amazon emails you a
   "sent to your Kindle" confirmation.

## Usage

- **Add books** — copy `.epub` / `.pdf` files into the watched folder.
- **Check what would happen** — run `dryRun()` and read **Executions**; it
  logs `[DRY RUN] will send: ...` and touches nothing.
- **Re-send a book** — move it from `_sent/` back into the parent folder; it
  will be picked up again on the next run.
- **Pause the automation** — run `uninstall()`. It deletes the trigger and
  leaves your files alone.
- **Force a manual pass** — run `syncKindle()`.

## Configuration reference

| Option | Default | Meaning |
| --- | --- | --- |
| `KINDLE_EMAIL` | *placeholder* | Per-device Send to Kindle address (`...@kindle.com`). |
| `SENDER_NAME` | `Kindle Drive Sync` | Display name on the outgoing email. |
| `FOLDER_ID` | `''` | Drive folder ID to watch. Takes precedence over `FOLDER_NAME` when set. |
| `FOLDER_NAME` | `Kindle` | Folder looked up by name; created if it does not exist. |
| `SENT_SUBFOLDER` | `_sent` | Subfolder that receives files after a successful send. |
| `MAX_FILE_BYTES` | `20 MB` | Files above this are skipped and reported. Keep ≤ 24 MB (Gmail limit). |
| `ALLOWED_EXT` | `epub, pdf, txt, rtf, htm, html, png, jpg, jpeg, gif, bmp` | Formats forwarded to Amazon. |
| `CONVERT_GOOGLE_DOCS` | `true` | Export Google Docs as PDF and send them. |
| `NOTIFY_EMAIL` | `''` | Where problem reports go; empty = the script owner's address. |
| `SUBJECT_PREFIX` | `[Kindle] ` | Prefix of the email subject. |

All strings — comments, execution-log lines, email bodies and problem reports —
are in English. To localize the notification emails, edit the `reason` strings in
`runSync_()` and the subject/body in `notifyProblems_()`.

## How it decides what to send

For every file directly inside the watched folder (subfolders are ignored):

1. Skip dotfiles and lock files (names starting with `.` or `~`).
2. Resolve the format — Google Docs become PDF, everything else uses its
   extension.
3. If the extension is not in `ALLOWED_EXT`: skip, leave in place, report
   once.
4. If the size is above `MAX_FILE_BYTES`: skip, leave in place, report once
   with a link to the web uploader (which accepts files up to 200 MB).
5. Otherwise send one email per file, then move the file into `_sent/`.

One email per file is deliberate: Amazon allows 50 MB per email but Gmail
caps a message at ~25 MB, so batching would fail exactly when it matters.

## Limits worth knowing

| Limit | Value | Impact |
| --- | --- | --- |
| Formats Amazon accepts | EPUB, PDF, TXT, RTF, HTML/HTM, PNG, JPG/JPEG, GIF, BMP | AZW/AZW3/MOBI/KFX are **not** accepted by email; convert to EPUB first (e.g. Calibre). |
| Attachments per email | 25 | Not reachable — one email per file. |
| Size per email | 50 MB (Amazon) / ~25 MB (Gmail) | Script threshold is 20 MB. |
| Approved senders | 15 per account | Only matters if you run several scripts/addresses. |
| Mail quota | 100 recipients/day (Gmail), 1500 (Workspace) | Only one email per new book. |
| Script runtime | 90 min/day (consumer) | Each run takes seconds. |
| Latency | up to 15 min | Lower it with `everyMinutes(5)` in `setup()`. |

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Amazon error **E014** | Sender not approved → [step 2](#2-approve-your-gmail-as-a-sender). |
| Amazon error **E001** | Unsupported format → convert to EPUB. |
| Amazon error **E004** / **E005** | PDF is password-protected or corrupted. |
| Amazon error **E007** | File above 50 MB — use the web uploader. |
| Nothing sent, no problem email | Check **Executions** in the Apps Script editor; the file may already be in `_sent/`, or the folder name/ID is wrong. |
| "Service invoked too many times: email" | Daily Gmail quota exhausted (100 recipients/day on consumer accounts). |
| Trigger never runs | Re-run `setup()`; confirm the trigger appears under **Triggers** with the 15-minute interval. |
| Sent twice | Two script projects are watching the same folder, or the same book was uploaded twice. |
| Book arrives with odd fonts/layout | Amazon converts EPUB on delivery; check the file renders correctly in a reader first. |

Press **Executions** in the Apps Script sidebar after any manual run — every
send, skip and failure is logged there with the file name and size.

## Local testing

The logic can be exercised without a Google account. `test/simulate.js`
stubs `DriveApp`, `MailApp`, `PropertiesService`, `LockService` and
`ScriptApp`, then asserts the real `Code.gs` behaviour:

```bash
node test/simulate.js
```

It covers: only valid files are sent, oversized and unsupported files are
blocked and reported once, a second run sends nothing again, a failed send
leaves the file in the queue, and `dryRun()` sends no mail.

```
PASS  sends exactly the 2 valid files
PASS  subject carries the [Kindle] prefix
PASS  sent files are moved into _sent
PASS  oversized and unsupported files stay in the folder
PASS  one problem email covers both issues
PASS  a second run sends nothing
PASS  a failed send leaves the file in the queue
PASS  the failure is reported
PASS  dryRun sends no mail
```

## Deploy with clasp (optional)

If you would rather not copy-paste:

```bash
npm install -g @google/clasp   # or use npx
clasp login
clasp create --title "Kindle Drive Sync" --type standalone
clasp push
clasp open
```

Then run `setup()` once from the editor to grant scopes and create the
trigger. `appsscript.json` is already in the shape clasp expects, so the
manifest does not need to be enabled by hand.

## Project structure

```
.
├── Code.gs            # all logic: config, trigger setup, sync loop, helpers
├── appsscript.json    # manifest: Asia/Ho_Chi_Minh timezone, OAuth scopes
├── test/simulate.js   # Node harness that stubs the Apps Script runtime
├── README.md          # this file
├── README.vi.md       # Vietnamese version
└── LICENSE            # MIT
```

## Security and privacy

- The script runs **as you** and requests full Drive access plus permission to
  send mail as you. That is what allows it to move files and send the email;
  read `Code.gs` before authorizing — it is ~290 lines with no external calls.
- Nothing leaves Google except the email to your own `@kindle.com` address.
  No third-party service, no analytics, no network requests other than Gmail.
- Keep `KINDLE_EMAIL` out of a public fork if you would rather not expose the
  address; a Kindle address alone still only accepts mail from senders you
  have approved.

## License

MIT — see [LICENSE](LICENSE).
