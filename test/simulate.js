/**
 * Exercise Code.gs under Node by stubbing the Apps Script runtime
 * (DriveApp, MailApp, PropertiesService, LockService, ScriptApp).
 *
 *   node test/simulate.js
 *
 * No Google account, no real email. Exit code is non-zero if any check fails.
 */
const fs = require('fs');
const path = require('path');

// ---------------- Apps Script runtime stubs ----------------
let nextId = 1;
const outbox = [];
const props = {};
let failOnName = null;

function FakeFile(name, sizeBytes, mime) {
  this.id = 'f' + nextId++;
  this.name = name;
  this.size = sizeBytes;
  this.mime = mime || 'application/epub+zip';
  this.movedTo = null;
}
FakeFile.prototype.getId = function () { return this.id; };
FakeFile.prototype.getName = function () { return this.name; };
FakeFile.prototype.getMimeType = function () { return this.mime; };
FakeFile.prototype.getSize = function () { return this.size; };
FakeFile.prototype.getBlob = function () {
  const self = this;
  const blob = {
    _name: self.name,
    setName(n) { blob._name = n; return blob; },
    getBytes() { return new Array(self.size).fill(0); },
    getName() { return blob._name; }
  };
  return blob;
};
FakeFile.prototype.getAs = function () { return this.getBlob(); };
FakeFile.prototype.moveTo = function (folder) {
  // Drive's moveTo removes the file from its old parent
  if (this._parent) {
    const i = this._parent._files.indexOf(this);
    if (i !== -1) this._parent._files.splice(i, 1);
  }
  folder._files.push(this);
  this._parent = folder;
  this.movedTo = folder;
  return this;
};

function addFile(folder, file) {
  file._parent = folder;
  folder._files.push(file);
  return file;
}

function FakeFolder(name, parent) {
  this.id = 'd' + nextId++;
  this.name = name;
  this.parent = parent || null;
  this._files = [];
  this._folders = [];
}
FakeFolder.prototype.getName = function () { return this.name; };
FakeFolder.prototype.getId = function () { return this.id; };
FakeFolder.prototype.getFiles = function () {
  const list = this._files.slice();
  let i = 0;
  return { hasNext: () => i < list.length, next: () => list[i++] };
};
FakeFolder.prototype.getFoldersByName = function (n) {
  const list = this._folders.filter(f => f.name === n);
  let i = 0;
  return { hasNext: () => i < list.length, next: () => list[i++] };
};
FakeFolder.prototype.createFolder = function (n) {
  const f = new FakeFolder(n, this);
  this._folders.push(f);
  return f;
};

const root = new FakeFolder('Kindle');

const DriveApp = {
  getFolderById: () => root,
  getFoldersByName: () => {
    let used = false;
    return { hasNext: () => !used, next: () => { used = true; return root; } };
  },
  createFolder: n => root.createFolder(n)
};
const MailApp = {
  sendEmail: (o) => {
    if (failOnName && (o.attachments || []).some(a => a.getName() === failOnName)) {
      throw new Error('Service invoked too many times: email');
    }
    outbox.push(o);
  }
};
const PropertiesService = {
  getScriptProperties: () => ({
    getProperty: k => props[k] || null,
    setProperty: (k, v) => { props[k] = v; },
    deleteProperty: k => { delete props[k]; }
  })
};
const LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) };
const Logger = { log: () => {} };
const Session = { getEffectiveUser: () => ({ getEmail: () => 'me@example.com' }) };
const triggerLog = [];
const ScriptApp = {
  getProjectTriggers: () => [],
  deleteTrigger: () => {},
  newTrigger: (fn) => ({
    timeBased: () => ({ everyMinutes: (m) => ({ create: () => triggerLog.push(fn + '/' + m) }) })
  })
};

// ---------------- load the real Code.gs ----------------
const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const api = new Function(
  'DriveApp', 'MailApp', 'PropertiesService', 'LockService', 'Logger', 'Session', 'ScriptApp',
  src + '\nreturn { syncKindle, dryRun, setup, CONFIG };'
)(DriveApp, MailApp, PropertiesService, LockService, Logger, Session, ScriptApp);

// ---------------- scenarios ----------------
function kindleMails() { return outbox.filter(m => m.to === api.CONFIG.KINDLE_EMAIL); }
function noticeMails() { return outbox.filter(m => m.to === 'me@example.com'); }
function check(label, cond) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + label);
  if (!cond) process.exitCode = 1;
}

api.CONFIG.KINDLE_EMAIL = 'reader@kindle.com';

addFile(root, new FakeFile('sach-hay.epub', 1 * 1024 * 1024));
addFile(root, new FakeFile('sach-to.pdf', 21 * 1024 * 1024, 'application/pdf'));
addFile(root, new FakeFile('cu.mobi', 2 * 1024 * 1024, 'application/x-mobipocket-ebook'));
addFile(root, new FakeFile('tai-lieu.pdf', 2 * 1024 * 1024, 'application/pdf'));
addFile(root, new FakeFile('.DS_Store', 10));

console.log('--- run 1: mixed folder ---');
api.syncKindle();
console.log('sent to Kindle:', kindleMails().map(m => m.attachments[0].getName()));
console.log('problem emails:', noticeMails().length, noticeMails()[0] ? '\n' + noticeMails()[0].body : '');
const sentFolder = root._folders.find(f => f.name === '_sent');
check('sends exactly the 2 valid files', kindleMails().length === 2);
check('subject carries the [Kindle] prefix', kindleMails()[0].subject.startsWith('[Kindle] sach-hay.epub'));
check('sent files are moved into _sent', sentFolder && sentFolder._files.length === 2);
check('oversized and unsupported files stay in the folder', root._files.length === 3);
check('one problem email covers both issues', noticeMails().length === 1 &&
  /sach-to\.pdf/.test(noticeMails()[0].body) && /cu\.mobi/.test(noticeMails()[0].body));

console.log('\n--- run 2: nothing new must happen ---');
const before = outbox.length;
api.syncKindle();
check('a second run sends nothing', outbox.length === before);

console.log('\n--- run 3: MailApp throws ---');
addFile(root, new FakeFile('loi.epub', 500 * 1024));
failOnName = 'loi.epub';
const b2 = outbox.length;
api.syncKindle();
const stillThere = root._files.some(f => f.name === 'loi.epub');
check('a failed send leaves the file in the queue', stillThere);
check('the failure is reported', outbox.length === b2 + 1 &&
  /loi\.epub/.test(outbox[outbox.length - 1].body));

console.log('\n--- dryRun ---');
const b3 = outbox.length;
api.dryRun();
check('dryRun sends no mail', outbox.length === b3);
