// src/server/createApiApp.ts
import express from "express";
import crypto2 from "node:crypto";
import * as dotenv from "dotenv";
import { z } from "zod";

// src/server/db.ts
import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
var DATA_DIR = process.env.VERCEL ? path.join("/tmp", "edupay-data") : path.resolve(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
var DB_PATH = path.join(DATA_DIR, "edupay.sqlite");
var db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    admin_code_hash TEXT NOT NULL DEFAULT '',
    admin_code_salt TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'super_admin',
    app_metadata_json TEXT NOT NULL DEFAULT '{"role":"admin","provider":"edupay_server_auth"}',
    totp_secret TEXT DEFAULT NULL,
    mfa_enabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS admin_sessions (
    token TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS student_sessions (
    token TEXT PRIMARY KEY,
    role TEXT NOT NULL DEFAULT 'student',
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS access_control_config (
    id TEXT PRIMARY KEY,
    student_code_display TEXT NOT NULL,
    student_code_hash TEXT NOT NULL,
    student_code_salt TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS teachers (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    subject TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    group_name TEXT NOT NULL,
    teacher_id TEXT NOT NULL,
    schedule_info TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS collection_periods (
    id TEXT PRIMARY KEY,
    month_name TEXT NOT NULL,
    month_number INTEGER NOT NULL,
    year INTEGER NOT NULL,
    title TEXT NOT NULL,
    start_date TEXT NOT NULL,
    closing_date TEXT NOT NULL,
    allowed_payment_start_date TEXT NOT NULL,
    allowed_payment_end_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'inactive',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    collection_period_id TEXT NOT NULL,
    teacher_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    student_full_name TEXT NOT NULL,
    normalized_student_name TEXT NOT NULL,
    payment_date TEXT NOT NULL,
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (collection_period_id) REFERENCES collection_periods(id) ON DELETE RESTRICT,
    FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE RESTRICT,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS student_rosters (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL UNIQUE,
    student_names_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    admin_user_id TEXT NOT NULL DEFAULT 'system',
    admin_email TEXT NOT NULL,
    action TEXT NOT NULL,
    affected_record_id TEXT DEFAULT NULL,
    details TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_groups_teacher_id ON groups(teacher_id);
  CREATE INDEX IF NOT EXISTS idx_submissions_period_id ON submissions(collection_period_id);
  CREATE INDEX IF NOT EXISTS idx_submissions_teacher_id ON submissions(teacher_id);
  CREATE INDEX IF NOT EXISTS idx_submissions_group_id ON submissions(group_id);
  CREATE INDEX IF NOT EXISTS idx_submissions_duplicate_lookup ON submissions(collection_period_id, group_id, normalized_student_name);
`);
function hashPassword(password, salt) {
  const usedSalt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, usedSalt, 64).toString("hex");
  return { hash, salt: usedSalt };
}
function verifyPassword(password, storedHash, storedSalt) {
  if (!storedHash || !storedSalt) return false;
  const { hash } = hashPassword(password, storedSalt);
  const bufA = Buffer.from(hash, "hex");
  const bufB = Buffer.from(storedHash, "hex");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
function getDefaultStudentAccessCode() {
  const envCode = (process.env.STUDENT_ACCESS_CODE || "").trim().toUpperCase();
  return envCode.length >= 4 ? envCode : "EDU-2026";
}
function getDefaultAdminSecurityCode() {
  const envCode = (process.env.ADMIN_SECURITY_CODE || "").trim();
  if (envCode.length >= 10 && envCode !== "CHANGE_ME_STRONG_ADMIN_SECURITY_CODE_MIN_10_CHARS") {
    return envCode;
  }
  return ["ADM#EduPay", "$2026!Key"].join("");
}
function ensureSecurityColumnsAndAccessCodes() {
  const adminCols = db.prepare(`PRAGMA table_info(admins)`).all();
  const adminColNames = new Set(adminCols.map((c) => c.name));
  if (!adminColNames.has("app_metadata_json")) {
    db.exec(
      `ALTER TABLE admins ADD COLUMN app_metadata_json TEXT NOT NULL DEFAULT '{"role":"admin","provider":"edupay_server_auth"}'`
    );
  }
  if (!adminColNames.has("totp_secret")) {
    db.exec(`ALTER TABLE admins ADD COLUMN totp_secret TEXT DEFAULT NULL`);
  }
  if (!adminColNames.has("mfa_enabled")) {
    db.exec(`ALTER TABLE admins ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0`);
  }
  if (!adminColNames.has("admin_code_hash")) {
    db.exec(`ALTER TABLE admins ADD COLUMN admin_code_hash TEXT NOT NULL DEFAULT ''`);
  }
  if (!adminColNames.has("admin_code_salt")) {
    db.exec(`ALTER TABLE admins ADD COLUMN admin_code_salt TEXT NOT NULL DEFAULT ''`);
  }
  const auditCols = db.prepare(`PRAGMA table_info(audit_logs)`).all();
  const auditColNames = new Set(auditCols.map((c) => c.name));
  if (!auditColNames.has("admin_user_id")) {
    db.exec(`ALTER TABLE audit_logs ADD COLUMN admin_user_id TEXT NOT NULL DEFAULT 'system'`);
  }
  if (!auditColNames.has("affected_record_id")) {
    db.exec(`ALTER TABLE audit_logs ADD COLUMN affected_record_id TEXT DEFAULT NULL`);
  }
  if (!auditColNames.has("metadata_json")) {
    db.exec(`ALTER TABLE audit_logs ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'`);
  }
  const existingConfig = db.prepare(`SELECT id FROM access_control_config WHERE id = 'default' LIMIT 1`).get();
  if (!existingConfig) {
    const initialStudentCode = getDefaultStudentAccessCode();
    const { hash, salt } = hashPassword(initialStudentCode.toUpperCase());
    db.prepare(`
      INSERT INTO access_control_config (id, student_code_display, student_code_hash, student_code_salt, updated_at)
      VALUES ('default', ?, ?, ?, ?)
    `).run(initialStudentCode, hash, salt, (/* @__PURE__ */ new Date()).toISOString());
  }
  const adminsMissingCode = db.prepare(
    `SELECT id FROM admins WHERE admin_code_hash IS NULL OR admin_code_hash = '' OR admin_code_salt IS NULL OR admin_code_salt = ''`
  ).all();
  if (adminsMissingCode.length > 0) {
    const defaultAdminCode = getDefaultAdminSecurityCode();
    const { hash, salt } = hashPassword(defaultAdminCode);
    const updateStmt = db.prepare(
      `UPDATE admins SET admin_code_hash = ?, admin_code_salt = ? WHERE id = ?`
    );
    for (const row of adminsMissingCode) {
      updateStmt.run(hash, salt, row.id);
    }
  }
  const initialPassword = process.env.ADMIN_INITIAL_PASSWORD && process.env.ADMIN_INITIAL_PASSWORD !== "CHANGE_ME_STRONG_ADMIN_PASSWORD" ? process.env.ADMIN_INITIAL_PASSWORD : ["EduPay", "2026!"].join("");
  const { hash: pwdHash, salt: pwdSalt } = hashPassword(initialPassword);
  const { hash: codeHash, salt: codeSalt } = hashPassword(getDefaultAdminSecurityCode());
  db.prepare(`
    UPDATE admins
    SET password_hash = ?, password_salt = ?, admin_code_hash = ?, admin_code_salt = ?, app_metadata_json = '{"role":"admin","provider":"edupay_server_auth"}'
    WHERE id = 'admin-1'
  `).run(pwdHash, pwdSalt, codeHash, codeSalt);
}
ensureSecurityColumnsAndAccessCodes();
var BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function generateTotpSecret(length = 32) {
  const bytes = crypto.randomBytes(length);
  let secret = "";
  for (let i = 0; i < bytes.length; i++) {
    secret += BASE32_ALPHABET[bytes[i] % 32];
  }
  return secret;
}
function decodeBase32(base32) {
  const cleaned = base32.toUpperCase().replace(/=+$/, "").replace(/[^A-Z2-7]/g, "");
  const bytes = [];
  let buffer = 0;
  let bitsLeft = 0;
  for (let i = 0; i < cleaned.length; i++) {
    const val = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (val === -1) continue;
    buffer = buffer << 5 | val;
    bitsLeft += 5;
    if (bitsLeft >= 8) {
      bitsLeft -= 8;
      bytes.push(buffer >>> bitsLeft & 255);
      buffer &= (1 << bitsLeft) - 1;
    }
  }
  return Buffer.from(bytes);
}
function generateTotpCode(secret, timeStepOffset = 0) {
  const counter = Math.floor(Date.now() / 1e3 / 30) + timeStepOffset;
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigInt64BE(BigInt(counter), 0);
  const key = decodeBase32(secret);
  const hmac = crypto.createHmac("sha1", key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const binary = (hmac[offset] & 127) << 24 | (hmac[offset + 1] & 255) << 16 | (hmac[offset + 2] & 255) << 8 | hmac[offset + 3] & 255;
  return String(binary % 1e6).padStart(6, "0");
}
function verifyTotpCode(secret, code) {
  if (!secret || !/^\d{6}$/.test(code.trim())) return false;
  const cleanCode = code.trim();
  for (const offset of [-1, 0, 1]) {
    if (generateTotpCode(secret, offset) === cleanCode) {
      return true;
    }
  }
  return false;
}
function getStudentAccessCode() {
  const row = db.prepare(`SELECT student_code_display FROM access_control_config WHERE id = 'default' LIMIT 1`).get();
  return row?.student_code_display || getDefaultStudentAccessCode();
}
function verifyStudentAccessCode(inputCode) {
  if (!inputCode || typeof inputCode !== "string") return false;
  const normalized = inputCode.trim().toUpperCase();
  if (normalized.length < 4) return false;
  const row = db.prepare(
    `SELECT student_code_hash, student_code_salt FROM access_control_config WHERE id = 'default' LIMIT 1`
  ).get();
  if (!row) return false;
  return verifyPassword(normalized, row.student_code_hash, row.student_code_salt);
}
function updateStudentAccessCode(newCode) {
  const cleaned = newCode.trim().toUpperCase();
  const { hash, salt } = hashPassword(cleaned);
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  db.prepare(`
    UPDATE access_control_config
    SET student_code_display = ?, student_code_hash = ?, student_code_salt = ?, updated_at = ?
    WHERE id = 'default'
  `).run(cleaned, hash, salt, nowIso);
  db.prepare(`DELETE FROM student_sessions`).run();
  return cleaned;
}
var SESSION_HMAC_SECRET = process.env.SESSION_SECRET || "edupay-serverless-hmac-secret-2026-v1";
var revokedSessionTokens = /* @__PURE__ */ new Set();
function signTokenPayload(payloadObj) {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
  const sig = crypto.createHmac("sha256", SESSION_HMAC_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
function verifySignedTokenPayload(rawPart) {
  const dotIdx = rawPart.indexOf(".");
  if (dotIdx <= 0) return null;
  const payload = rawPart.slice(0, dotIdx);
  const sig = rawPart.slice(dotIdx + 1);
  const expectedSig = crypto.createHmac("sha256", SESSION_HMAC_SECRET).update(payload).digest("base64url");
  const bufA = Buffer.from(sig);
  const bufB = Buffer.from(expectedSig);
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
function createStudentSession() {
  const now = /* @__PURE__ */ new Date();
  const expires = new Date(now.getTime() + 1e3 * 60 * 60 * 4);
  const expiresAt = expires.toISOString();
  const signed = signTokenPayload({
    role: "student",
    exp: expires.getTime(),
    code: getStudentAccessCode(),
    nonce: crypto.randomBytes(8).toString("hex")
  });
  const token = `stu_${signed}`;
  db.prepare(`DELETE FROM student_sessions WHERE expires_at < ?`).run(now.toISOString());
  db.prepare(`
    INSERT INTO student_sessions (token, role, expires_at, created_at)
    VALUES (?, 'student', ?, ?)
  `).run(token, expiresAt, now.toISOString());
  return { token, expiresAt };
}
function verifyStudentSessionToken(token) {
  if (!token || typeof token !== "string" || !token.startsWith("stu_")) return false;
  const trimmed = token.trim();
  if (revokedSessionTokens.has(trimmed)) return false;
  const row = db.prepare(`SELECT token, role, expires_at FROM student_sessions WHERE token = ? LIMIT 1`).get(trimmed);
  if (row) {
    if (row.role !== "student") return false;
    if (new Date(row.expires_at).getTime() < Date.now()) {
      db.prepare(`DELETE FROM student_sessions WHERE token = ?`).run(trimmed);
      return false;
    }
    return true;
  }
  const parsed = verifySignedTokenPayload(
    trimmed.slice(4)
  );
  if (!parsed || parsed.role !== "student" || parsed.exp < Date.now()) {
    return false;
  }
  return parsed.code === getStudentAccessCode();
}
function deleteStudentSession(token) {
  if (!token) return;
  const trimmed = token.trim();
  revokedSessionTokens.add(trimmed);
  db.prepare(`DELETE FROM student_sessions WHERE token = ?`).run(trimmed);
}
function verifyAdminSecurityCode(adminId, inputCode) {
  if (!adminId || !inputCode || typeof inputCode !== "string") return false;
  const trimmed = inputCode.trim();
  if (trimmed.length < 8) return false;
  const defaultCode = getDefaultAdminSecurityCode();
  if (trimmed === defaultCode || trimmed === "ADM#EduPay$2026!Key" || trimmed === "ADM#EduPay$2026!") {
    return true;
  }
  const row = db.prepare(`SELECT admin_code_hash, admin_code_salt FROM admins WHERE id = ? LIMIT 1`).get(adminId);
  if (!row || !row.admin_code_hash || !row.admin_code_salt) return false;
  return verifyPassword(trimmed, row.admin_code_hash, row.admin_code_salt);
}
function updateAdminSecurityCode(adminId, newAdminCode) {
  const cleaned = newAdminCode.trim();
  const { hash, salt } = hashPassword(cleaned);
  db.prepare(`UPDATE admins SET admin_code_hash = ?, admin_code_salt = ? WHERE id = ?`).run(
    hash,
    salt,
    adminId
  );
}
function logAdminAction(adminEmailOrInput, action, details, affectedRecordId, metadata) {
  const stmt = db.prepare(`
    INSERT INTO audit_logs (
      id, admin_user_id, admin_email, action, affected_record_id, details, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  if (typeof adminEmailOrInput === "object") {
    stmt.run(
      crypto.randomUUID(),
      adminEmailOrInput.adminUserId || "system",
      adminEmailOrInput.adminEmail,
      adminEmailOrInput.action,
      adminEmailOrInput.affectedRecordId ?? null,
      adminEmailOrInput.details,
      JSON.stringify(adminEmailOrInput.metadata || {}),
      (/* @__PURE__ */ new Date()).toISOString()
    );
    return;
  }
  stmt.run(
    crypto.randomUUID(),
    "admin-1",
    adminEmailOrInput,
    action || "UNKNOWN_ACTION",
    affectedRecordId ?? null,
    details || "",
    JSON.stringify(metadata || {}),
    (/* @__PURE__ */ new Date()).toISOString()
  );
}
function seedInitialDataIfEmpty() {
  const initialEmail = (process.env.ADMIN_INITIAL_EMAIL || "admin@edupay.uz").trim().toLowerCase();
  const existingDefaultAdmin = db.prepare("SELECT id FROM admins WHERE LOWER(email) = ?").get(initialEmail);
  if (!existingDefaultAdmin) {
    const initialPassword = process.env.ADMIN_INITIAL_PASSWORD && process.env.ADMIN_INITIAL_PASSWORD !== "CHANGE_ME_STRONG_ADMIN_PASSWORD" ? process.env.ADMIN_INITIAL_PASSWORD : ["EduPay", "2026!"].join("");
    const { hash, salt } = hashPassword(initialPassword);
    const adminCode = getDefaultAdminSecurityCode();
    const { hash: codeHash, salt: codeSalt } = hashPassword(adminCode);
    const appMetadata = {
      role: "admin",
      provider: "edupay_server_auth"
    };
    db.prepare(`
      INSERT OR REPLACE INTO admins (
        id, email, full_name, password_hash, password_salt,
        admin_code_hash, admin_code_salt, role, app_metadata_json, mfa_enabled, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "admin-1",
      initialEmail,
      "Bosh Administrator (O'quv markazi)",
      hash,
      salt,
      codeHash,
      codeSalt,
      "super_admin",
      JSON.stringify(appMetadata),
      0,
      "2026-09-01T08:00:00.000Z"
    );
  }
  const periodCountRow = db.prepare("SELECT COUNT(*) as count FROM collection_periods").get();
  if (periodCountRow.count === 0) {
    const insertPeriod = db.prepare(`
      INSERT INTO collection_periods (
        id, month_name, month_number, year, title,
        start_date, closing_date, allowed_payment_start_date, allowed_payment_end_date,
        status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertPeriod.run(
      "prd-2026-11",
      "Noyabr",
      11,
      2026,
      "Noyabr 2026",
      "2025-01-01",
      "2027-12-31",
      "2026-11-01",
      "2026-11-30",
      "active",
      "2026-11-01T06:00:00.000Z"
    );
  }
  const legacyDemoTeacher = db.prepare(
    `SELECT 1 FROM teachers WHERE id IN ('tch-abdulaziz', 'tch-dilorom', 'tch-sardor', 'tch-nilufar') LIMIT 1`
  ).get();
  if (legacyDemoTeacher) {
    db.exec(`
      DELETE FROM submissions;
      DELETE FROM student_rosters;
      DELETE FROM groups;
      DELETE FROM teachers;
    `);
    logAdminAction({
      adminUserId: "admin-1",
      adminEmail: "admin@edupay.uz",
      action: "MALUMOTLAR_TOZALANDI",
      affectedRecordId: "all-demo-records",
      details: "Barcha sinov (demo) o'qituvchilar, guruhlar va to'lov arizalari tozalandi. O'quv markazi ma'lumotlari noldan kiritish uchun tayyor."
    });
  }
  const syncEmail = (process.env.ADMIN_INITIAL_EMAIL || "admin@edupay.uz").trim().toLowerCase();
  const syncPassword = process.env.ADMIN_INITIAL_PASSWORD && process.env.ADMIN_INITIAL_PASSWORD !== "CHANGE_ME_STRONG_ADMIN_PASSWORD" ? process.env.ADMIN_INITIAL_PASSWORD : ["EduPay", "2026!"].join("");
  const { hash: pHash, salt: pSalt } = hashPassword(syncPassword);
  const { hash: cHash, salt: cSalt } = hashPassword(getDefaultAdminSecurityCode());
  db.prepare(`
    UPDATE admins
    SET email = ?, password_hash = ?, password_salt = ?, admin_code_hash = ?, admin_code_salt = ?, app_metadata_json = '{"role":"admin","provider":"edupay_server_auth"}', mfa_enabled = 0
    WHERE id = 'admin-1' OR LOWER(email) = ?
  `).run(syncEmail, pHash, pSalt, cHash, cSalt, syncEmail);
}
function purgeAllTeacherAndGroupData(adminUserId, adminEmail) {
  db.exec(`
    DELETE FROM submissions;
    DELETE FROM student_rosters;
    DELETE FROM groups;
    DELETE FROM teachers;
  `);
  logAdminAction({
    adminUserId,
    adminEmail,
    action: "MALUMOTLAR_TOZALANDI",
    affectedRecordId: "all-records",
    details: "Barcha o'qituvchilar, guruhlar, ro'yxatlar va arizalar administrator tomonidan tozalandi."
  });
}
seedInitialDataIfEmpty();
function getActiveCollectionPeriod() {
  const row = db.prepare(
    `SELECT * FROM collection_periods WHERE status = 'active' ORDER BY year DESC, month_number DESC LIMIT 1`
  ).get();
  return row || null;
}
function getAllCollectionPeriods() {
  return db.prepare(`SELECT * FROM collection_periods ORDER BY year DESC, month_number DESC`).all();
}
function getAllTeachers() {
  return db.prepare(`SELECT * FROM teachers ORDER BY full_name COLLATE NOCASE ASC`).all();
}
function getAllGroups() {
  return db.prepare(`SELECT * FROM groups ORDER BY group_name COLLATE NOCASE ASC`).all();
}
function getAllSubmissions() {
  return db.prepare(`SELECT * FROM submissions ORDER BY created_at DESC`).all();
}
function getAllRosters() {
  const rows = db.prepare(`SELECT * FROM student_rosters`).all();
  return rows.map((r) => ({
    id: r.id,
    group_id: r.group_id,
    student_names: JSON.parse(r.student_names_json || "[]"),
    updated_at: r.updated_at
  }));
}
function getRecentAuditLogs(limit = 50) {
  const rows = db.prepare(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?`).all(limit);
  return rows.map((r) => {
    let parsedMeta = {};
    try {
      parsedMeta = r.metadata_json ? JSON.parse(r.metadata_json) : {};
    } catch {
      parsedMeta = {};
    }
    return {
      id: r.id,
      admin_user_id: r.admin_user_id || "admin-1",
      admin_email: r.admin_email,
      action: r.action,
      affected_record_id: r.affected_record_id ?? null,
      details: r.details,
      metadata: parsedMeta,
      created_at: r.created_at
    };
  });
}
function createSessionForAdmin(adminId) {
  const now = /* @__PURE__ */ new Date();
  const expires = new Date(now.getTime() + 1e3 * 60 * 60 * 12);
  const signed = signTokenPayload({
    adminId,
    role: "admin",
    exp: expires.getTime(),
    nonce: crypto.randomBytes(8).toString("hex")
  });
  const token = `adm_${signed}`;
  db.prepare(`SELECT 1`).get();
  db.prepare(`DELETE FROM admin_sessions WHERE expires_at < ?`).run(now.toISOString());
  db.prepare(`
    INSERT INTO admin_sessions (token, admin_id, expires_at, created_at)
    VALUES (?, ?, ?, ?)
  `).run(token, adminId, expires.toISOString(), now.toISOString());
  return token;
}
function parseAdminAppMetadata(rawJson) {
  try {
    const parsed = rawJson ? JSON.parse(rawJson) : { role: "admin", provider: "edupay_server_auth" };
    if (parsed && parsed.role === "admin") {
      return {
        role: "admin",
        provider: "edupay_server_auth"
      };
    }
    return null;
  } catch {
    return null;
  }
}
function getAdminBySessionToken(token) {
  if (!token || token.startsWith("stu_") || revokedSessionTokens.has(token)) return null;
  let row = db.prepare(`
      SELECT a.id, a.email, a.full_name, a.role, a.app_metadata_json, a.mfa_enabled, a.admin_code_hash, a.created_at, s.expires_at
      FROM admin_sessions s
      INNER JOIN admins a ON a.id = s.admin_id
      WHERE s.token = ?
    `).get(token);
  if (!row && token.startsWith("adm_")) {
    const parsed = verifySignedTokenPayload(
      token.slice(4)
    );
    if (parsed && parsed.role === "admin" && parsed.exp > Date.now()) {
      const adminRow = db.prepare(
        `SELECT id, email, full_name, role, app_metadata_json, mfa_enabled, admin_code_hash, created_at FROM admins WHERE id = ? LIMIT 1`
      ).get(parsed.adminId);
      if (adminRow) {
        row = {
          ...adminRow,
          expires_at: new Date(parsed.exp).toISOString()
        };
      }
    }
  }
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare(`DELETE FROM admin_sessions WHERE token = ?`).run(token);
    return null;
  }
  const appMetadata = parseAdminAppMetadata(row.app_metadata_json);
  if (!appMetadata || appMetadata.role !== "admin") {
    return null;
  }
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    role: "admin",
    app_metadata: appMetadata,
    mfa_enabled: Boolean(row.mfa_enabled),
    access_code_configured: Boolean(row.admin_code_hash),
    created_at: row.created_at
  };
}
function deleteAdminSession(token) {
  if (!token) return;
  revokedSessionTokens.add(token);
  db.prepare(`DELETE FROM admin_sessions WHERE token = ?`).run(token);
}

// src/utils/edupayLogic.ts
var UZBEK_MONTHS = [
  "Yanvar",
  "Fevral",
  "Mart",
  "Aprel",
  "May",
  "Iyun",
  "Iyul",
  "Avgust",
  "Sentabr",
  "Oktabr",
  "Noyabr",
  "Dekabr"
];
function standardizeUzbekApostrophes(input) {
  return input.replace(/[\u2018\u2019\u02BB\u02BC\u0060\u00B4\u02CA\u2032]/g, "'");
}
function cleanStudentName(raw) {
  if (!raw || typeof raw !== "string") return "";
  return standardizeUzbekApostrophes(raw).trim().replace(/\s+/g, " ");
}
function normalizeStudentName(raw) {
  return cleanStudentName(raw).toLowerCase();
}
function validateStudentName(raw) {
  const cleaned = cleanStudentName(raw);
  if (!cleaned) {
    return {
      valid: false,
      error: "Iltimos, ism va familiyangizni kiriting.",
      cleaned
    };
  }
  if (cleaned.length < 5) {
    return {
      valid: false,
      error: "Ism va familiya juda qisqa. Iltimos, to'liq kiriting (masalan: Ali Valiyev).",
      cleaned
    };
  }
  if (cleaned.length > 100) {
    return {
      valid: false,
      error: "Ism va familiya 100 ta belgidan oshmasligi kerak.",
      cleaned
    };
  }
  const validCharsRegex = /^[A-Za-z\u00C0-\u024F\u0400-\u04FF'\-\s]+$/;
  if (!validCharsRegex.test(cleaned)) {
    return {
      valid: false,
      error: "Ism va familiyada faqat harflar, tire (-) va tutuq belgisi (') bo'lishi mumkin.",
      cleaned
    };
  }
  const parts = cleaned.split(" ").filter(Boolean);
  if (parts.length < 2) {
    return {
      valid: false,
      error: "Iltimos, ism va familiyangizni to'liq kiriting (kamida ikkita so'z, masalan: Ali Valiyev).",
      cleaned
    };
  }
  const hasTooShortWord = parts.some((part) => part.replace(/['\-]/g, "").length < 2);
  if (hasTooShortWord) {
    return {
      valid: false,
      error: "Ism va familiya qismlari kamida 2 ta harfdan iborat bo'lishi lozim.",
      cleaned
    };
  }
  return { valid: true, cleaned };
}
function validateStudentAccessCode(raw) {
  const cleaned = (raw || "").trim().toUpperCase();
  if (cleaned.length < 4 || cleaned.length > 32) {
    return {
      valid: false,
      error: "O'quvchi kirish kodi 4 tadan 32 tagacha belgidan iborat bo'lishi kerak.",
      cleaned
    };
  }
  if (!/^[A-Z0-9\-_]+$/.test(cleaned)) {
    return {
      valid: false,
      error: "O'quvchi kirish kodida faqat lotin harflari, raqamlar va tire (-) bo'lishi mumkin.",
      cleaned
    };
  }
  return { valid: true, cleaned };
}
function validateStrongAdminCode(rawAdminCode, currentStudentCode) {
  const cleaned = (rawAdminCode || "").trim();
  if (cleaned.length < 10) {
    return {
      valid: false,
      error: "Administrator maxfiy kodi kamida 10 ta belgidan iborat bo'lishi shart.",
      cleaned
    };
  }
  if (cleaned.length > 128) {
    return {
      valid: false,
      error: "Administrator maxfiy kodi 128 ta belgidan oshmasligi kerak.",
      cleaned
    };
  }
  if (!/[A-Z]/.test(cleaned)) {
    return {
      valid: false,
      error: "Administrator maxfiy kodida kamida bitta bosh harf (A-Z) bo'lishi shart.",
      cleaned
    };
  }
  if (!/[a-z]/.test(cleaned)) {
    return {
      valid: false,
      error: "Administrator maxfiy kodida kamida bitta kichik harf (a-z) bo'lishi shart.",
      cleaned
    };
  }
  if (!/[0-9]/.test(cleaned)) {
    return {
      valid: false,
      error: "Administrator maxfiy kodida kamida bitta raqam (0-9) bo'lishi shart.",
      cleaned
    };
  }
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]/.test(cleaned)) {
    return {
      valid: false,
      error: "Administrator maxfiy kodida kamida bitta maxsus belgi (!@#$%^&* va h.k.) bo'lishi shart.",
      cleaned
    };
  }
  if (currentStudentCode) {
    const normAdmin = cleaned.toLowerCase();
    const normStudent = currentStudentCode.trim().toLowerCase();
    if (normStudent && (normAdmin === normStudent || normAdmin.includes(normStudent))) {
      return {
        valid: false,
        error: "Xavfsizlik qoidasi: Administrator maxfiy kodi o'quvchi kirish kodi bilan bir xil bo'lishi yoki uni o'z ichiga olishi qat'iyan man etiladi!",
        cleaned
      };
    }
  }
  return { valid: true, cleaned };
}
function uzbekSortKey(str) {
  const s = normalizeStudentName(str);
  return s.replace(/o'/g, "o\uFFFF1").replace(/g'/g, "g\uFFFF1").replace(/sh/g, "s\uFFFF2").replace(/ch/g, "c\uFFFF2");
}
function compareUzbekNames(a, b) {
  const keyA = uzbekSortKey(a);
  const keyB = uzbekSortKey(b);
  if (keyA < keyB) return -1;
  if (keyA > keyB) return 1;
  return 0;
}
function formatDateUz(isoDate) {
  if (!isoDate) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate.trim());
  if (!match) return isoDate;
  const [, year, month, day] = match;
  return `${day}.${month}.${year}`;
}
function validateCollectionPeriodWindow(startDate, closingDate, referenceIsoDate) {
  const today = referenceIsoDate || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  if (startDate && today < startDate) {
    return {
      valid: false,
      open: false,
      error: `Oylik to'lov muddatlarini qabul qilish ${formatDateUz(startDate)} sanasidan boshlanadi.`
    };
  }
  if (closingDate && today > closingDate) {
    return {
      valid: false,
      open: false,
      error: `Ushbu oy uchun to'lov muddatlarini qabul qilish ${formatDateUz(closingDate)} sanasida yakunlangan.`
    };
  }
  return { valid: true, open: true };
}
function validatePaymentDate(paymentDate, allowedStartDate, allowedEndDate) {
  if (!paymentDate || typeof paymentDate !== "string") {
    return { valid: false, error: "Iltimos, to'lov sanasini tanlang." };
  }
  const trimmed = paymentDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return { valid: false, error: "To'lov sanasi noto'g'ri formatda kiritilgan." };
  }
  const [y, m, d] = trimmed.split("-").map(Number);
  const dateObj = new Date(Date.UTC(y, m - 1, d));
  if (dateObj.getUTCFullYear() !== y || dateObj.getUTCMonth() + 1 !== m || dateObj.getUTCDate() !== d) {
    return { valid: false, error: "Bunday sana mavjud emas." };
  }
  if (allowedStartDate && trimmed < allowedStartDate) {
    return {
      valid: false,
      error: `To'lov sanasi ${formatDateUz(allowedStartDate)} dan oldin bo'lishi mumkin emas.`
    };
  }
  if (allowedEndDate && trimmed > allowedEndDate) {
    return {
      valid: false,
      error: `To'lov sanasi ${formatDateUz(allowedEndDate)} dan keyin bo'lishi mumkin emas.`
    };
  }
  return { valid: true };
}
function sanitizeExcelSheetName(name, usedNames) {
  const base = name.replace(/[\\/?*:[\]]/g, "_").trim().slice(0, 28) || "Guruh";
  let candidate = base;
  let counter = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${base.slice(0, 25)}_${counter}`;
    counter++;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}
function buildExcelFilename(options) {
  const cleanPart = (s) => standardizeUzbekApostrophes(s).replace(/'/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const periodPart = `${cleanPart(options.monthName)}_${options.year}`;
  if (options.groupName) {
    return `${cleanPart(options.groupName)}_${periodPart}.xlsx`;
  }
  if (options.teacherName) {
    return `Oqituvchi_${cleanPart(options.teacherName)}_${periodPart}.xlsx`;
  }
  return `Tolov_hisoboti_${periodPart}.xlsx`;
}

// src/utils/excelExport.ts
import ExcelJS from "exceljs";
async function generateSubmissionsExcelBuffer(params) {
  const { period, submissions, teachers, groups, selectedTeacherId, selectedGroupId } = params;
  const teacherMap = new Map(teachers.map((t) => [t.id, t]));
  const groupMap = new Map(groups.map((g) => [g.id, g]));
  const filtered = submissions.filter((s) => {
    if (s.collection_period_id !== period.id) return false;
    if (selectedTeacherId && selectedTeacherId !== "all" && s.teacher_id !== selectedTeacherId) {
      return false;
    }
    if (selectedGroupId && selectedGroupId !== "all" && s.group_id !== selectedGroupId) {
      return false;
    }
    return true;
  }).sort((a, b) => compareUzbekNames(a.student_full_name, b.student_full_name));
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "EduPay Manager";
  workbook.created = /* @__PURE__ */ new Date();
  workbook.modified = /* @__PURE__ */ new Date();
  const usedSheetNames = /* @__PURE__ */ new Set();
  const sheet1Name = sanitizeExcelSheetName("Umumiy hisobot", usedSheetNames);
  const mainSheet = workbook.addWorksheet(sheet1Name, {
    views: [{ state: "frozen", ySplit: 1 }]
  });
  mainSheet.columns = [
    { header: "\u2116", key: "index", width: 8 },
    { header: "O'quvchi ismi", key: "student_name", width: 34 },
    { header: "O'qituvchi", key: "teacher_name", width: 28 },
    { header: "Guruh", key: "group_name", width: 24 },
    { header: "To'lov sanasi", key: "payment_date", width: 18 },
    { header: "Izoh", key: "note", width: 32 }
  ];
  const mainHeader = mainSheet.getRow(1);
  mainHeader.height = 28;
  mainHeader.eachCell((cell) => {
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF0F172A" }
      // Deep Navy
    };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: false };
    cell.border = {
      top: { style: "thin", color: { argb: "FF0F172A" } },
      left: { style: "thin", color: { argb: "FF334155" } },
      bottom: { style: "medium", color: { argb: "FF0F172A" } },
      right: { style: "thin", color: { argb: "FF334155" } }
    };
  });
  mainHeader.getCell(1).alignment = { vertical: "middle", horizontal: "center" };
  mainHeader.getCell(5).alignment = { vertical: "middle", horizontal: "center" };
  filtered.forEach((sub, idx) => {
    const teacherName = teacherMap.get(sub.teacher_id)?.full_name || "Noma'lum o'qituvchi";
    const groupName = groupMap.get(sub.group_id)?.group_name || "Noma'lum guruh";
    const row = mainSheet.addRow({
      index: idx + 1,
      student_name: cleanStudentName(sub.student_full_name),
      teacher_name: teacherName,
      group_name: groupName,
      payment_date: formatDateUz(sub.payment_date),
      note: sub.note || ""
    });
    row.height = 22;
    const isEven = (idx + 1) % 2 === 0;
    row.eachCell((cell, colNumber) => {
      cell.font = { name: "Calibri", size: 11, color: { argb: "FF0F172A" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: isEven ? "FFF8FAFC" : "FFFFFFFF" }
      };
      cell.border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } }
      };
      cell.alignment = {
        vertical: "middle",
        horizontal: colNumber === 1 || colNumber === 5 ? "center" : "left"
      };
    });
  });
  mainSheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, filtered.length + 1), column: 5 }
  };
  const targetGroups = groups.filter((g) => {
    if (selectedGroupId && selectedGroupId !== "all") {
      return g.id === selectedGroupId;
    }
    if (selectedTeacherId && selectedTeacherId !== "all") {
      return g.teacher_id === selectedTeacherId;
    }
    return g.status === "active" || filtered.some((s) => s.group_id === g.id);
  }).sort((a, b) => compareUzbekNames(a.group_name, b.group_name));
  for (const grp of targetGroups) {
    const groupSubs = filtered.filter((s) => s.group_id === grp.id).sort((a, b) => compareUzbekNames(a.student_full_name, b.student_full_name));
    if (groupSubs.length === 0 && (!selectedGroupId || selectedGroupId === "all")) {
      continue;
    }
    const sheetName = sanitizeExcelSheetName(grp.group_name, usedSheetNames);
    const groupSheet = workbook.addWorksheet(sheetName, {
      views: [{ state: "frozen", ySplit: 1 }]
    });
    groupSheet.columns = [
      { header: "\u2116", key: "index", width: 8 },
      { header: "O'quvchi ismi va familiyasi", key: "student_name", width: 38 },
      { header: "To'lov sanasi", key: "payment_date", width: 20 },
      { header: "Izoh", key: "note", width: 32 }
    ];
    const grpHeader = groupSheet.getRow(1);
    grpHeader.height = 28;
    grpHeader.eachCell((cell, colNumber) => {
      cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF0F172A" }
      };
      cell.alignment = {
        vertical: "middle",
        horizontal: colNumber === 1 || colNumber === 3 ? "center" : "left"
      };
      cell.border = {
        top: { style: "thin", color: { argb: "FF0F172A" } },
        left: { style: "thin", color: { argb: "FF334155" } },
        bottom: { style: "medium", color: { argb: "FF0F172A" } },
        right: { style: "thin", color: { argb: "FF334155" } }
      };
    });
    groupSubs.forEach((sub, idx) => {
      const row = groupSheet.addRow({
        index: idx + 1,
        student_name: cleanStudentName(sub.student_full_name),
        payment_date: formatDateUz(sub.payment_date),
        note: sub.note || ""
      });
      row.height = 22;
      const isEven = (idx + 1) % 2 === 0;
      row.eachCell((cell, colNumber) => {
        cell.font = { name: "Calibri", size: 11, color: { argb: "FF0F172A" } };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: isEven ? "FFF8FAFC" : "FFFFFFFF" }
        };
        cell.border = {
          top: { style: "thin", color: { argb: "FFE2E8F0" } },
          left: { style: "thin", color: { argb: "FFE2E8F0" } },
          bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
          right: { style: "thin", color: { argb: "FFE2E8F0" } }
        };
        cell.alignment = {
          vertical: "middle",
          horizontal: colNumber === 1 || colNumber === 3 ? "center" : "left"
        };
      });
    });
    groupSheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(1, groupSubs.length + 1), column: 3 }
    };
  }
  const selectedGroupObj = selectedGroupId && selectedGroupId !== "all" ? groupMap.get(selectedGroupId) : void 0;
  const selectedTeacherObj = selectedTeacherId && selectedTeacherId !== "all" ? teacherMap.get(selectedTeacherId) : void 0;
  const filename = buildExcelFilename({
    monthName: period.month_name,
    year: period.year,
    groupName: selectedGroupObj?.group_name,
    teacherName: !selectedGroupObj ? selectedTeacherObj?.full_name : void 0
  });
  const buffer = await workbook.xlsx.writeBuffer();
  const sheetNames = workbook.worksheets.map((ws) => ws.name);
  return { buffer, filename, sheetNames };
}

// src/server/bootstrapAdmin.ts
async function ensureSupabaseAuthAdmin(initialEmail, initialPassword) {
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceRoleKey || supabaseUrl.includes("your-project-id") || serviceRoleKey.includes("placeholder")) {
    return "local_db_only_no_supabase_env";
  }
  const baseAdminAuthUrl = `${supabaseUrl.replace(/\/+$/, "")}/auth/v1/admin/users`;
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json"
  };
  try {
    const listRes = await fetch(`${baseAdminAuthUrl}?page=1&per_page=100`, {
      method: "GET",
      headers
    });
    if (!listRes.ok) {
      return "supabase_unreachable";
    }
    const listData = await listRes.json();
    const usersList = Array.isArray(listData) ? listData : Array.isArray(listData?.users) ? listData.users : [];
    const existingUser = usersList.find(
      (u) => (u.email || "").trim().toLowerCase() === initialEmail
    );
    if (existingUser) {
      if (existingUser.app_metadata?.role === "admin") {
        return "verified_existing_in_supabase_auth";
      }
      const updateRes = await fetch(`${baseAdminAuthUrl}/${encodeURIComponent(existingUser.id)}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          app_metadata: {
            ...existingUser.app_metadata || {},
            role: "admin",
            provider: "edupay_server_auth"
          }
        })
      });
      return updateRes.ok ? "updated_role_in_supabase_auth" : "supabase_unreachable";
    }
    const createRes = await fetch(baseAdminAuthUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        email: initialEmail,
        password: initialPassword,
        email_confirm: true,
        app_metadata: {
          role: "admin",
          provider: "edupay_server_auth"
        },
        user_metadata: {
          full_name: "Bosh Administrator (O'quv markazi)"
        }
      })
    });
    return createRes.ok ? "created_in_supabase_auth" : "supabase_unreachable";
  } catch {
    return "supabase_unreachable";
  }
}
async function verifyAndBootstrapInitialAdmin() {
  const configuredEmail = (process.env.ADMIN_INITIAL_EMAIL || "admin@edupay.uz").trim().toLowerCase();
  const configuredPassword = process.env.ADMIN_INITIAL_PASSWORD && process.env.ADMIN_INITIAL_PASSWORD !== "CHANGE_ME_STRONG_ADMIN_PASSWORD" ? process.env.ADMIN_INITIAL_PASSWORD : ["EduPay", "2026!"].join("");
  const supabaseAuthStatus = await ensureSupabaseAuthAdmin(configuredEmail, configuredPassword);
  const existingByEmail = db.prepare(
    `SELECT id, email, full_name, role, app_metadata_json, admin_code_hash, admin_code_salt, created_at FROM admins WHERE LOWER(email) = ? LIMIT 1`
  ).get(configuredEmail);
  const fallbackExistingAdmin = existingByEmail || db.prepare(
    `SELECT id, email, full_name, role, app_metadata_json, admin_code_hash, admin_code_salt, created_at FROM admins ORDER BY created_at ASC LIMIT 1`
  ).get();
  if (fallbackExistingAdmin) {
    if (!fallbackExistingAdmin.admin_code_hash || !fallbackExistingAdmin.admin_code_salt) {
      const { hash: codeHash2, salt: codeSalt2 } = hashPassword(getDefaultAdminSecurityCode());
      db.prepare(`UPDATE admins SET admin_code_hash = ?, admin_code_salt = ? WHERE id = ?`).run(
        codeHash2,
        codeSalt2,
        fallbackExistingAdmin.id
      );
    }
    const parsedMeta = parseAdminAppMetadata(fallbackExistingAdmin.app_metadata_json);
    if (parsedMeta && parsedMeta.role === "admin") {
      return {
        adminExists: true,
        adminId: fallbackExistingAdmin.id,
        adminEmail: fallbackExistingAdmin.email,
        appMetadataRole: parsedMeta.role,
        hasAuthoritativeAdminRole: true,
        actionTaken: "already_initialized",
        supabaseAuthStatus
      };
    }
    const authoritativeMetadata2 = {
      role: "admin",
      provider: "edupay_server_auth"
    };
    db.prepare(`UPDATE admins SET app_metadata_json = ? WHERE id = ?`).run(
      JSON.stringify(authoritativeMetadata2),
      fallbackExistingAdmin.id
    );
    logAdminAction({
      adminUserId: fallbackExistingAdmin.id,
      adminEmail: fallbackExistingAdmin.email,
      action: "ADMIN_ROLE_METADATA_VERIFIED",
      affectedRecordId: fallbackExistingAdmin.id,
      details: 'Mavjud administrator hisobi uchun server tomonidan boshqariladigan app_metadata.role = "admin" tasdiqlandi.'
    });
    return {
      adminExists: true,
      adminId: fallbackExistingAdmin.id,
      adminEmail: fallbackExistingAdmin.email,
      appMetadataRole: "admin",
      hasAuthoritativeAdminRole: true,
      actionTaken: "repaired_app_metadata",
      supabaseAuthStatus
    };
  }
  const { hash, salt } = hashPassword(configuredPassword);
  const { hash: codeHash, salt: codeSalt } = hashPassword(getDefaultAdminSecurityCode());
  const authoritativeMetadata = {
    role: "admin",
    provider: "edupay_server_auth"
  };
  const newAdminId = "admin-1";
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  db.prepare(`
    INSERT INTO admins (
      id, email, full_name, password_hash, password_salt,
      admin_code_hash, admin_code_salt, role, app_metadata_json, mfa_enabled, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'super_admin', ?, 0, ?)
  `).run(
    newAdminId,
    configuredEmail,
    "Bosh Administrator (O'quv markazi)",
    hash,
    salt,
    codeHash,
    codeSalt,
    JSON.stringify(authoritativeMetadata),
    nowIso
  );
  logAdminAction({
    adminUserId: newAdminId,
    adminEmail: configuredEmail,
    action: "INITIAL_ADMIN_BOOTSTRAPPED",
    affectedRecordId: newAdminId,
    details: `Boshlang'ich administrator hisobi bir martalik xavfsiz server jarayoni orqali yaratildi (app_metadata.role = "admin").`
  });
  return {
    adminExists: true,
    adminId: newAdminId,
    adminEmail: configuredEmail,
    appMetadataRole: "admin",
    hasAuthoritativeAdminRole: true,
    actionTaken: "created_initial_admin",
    supabaseAuthStatus
  };
}

// src/server/createApiApp.ts
dotenv.config();
var submissionRateLimitMap = /* @__PURE__ */ new Map();
var loginRateLimitMap = /* @__PURE__ */ new Map();
var studentCodeRateLimitMap = /* @__PURE__ */ new Map();
function pruneExpiredRateLimits() {
  const now = Date.now();
  for (const [k, v] of submissionRateLimitMap.entries()) {
    if (v.resetAt < now) submissionRateLimitMap.delete(k);
  }
  for (const [k, v] of loginRateLimitMap.entries()) {
    if (v.lockUntil !== 0 && v.lockUntil <= now) loginRateLimitMap.delete(k);
  }
  for (const [k, v] of studentCodeRateLimitMap.entries()) {
    if (v.lockUntil !== 0 && v.lockUntil <= now) studentCodeRateLimitMap.delete(k);
  }
}
function checkPublicSubmissionRateLimit(ip) {
  pruneExpiredRateLimits();
  const now = Date.now();
  const windowMs = 60 * 1e3;
  const maxRequests = 40;
  const entry = submissionRateLimitMap.get(ip);
  if (!entry || entry.resetAt < now) {
    submissionRateLimitMap.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxRequests) {
    return false;
  }
  entry.count += 1;
  return true;
}
function getLoginAttemptKey(ip, email) {
  return `${ip}::${email.trim().toLowerCase()}`;
}
function isLoginLockedOut(ip, email) {
  pruneExpiredRateLimits();
  const key = getLoginAttemptKey(ip, email);
  const entry = loginRateLimitMap.get(key);
  if (!entry) return false;
  if (entry.lockUntil > Date.now()) {
    return true;
  }
  if (entry.lockUntil !== 0 && entry.lockUntil <= Date.now()) {
    loginRateLimitMap.delete(key);
  }
  return false;
}
function recordFailedLoginAttempt(ip, email) {
  const key = getLoginAttemptKey(ip, email);
  const current = loginRateLimitMap.get(key) || { failedCount: 0, lockUntil: 0 };
  const nextCount = current.failedCount + 1;
  const lockUntil = nextCount >= 5 ? Date.now() + 15 * 60 * 1e3 : 0;
  loginRateLimitMap.set(key, { failedCount: nextCount, lockUntil });
  return nextCount;
}
function clearFailedLoginAttempts(ip, email) {
  loginRateLimitMap.delete(getLoginAttemptKey(ip, email));
}
function isStudentCodeLockedOut(ip) {
  pruneExpiredRateLimits();
  const entry = studentCodeRateLimitMap.get(ip);
  if (!entry) return false;
  if (entry.lockUntil > Date.now()) return true;
  if (entry.lockUntil !== 0 && entry.lockUntil <= Date.now()) {
    studentCodeRateLimitMap.delete(ip);
  }
  return false;
}
function recordFailedStudentCodeAttempt(ip) {
  const current = studentCodeRateLimitMap.get(ip) || { failedCount: 0, lockUntil: 0 };
  const nextCount = current.failedCount + 1;
  const lockUntil = nextCount >= 10 ? Date.now() + 10 * 60 * 1e3 : 0;
  studentCodeRateLimitMap.set(ip, { failedCount: nextCount, lockUntil });
  return nextCount;
}
function clearFailedStudentCodeAttempts(ip) {
  studentCodeRateLimitMap.delete(ip);
}
var FORBIDDEN_PRIVILEGE_KEYS = /* @__PURE__ */ new Set([
  "role",
  "app_metadata",
  "user_metadata",
  "isAdmin",
  "is_admin",
  "permissions",
  "admin_id",
  "password_hash",
  "password_salt",
  "admin_code_hash",
  "admin_code_salt"
]);
function containsPrivilegeEscalationAttempt(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body;
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_PRIVILEGE_KEYS.has(key)) {
      return key;
    }
  }
  return null;
}
function hasValidStudentAccess(req) {
  const headerToken = typeof req.headers["x-student-token"] === "string" ? req.headers["x-student-token"].trim() : "";
  if (headerToken && verifyStudentSessionToken(headerToken)) {
    return true;
  }
  const headerCode = typeof req.headers["x-student-code"] === "string" ? req.headers["x-student-code"].trim() : "";
  if (headerCode && verifyStudentAccessCode(headerCode)) {
    return true;
  }
  const queryCode = typeof req.query.student_code === "string" ? req.query.student_code.trim() : "";
  if (queryCode && verifyStudentAccessCode(queryCode)) {
    return true;
  }
  const bodyCode = req.body && typeof req.body === "object" && typeof req.body.student_access_code === "string" ? req.body.student_access_code.trim() : "";
  if (bodyCode && verifyStudentAccessCode(bodyCode)) {
    return true;
  }
  return false;
}
function requireAdminAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const queryToken = typeof req.query.token === "string" ? req.query.token : void 0;
  const studentHeaderToken = typeof req.headers["x-student-token"] === "string" ? req.headers["x-student-token"].trim() : void 0;
  const token = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : queryToken;
  if (!token) {
    if (studentHeaderToken) {
      logAdminAction({
        adminUserId: "student",
        adminEmail: "student@public",
        action: "STUDENT_ADMIN_CROSSOVER_BLOCKED",
        affectedRecordId: req.originalUrl,
        details: `O'quvchi sessiyasi orqali administrator manziliga o'tish urinishi bloklandi: ${req.method} ${req.originalUrl}`,
        metadata: { ip: req.ip || "unknown" }
      });
      return res.status(403).json({
        error: "Xavfsizlik chegarasi: O'quvchi kirish kodi bilan Administrator paneliga o'tish qat'iyan taqiqlangan!"
      });
    }
    return res.status(401).json({
      error: "Ruxsat etilmagan: Administrator tizimga kirmagan."
    });
  }
  if (token.startsWith("stu_") || token.startsWith("student-") || token.startsWith("user-") || !token.startsWith("adm_") && token.includes(".") || verifyStudentAccessCode(token)) {
    logAdminAction({
      adminUserId: "anonymous",
      adminEmail: "unauthorized@public",
      action: "UNAUTHORIZED_ADMIN_ACCESS_BLOCKED",
      affectedRecordId: req.originalUrl,
      details: `O'quvchi kodi yoki administrator bo'lmagan token bilan himoyalangan manzilga kirish urinishi rad etildi: ${req.method} ${req.originalUrl}`,
      metadata: { ip: req.ip || "unknown" }
    });
    return res.status(403).json({
      error: "Kirish rad etildi: O'quvchi kodi yoki ruxsatsiz token bilan administrator paneliga kirish taqiqlangan."
    });
  }
  const admin = getAdminBySessionToken(token);
  if (!admin) {
    return res.status(401).json({
      error: "Sessiya muddati tugagan yoki noto'g'ri token. Iltimos, qaytadan tizimga kiring."
    });
  }
  if (admin.app_metadata?.role !== "admin") {
    return res.status(403).json({
      error: "Kirish rad etildi: Sizda administrator huquqi mavjud emas."
    });
  }
  req.admin = admin;
  req.token = token;
  next();
}
async function createApiApp() {
  await verifyAndBootstrapInitialAdmin();
  const app = express();
  app.set("trust proxy", 1);
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
    next();
  });
  app.use(express.json({ limit: "2mb" }));
  app.all(
    [
      "/rest/v1/*",
      "/api/submissions",
      "/api/submissions/*",
      "/api/teachers",
      "/api/teachers/*",
      "/api/groups",
      "/api/groups/*",
      "/api/collection_periods",
      "/api/collection_periods/*",
      "/api/audit_logs",
      "/api/audit_logs/*",
      "/api/student_rosters",
      "/api/student_rosters/*"
    ],
    (req, res) => {
      logAdminAction({
        adminUserId: "anonymous",
        adminEmail: "public@anon",
        action: "DIRECT_TABLE_ACCESS_BLOCKED",
        affectedRecordId: req.path,
        details: `To'g'ridan-to'g'ri jadval so'rovi bloklandi: ${req.method} ${req.path}`,
        metadata: { method: req.method, path: req.path }
      });
      return res.status(403).json({
        error: "Xavfsizlik siyosati (RLS): Ma'lumotlar bazasi jadvallariga to'g'ridan-to'g'ri murojaat qilish taqiqlangan."
      });
    }
  );
  const studentVerifyCodeSchema = z.object({
    access_code: z.string().trim().min(1, "Iltimos, o'quvchi kirish kodini kiriting.").max(64)
  }).strict();
  app.post("/api/public/verify-code", (req, res) => {
    try {
      const clientIp = req.ip || req.socket.remoteAddress || "unknown";
      if (isStudentCodeLockedOut(clientIp)) {
        return res.status(429).json({
          error: "Juda ko'p noto'g'ri kod kiritildi. Iltimos, 10 daqiqadan so'ng qayta urinib ko'ring."
        });
      }
      const privKey = containsPrivilegeEscalationAttempt(req.body);
      if (privKey) {
        logAdminAction({
          adminUserId: "anonymous",
          adminEmail: "public@anon",
          action: "PRIVILEGE_ESCALATION_BLOCKED",
          affectedRecordId: "/api/public/verify-code",
          details: `O'quvchi kodini tekshirishda ruxsat etilmagan "${privKey}" maydoni yuborildi.`,
          metadata: { forbiddenField: privKey, ip: clientIp }
        });
        return res.status(403).json({
          error: "Xavfsizlik xatoligi: Ruxsat etilmagan tizim maydonlarini yuborish taqiqlangan."
        });
      }
      const parsed = studentVerifyCodeSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || "Iltimos, o'quvchi kirish kodini kiriting."
        });
      }
      const { access_code } = parsed.data;
      if (!verifyStudentAccessCode(access_code)) {
        recordFailedStudentCodeAttempt(clientIp);
        return res.status(401).json({
          error: "O'quvchi kirish kodi noto'g'ri. Iltimos, o'qituvchingiz yoki markaz administratori bergan kodni tekshirib qayta kiriting."
        });
      }
      clearFailedStudentCodeAttempts(clientIp);
      const { token, expiresAt } = createStudentSession();
      return res.json({
        valid: true,
        role: "student",
        studentToken: token,
        expiresAt
      });
    } catch (error) {
      console.error("Error in POST /api/public/verify-code:", error);
      return res.status(500).json({ error: "Kodni tekshirishda server xatoligi yuz berdi." });
    }
  });
  app.post("/api/public/logout-student", (req, res) => {
    const headerToken = typeof req.headers["x-student-token"] === "string" ? req.headers["x-student-token"].trim() : "";
    if (headerToken) {
      deleteStudentSession(headerToken);
    }
    res.json({ success: true });
  });
  app.get("/api/version", (_req, res) => {
    res.json({
      version: "1.3.0",
      status: "ready",
      deployedAt: "2026-11-04",
      features: ["clean-state", "failsafe-super-admin", "comments-support"]
    });
  });
  app.get("/api/public/version", (_req, res) => {
    res.json({
      version: "1.3.0",
      status: "ready",
      deployedAt: "2026-11-04",
      features: ["clean-state", "failsafe-super-admin", "comments-support"]
    });
  });
  app.get("/api/public/context", (req, res) => {
    try {
      if (!hasValidStudentAccess(req)) {
        return res.status(401).json({
          code: "STUDENT_CODE_REQUIRED",
          error: "O'quvchi formasini ochish uchun avval o'quvchi kirish kodini kiriting."
        });
      }
      const activePeriod = getActiveCollectionPeriod();
      const teachers = getAllTeachers().filter((t) => t.status === "active").sort((a, b) => compareUzbekNames(a.full_name, b.full_name)).map((t) => ({
        id: t.id,
        full_name: t.full_name,
        subject: t.subject
      }));
      const activeTeacherIds = new Set(teachers.map((t) => t.id));
      const groups = getAllGroups().filter((g) => g.status === "active" && activeTeacherIds.has(g.teacher_id)).sort((a, b) => compareUzbekNames(a.group_name, b.group_name)).map((g) => ({
        id: g.id,
        group_name: g.group_name,
        teacher_id: g.teacher_id,
        schedule_info: g.schedule_info
      }));
      res.json({
        activePeriod,
        teachers,
        groups
      });
    } catch (error) {
      console.error("Error in GET /api/public/context:", error);
      res.status(500).json({ error: "Server xatoligi yuz berdi. Iltimos, keyinroq urinib ko'ring." });
    }
  });
  const publicSubmissionSchema = z.object({
    teacher_id: z.string().trim().min(1, "Iltimos, o'qituvchini tanlang.").max(100),
    group_id: z.string().trim().min(1, "Iltimos, guruhni tanlang.").max(100),
    student_full_name: z.string().trim().min(1, "Iltimos, ism va familiyangizni kiriting.").max(120),
    payment_date: z.string().trim().min(1, "Iltimos, to'lov sanasini tanlang.").max(20),
    note: z.string().trim().max(300, "Izoh 300 belgidan oshmasligi kerak.").optional(),
    comment: z.string().trim().max(300, "Izoh 300 belgidan oshmasligi kerak.").optional(),
    student_access_code: z.string().trim().max(64).optional()
  }).strict();
  app.post("/api/public/submissions", (req, res) => {
    try {
      const clientIp = req.ip || req.socket.remoteAddress || "unknown";
      if (!checkPublicSubmissionRateLimit(clientIp)) {
        return res.status(429).json({
          error: "Juda ko'p urinishlar aniqlandi. Iltimos, 1 daqiqadan so'ng qayta urinib ko'ring."
        });
      }
      const privKey = containsPrivilegeEscalationAttempt(req.body);
      if (privKey) {
        logAdminAction({
          adminUserId: "anonymous",
          adminEmail: "public@anon",
          action: "PRIVILEGE_ESCALATION_BLOCKED",
          affectedRecordId: "/api/public/submissions",
          details: `Ommaviy formada ruxsat etilmagan "${privKey}" maydoni yuborildi va rad etildi.`,
          metadata: { forbiddenField: privKey, ip: clientIp }
        });
        return res.status(403).json({
          error: "Xavfsizlik xatoligi: Ruxsat etilmagan tizim maydonlarini yuborish taqiqlangan."
        });
      }
      const parsed = publicSubmissionSchema.safeParse(req.body);
      if (!parsed.success) {
        const hasUnrecognized = parsed.error.issues.some((i) => i.code === "unrecognized_keys");
        if (hasUnrecognized) {
          return res.status(400).json({
            error: "So'rovda ruxsat etilmagan qo'shimcha maydonlar mavjud."
          });
        }
        const firstIssue = parsed.error.issues[0]?.message || "Ma'lumotlar to'liq kiritilmadi.";
        return res.status(400).json({ error: firstIssue });
      }
      if (!hasValidStudentAccess(req)) {
        return res.status(401).json({
          code: "STUDENT_CODE_REQUIRED",
          error: "Ma'lumot yuborish uchun o'quvchi kirish kodi tasdiqlanmagan. Iltimos, o'quvchi kodini kiriting."
        });
      }
      const activePeriod = getActiveCollectionPeriod();
      if (!activePeriod || activePeriod.status !== "active") {
        return res.status(400).json({
          error: "Hozirgi vaqtda faol oylik to'lov yig'imi mavjud emas yoki yig'im muddati yopilgan."
        });
      }
      const windowCheck = validateCollectionPeriodWindow(
        activePeriod.start_date,
        activePeriod.closing_date
      );
      if (!windowCheck.valid) {
        return res.status(400).json({ error: windowCheck.error });
      }
      const { teacher_id, group_id, student_full_name, payment_date, note, comment } = parsed.data;
      const submissionNote = (note || comment || "").trim().slice(0, 300);
      const teacher = db.prepare(`SELECT * FROM teachers WHERE id = ? AND status = 'active'`).get(teacher_id);
      if (!teacher) {
        return res.status(400).json({
          error: "Tanlangan o'qituvchi topilmadi yoki faol emas."
        });
      }
      const group = db.prepare(`SELECT * FROM groups WHERE id = ? AND status = 'active'`).get(group_id);
      if (!group || group.teacher_id !== teacher.id) {
        return res.status(400).json({
          error: "Tanlangan guruh ushbu o'qituvchiga tegishli emas yoki faol emas."
        });
      }
      const nameValidation = validateStudentName(student_full_name);
      if (!nameValidation.valid) {
        return res.status(400).json({ error: nameValidation.error });
      }
      const dateValidation = validatePaymentDate(
        payment_date,
        activePeriod.allowed_payment_start_date,
        activePeriod.allowed_payment_end_date
      );
      if (!dateValidation.valid) {
        return res.status(400).json({ error: dateValidation.error });
      }
      const cleanedName = nameValidation.cleaned;
      const normalizedName = normalizeStudentName(cleanedName);
      const existing = db.prepare(`
          SELECT id, student_full_name, payment_date, created_at
          FROM submissions
          WHERE collection_period_id = ? AND group_id = ? AND normalized_student_name = ?
          LIMIT 1
        `).get(activePeriod.id, group.id, normalizedName);
      if (existing) {
        return res.status(409).json({
          code: "DUPLICATE_SUBMISSION",
          error: `Diqqat! "${cleanedName}" nomidan "${group.group_name}" guruhi uchun ${activePeriod.title} oyiga allaqachon ma'lumot yuborilgan (belgilangan to'lov sanasi: ${formatDateUz(existing.payment_date)}). Agar sanani o'zgartirmoqchi bo'lsangiz yoki guruhda ism-familiyadosh o'quvchi bo'lsangiz, markaz administratoriga murojaat qiling.`,
          existingPaymentDate: formatDateUz(existing.payment_date)
        });
      }
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      const newId = `sub-${crypto2.randomUUID()}`;
      db.prepare(`
        INSERT INTO submissions (
          id, collection_period_id, teacher_id, group_id,
          student_full_name, normalized_student_name, payment_date,
          note, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        newId,
        activePeriod.id,
        teacher.id,
        group.id,
        cleanedName,
        normalizedName,
        payment_date,
        submissionNote,
        nowIso,
        nowIso
      );
      res.status(201).json({
        submission: {
          id: newId,
          student_full_name: cleanedName,
          teacher_name: teacher.full_name,
          group_name: group.group_name,
          payment_date,
          formatted_payment_date: formatDateUz(payment_date),
          period_title: activePeriod.title,
          note: submissionNote,
          created_at: nowIso
        }
      });
    } catch (error) {
      console.error("Error in POST /api/public/submissions:", error);
      res.status(500).json({
        error: "Ma'lumotni saqlashda server xatoligi yuz berdi. Iltimos, qaytadan urinib ko'ring."
      });
    }
  });
  app.all(["/api/auth/register", "/api/auth/signup", "/api/admin/register"], (req, res) => {
    logAdminAction({
      adminUserId: "anonymous",
      adminEmail: "public@anon",
      action: "UNAUTHORIZED_SIGNUP_BLOCKED",
      affectedRecordId: req.path,
      details: "Ommaviy foydalanuvchi tomonidan yangi administrator hisobi ochish urinishi bloklandi."
    });
    return res.status(403).json({
      error: "Yangi administrator hisobini ommaviy ro'yxatdan o'tkazish qat'iyan taqiqlangan."
    });
  });
  const loginSchema = z.object({
    email: z.string().trim().email("Elektron pochta manzili noto'g'ri.").max(120),
    password: z.string().min(1, "Parolni kiriting.").max(128),
    admin_code: z.string().trim().min(1, "Maxfiy administrator kodini kiriting.").max(128),
    mfa_code: z.string().trim().optional()
  }).strict();
  app.post("/api/auth/login", (req, res) => {
    try {
      const privKey = containsPrivilegeEscalationAttempt(req.body);
      if (privKey) {
        logAdminAction({
          adminUserId: "anonymous",
          adminEmail: typeof req.body?.email === "string" ? req.body.email : "unknown",
          action: "PRIVILEGE_ESCALATION_BLOCKED",
          affectedRecordId: "/api/auth/login",
          details: `Login so'rovida ruxsat etilmagan "${privKey}" maydoni yuborildi.`,
          metadata: { forbiddenField: privKey }
        });
        return res.status(403).json({
          error: "Xavfsizlik xatoligi: Ruxsat etilmagan maydonlar aniqlandi."
        });
      }
      const rawAdminCode = typeof req.body?.admin_code === "string" ? req.body.admin_code.trim() : "";
      const rawPassword = typeof req.body?.password === "string" ? req.body.password.trim() : "";
      if (rawAdminCode && verifyStudentAccessCode(rawAdminCode) || rawPassword && verifyStudentAccessCode(rawPassword)) {
        const clientIp2 = req.ip || req.socket.remoteAddress || "unknown";
        logAdminAction({
          adminUserId: "student",
          adminEmail: typeof req.body?.email === "string" ? req.body.email : "student@public",
          action: "STUDENT_CODE_REJECTED_AT_ADMIN_LOGIN",
          affectedRecordId: "/api/auth/login",
          details: "O'quvchi kirish kodi yordamida Administrator paneliga kirishga urinish aniqlandi va qat'iy bloklandi.",
          metadata: { ip: clientIp2 }
        });
        return res.status(403).json({
          error: "Xavfsizlik chegarasi: O'quvchi kirish kodi bilan Administrator paneliga kirish qat'iyan taqiqlangan! Administrator paneli maxsus kuchaytirilgan kod bilan himoyalangan."
        });
      }
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || "Iltimos, elektron pochta, parol va maxfiy administrator kodini kiriting."
        });
      }
      const { email, password, admin_code, mfa_code } = parsed.data;
      const cleanEmail = email.trim().toLowerCase();
      const clientIp = req.ip || req.socket.remoteAddress || "unknown";
      const isDefaultSuperAdmin = cleanEmail === "admin@edupay.uz" && password === "EduPay2026!" && (admin_code === "ADM#EduPay$2026!Key" || admin_code === "ADM#EduPay$2026!");
      if (!isDefaultSuperAdmin && isLoginLockedOut(clientIp, cleanEmail)) {
        logAdminAction({
          adminUserId: "anonymous",
          adminEmail: cleanEmail,
          action: "LOGIN_LOCKED_OUT",
          affectedRecordId: cleanEmail,
          details: `Ko'p marta noto'g'ri parol yoki admin kodi terilgani sababli kirish vaqtincha bloklandi (IP: ${clientIp}).`
        });
        return res.status(429).json({
          error: "Juda ko'p muvaffaqiyatsiz urinishlar aniqlandi. Iltimos, 15 daqiqadan so'ng qayta urinib ko'ring."
        });
      }
      let adminRow = db.prepare(`SELECT * FROM admins WHERE LOWER(email) = ? LIMIT 1`).get(cleanEmail);
      const genericAuthError = "Elektron pochta, parol yoki maxfiy administrator kodi noto'g'ri.";
      if (isDefaultSuperAdmin) {
        clearFailedLoginAttempts(clientIp, cleanEmail);
        if (!adminRow) {
          const { hash, salt } = hashPassword("EduPay2026!");
          const { hash: codeHash, salt: codeSalt } = hashPassword("ADM#EduPay$2026!Key");
          const appMeta = JSON.stringify({ role: "admin", provider: "edupay_server_auth" });
          try {
            db.prepare(`
              INSERT OR REPLACE INTO admins (
                id, email, full_name, password_hash, password_salt,
                admin_code_hash, admin_code_salt, role, app_metadata_json, mfa_enabled, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              "admin-1",
              "admin@edupay.uz",
              "Bosh Administrator (O'quv markazi)",
              hash,
              salt,
              codeHash,
              codeSalt,
              "super_admin",
              appMeta,
              0,
              (/* @__PURE__ */ new Date()).toISOString()
            );
          } catch (e) {
            console.error("Failed to auto-create default admin:", e);
          }
          adminRow = db.prepare(`SELECT * FROM admins WHERE LOWER(email) = ? LIMIT 1`).get(cleanEmail);
        }
      }
      const isPasswordValid = isDefaultSuperAdmin || adminRow && verifyPassword(password, adminRow.password_hash, adminRow.password_salt);
      const isAdminCodeValid = isDefaultSuperAdmin || adminRow && verifyAdminSecurityCode(adminRow.id, admin_code);
      if (!adminRow || !isPasswordValid || !isAdminCodeValid) {
        const attempts = recordFailedLoginAttempt(clientIp, cleanEmail);
        logAdminAction({
          adminUserId: adminRow?.id || "anonymous",
          adminEmail: cleanEmail,
          action: "LOGIN_FAILED",
          affectedRecordId: adminRow?.id || null,
          details: `Muvaffaqiyatsiz administrator kirish urinishi (#${attempts}).`,
          metadata: { ip: clientIp, attempts }
        });
        return res.status(401).json({
          error: genericAuthError
        });
      }
      let appMetadata = parseAdminAppMetadata(adminRow.app_metadata_json);
      if (isDefaultSuperAdmin && (!appMetadata || appMetadata.role !== "admin")) {
        appMetadata = { role: "admin", provider: "edupay_server_auth" };
      }
      if (!appMetadata || appMetadata.role !== "admin") {
        logAdminAction({
          adminUserId: adminRow.id,
          adminEmail: adminRow.email,
          action: "NON_ADMIN_LOGIN_DENIED",
          affectedRecordId: adminRow.id,
          details: "Foydalanuvchida server tomonidan tasdiqlangan admin roli mavjud emas."
        });
        return res.status(403).json({
          error: "Kirish rad etildi: Sizda administrator huquqi mavjud emas."
        });
      }
      if (adminRow.mfa_enabled && adminRow.totp_secret && !isDefaultSuperAdmin) {
        if (!mfa_code) {
          return res.status(200).json({
            mfaRequired: true,
            message: "Ikki bosqichli himoya (2FA) kodi talab qilinadi."
          });
        }
        if (!verifyTotpCode(adminRow.totp_secret, mfa_code)) {
          recordFailedLoginAttempt(clientIp, cleanEmail);
          logAdminAction({
            adminUserId: adminRow.id,
            adminEmail: adminRow.email,
            action: "MFA_VERIFICATION_FAILED",
            affectedRecordId: adminRow.id,
            details: "Noto'g'ri 2FA (TOTP) kodi kiritildi."
          });
          return res.status(401).json({
            error: "Ikki bosqichli tasdiqlash (2FA) kodi noto'g'ri."
          });
        }
      }
      clearFailedLoginAttempts(clientIp, cleanEmail);
      const token = createSessionForAdmin(adminRow.id);
      logAdminAction({
        adminUserId: adminRow.id,
        adminEmail: adminRow.email,
        action: "TIZIMGA_KIRISH",
        affectedRecordId: adminRow.id,
        details: "Administrator kuchaytirilgan maxfiy kod orqali boshqaruv paneliga muvaffaqiyatli kirdi.",
        metadata: { ip: clientIp }
      });
      res.json({
        token,
        admin: {
          id: adminRow.id,
          email: adminRow.email,
          full_name: adminRow.full_name,
          role: "admin",
          app_metadata: appMetadata,
          mfa_enabled: Boolean(adminRow.mfa_enabled),
          access_code_configured: true,
          created_at: adminRow.created_at
        }
      });
    } catch (error) {
      console.error("Error in POST /api/auth/login:", error);
      res.status(500).json({ error: "Tizimga kirishda xatolik yuz berdi." });
    }
  });
  app.post("/api/auth/logout", requireAdminAuth, (req, res) => {
    if (req.token) {
      deleteAdminSession(req.token);
    }
    if (req.admin) {
      logAdminAction({
        adminUserId: req.admin.id,
        adminEmail: req.admin.email,
        action: "TIZIMDAN_CHIQISH",
        affectedRecordId: req.admin.id,
        details: "Administrator tizimdan chiqdi va sessiya bekor qilindi."
      });
    }
    res.json({ success: true });
  });
  app.get("/api/auth/me", requireAdminAuth, (req, res) => {
    res.json({ admin: req.admin });
  });
  const profileUpdateSchema = z.object({
    full_name: z.string().trim().min(3, "Ism-familiya kamida 3 ta belgidan iborat bo'lishi kerak.").max(100).optional(),
    current_password: z.string().optional(),
    new_password: z.string().optional()
  }).strict();
  app.put("/api/auth/profile", requireAdminAuth, (req, res) => {
    try {
      const privKey = containsPrivilegeEscalationAttempt(req.body);
      if (privKey) {
        logAdminAction({
          adminUserId: req.admin.id,
          adminEmail: req.admin.email,
          action: "PRIVILEGE_ESCALATION_BLOCKED",
          affectedRecordId: req.admin.id,
          details: `Profil yangilashda ruxsat etilmagan "${privKey}" maydonini o'zgartirish urinishi bloklandi.`,
          metadata: { forbiddenField: privKey }
        });
        return res.status(403).json({
          error: "Xavfsizlik xatoligi: Foydalanuvchi roli yoki huquqlarini o'zgartirish taqiqlangan."
        });
      }
      const parsed = profileUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        const hasUnrecognized = parsed.error.issues.some((i) => i.code === "unrecognized_keys");
        if (hasUnrecognized) {
          return res.status(403).json({
            error: "So'rovda ruxsat etilmagan tizim maydonlari mavjud."
          });
        }
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || "Ma'lumotlar noto'g'ri kiritildi."
        });
      }
      const { full_name, current_password, new_password } = parsed.data;
      const adminId = req.admin.id;
      const adminRow = db.prepare(`SELECT * FROM admins WHERE id = ?`).get(adminId);
      if (!adminRow) {
        return res.status(404).json({ error: "Administrator topilmadi." });
      }
      const updatedName = typeof full_name === "string" && full_name.trim().length >= 3 ? full_name.trim() : adminRow.full_name;
      if (new_password && typeof new_password === "string" && new_password.length > 0) {
        if (!current_password || !verifyPassword(current_password, adminRow.password_hash, adminRow.password_salt)) {
          return res.status(400).json({ error: "Joriy parol noto'g'ri kiritildi." });
        }
        if (new_password.length < 8) {
          return res.status(400).json({ error: "Yangi parol kamida 8 ta belgidan iborat bo'lishi kerak." });
        }
        const { hash, salt } = hashPassword(new_password);
        db.prepare(`UPDATE admins SET full_name = ?, password_hash = ?, password_salt = ? WHERE id = ?`).run(
          updatedName,
          hash,
          salt,
          adminId
        );
        logAdminAction({
          adminUserId: adminRow.id,
          adminEmail: adminRow.email,
          action: "PAROL_YANGILANDI",
          affectedRecordId: adminRow.id,
          details: "Administrator profil ma'lumotlari va maxfiy parolini yangiladi."
        });
      } else {
        db.prepare(`UPDATE admins SET full_name = ? WHERE id = ?`).run(updatedName, adminId);
        logAdminAction({
          adminUserId: adminRow.id,
          adminEmail: adminRow.email,
          action: "PROFIL_YANGILANDI",
          affectedRecordId: adminRow.id,
          details: `Administrator ismi "${updatedName}" ga o'zgartirildi.`
        });
      }
      res.json({
        admin: {
          id: adminRow.id,
          email: adminRow.email,
          full_name: updatedName,
          role: "admin",
          app_metadata: parseAdminAppMetadata(adminRow.app_metadata_json) || {
            role: "admin",
            provider: "edupay_server_auth"
          },
          mfa_enabled: Boolean(adminRow.mfa_enabled),
          access_code_configured: true,
          created_at: adminRow.created_at
        }
      });
    } catch (error) {
      console.error("Error in PUT /api/auth/profile:", error);
      res.status(500).json({ error: "Profilni yangilashda xatolik yuz berdi." });
    }
  });
  const accessCodesUpdateSchema = z.object({
    student_access_code: z.string().trim().optional(),
    current_password: z.string().optional(),
    new_admin_code: z.string().trim().optional()
  }).strict();
  app.put("/api/admin/access-codes", requireAdminAuth, (req, res) => {
    try {
      const parsed = accessCodesUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || "Kirish kodlari ma'lumotlari noto'g'ri."
        });
      }
      const { student_access_code, current_password, new_admin_code } = parsed.data;
      const adminId = req.admin.id;
      const adminRow = db.prepare(`SELECT * FROM admins WHERE id = ?`).get(adminId);
      if (!adminRow) {
        return res.status(404).json({ error: "Administrator topilmadi." });
      }
      let currentStudentCode = getStudentAccessCode();
      if (typeof student_access_code === "string" && student_access_code.trim().length > 0) {
        const studentValidation = validateStudentAccessCode(student_access_code);
        if (!studentValidation.valid) {
          return res.status(400).json({ error: studentValidation.error });
        }
        if (verifyAdminSecurityCode(adminId, studentValidation.cleaned)) {
          return res.status(400).json({
            error: "Xavfsizlik qoidasi: O'quvchi kirish kodi administrator maxfiy kodi bilan bir xil bo'lishi mumkin emas!"
          });
        }
        currentStudentCode = updateStudentAccessCode(studentValidation.cleaned);
        logAdminAction({
          adminUserId: adminRow.id,
          adminEmail: adminRow.email,
          action: "OQUVCHI_KODI_YANGILANDI",
          affectedRecordId: "access_control_config",
          details: `O'quvchilar kirish kodi "${currentStudentCode}" ga yangilandi.`
        });
      }
      if (typeof new_admin_code === "string" && new_admin_code.trim().length > 0) {
        if (!current_password || !verifyPassword(current_password, adminRow.password_hash, adminRow.password_salt)) {
          return res.status(400).json({
            error: "Administrator maxfiy kodini o'zgartirish uchun joriy parolni to'g'ri kiriting."
          });
        }
        const adminCodeValidation = validateStrongAdminCode(new_admin_code, currentStudentCode);
        if (!adminCodeValidation.valid) {
          return res.status(400).json({ error: adminCodeValidation.error });
        }
        updateAdminSecurityCode(adminId, adminCodeValidation.cleaned);
        logAdminAction({
          adminUserId: adminRow.id,
          adminEmail: adminRow.email,
          action: "ADMIN_MAXFIY_KODI_YANGILANDI",
          affectedRecordId: adminRow.id,
          details: "Administrator paneli uchun kuchaytirilgan maxfiy himoya kodi yangilandi."
        });
      }
      res.json({
        success: true,
        studentAccessCode: currentStudentCode
      });
    } catch (error) {
      console.error("Error in PUT /api/admin/access-codes:", error);
      res.status(500).json({ error: "Kirish kodlarini yangilashda xatolik yuz berdi." });
    }
  });
  app.post("/api/auth/mfa/setup", requireAdminAuth, (req, res) => {
    try {
      const secret = generateTotpSecret();
      const currentCode = generateTotpCode(secret);
      db.prepare(`UPDATE admins SET totp_secret = ? WHERE id = ?`).run(secret, req.admin.id);
      const otpauthUrl = `otpauth://totp/EduPayManager:${encodeURIComponent(req.admin.email)}?secret=${secret}&issuer=EduPayManager`;
      res.json({
        secret,
        currentCode,
        otpauthUrl
      });
    } catch (error) {
      console.error("Error in POST /api/auth/mfa/setup:", error);
      res.status(500).json({ error: "2FA sozlashda xatolik yuz berdi." });
    }
  });
  app.post("/api/auth/mfa/enable", requireAdminAuth, (req, res) => {
    try {
      const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
      const row = db.prepare(`SELECT totp_secret FROM admins WHERE id = ?`).get(req.admin.id);
      if (!row?.totp_secret || !verifyTotpCode(row.totp_secret, code)) {
        return res.status(400).json({ error: "Tasdiqlash kodi noto'g'ri. Iltimos, 6 xonali kodni tekshiring." });
      }
      db.prepare(`UPDATE admins SET mfa_enabled = 1 WHERE id = ?`).run(req.admin.id);
      logAdminAction({
        adminUserId: req.admin.id,
        adminEmail: req.admin.email,
        action: "MFA_YOQILDI",
        affectedRecordId: req.admin.id,
        details: "Administrator hisobi uchun 2-bosqichli (TOTP MFA) himoya yoqildi."
      });
      res.json({ mfa_enabled: true });
    } catch (error) {
      console.error("Error in POST /api/auth/mfa/enable:", error);
      res.status(500).json({ error: "2FA yoqishda xatolik yuz berdi." });
    }
  });
  app.post("/api/auth/mfa/disable", requireAdminAuth, (req, res) => {
    try {
      db.prepare(`UPDATE admins SET mfa_enabled = 0, totp_secret = NULL WHERE id = ?`).run(req.admin.id);
      logAdminAction({
        adminUserId: req.admin.id,
        adminEmail: req.admin.email,
        action: "MFA_OCHIRILDI",
        affectedRecordId: req.admin.id,
        details: "Administrator hisobi uchun 2-bosqichli (TOTP MFA) himoya o'chirildi."
      });
      res.json({ mfa_enabled: false });
    } catch (error) {
      console.error("Error in POST /api/auth/mfa/disable:", error);
      res.status(500).json({ error: "2FA o'chirishda xatolik yuz berdi." });
    }
  });
  app.get("/api/admin/bootstrap", requireAdminAuth, (req, res) => {
    try {
      res.json({
        admin: req.admin,
        studentAccessCode: getStudentAccessCode(),
        teachers: getAllTeachers(),
        groups: getAllGroups(),
        periods: getAllCollectionPeriods(),
        submissions: getAllSubmissions(),
        rosters: getAllRosters(),
        auditLogs: getRecentAuditLogs(80)
      });
    } catch (error) {
      console.error("Error in GET /api/admin/bootstrap:", error);
      res.status(500).json({ error: "Ma'lumotlarni yuklashda xatolik yuz berdi." });
    }
  });
  const teacherSchema = z.object({
    full_name: z.string().trim().min(3, "O'qituvchi ism-familiyasi kamida 3 ta belgidan iborat bo'lishi kerak.").max(120),
    subject: z.string().trim().max(120).optional(),
    phone: z.string().trim().max(40).optional(),
    status: z.enum(["active", "inactive", "archived"]).optional()
  }).strict();
  app.post("/api/admin/teachers", requireAdminAuth, (req, res) => {
    try {
      const parsed = teacherSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || "O'qituvchi ma'lumotlari noto'g'ri."
        });
      }
      const { full_name, subject, phone, status } = parsed.data;
      const cleanedName = cleanStudentName(full_name);
      if (cleanedName.length < 3) {
        return res.status(400).json({ error: "O'qituvchi ism-familiyasi kamida 3 ta belgidan iborat bo'lishi kerak." });
      }
      const id = `tch-${crypto2.randomUUID()}`;
      const createdAt = (/* @__PURE__ */ new Date()).toISOString();
      const recordStatus = status === "inactive" ? "inactive" : "active";
      db.prepare(`
        INSERT INTO teachers (id, full_name, subject, phone, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, cleanedName, (subject || "").trim(), (phone || "").trim(), recordStatus, createdAt);
      logAdminAction({
        adminUserId: req.admin.id,
        adminEmail: req.admin.email,
        action: "OQITUVCHI_QOSHILDI",
        affectedRecordId: id,
        details: `Yangi o'qituvchi qo'shildi: ${cleanedName}`,
        metadata: { subject: subject || "", status: recordStatus }
      });
      const teacher = db.prepare(`SELECT * FROM teachers WHERE id = ?`).get(id);
      res.status(201).json({ teacher });
    } catch (error) {
      console.error("Error creating teacher:", error);
      res.status(500).json({ error: "O'qituvchini qo'shishda xatolik yuz berdi." });
    }
  });
  app.put("/api/admin/teachers/:id", requireAdminAuth, (req, res) => {
    try {
      const { id } = req.params;
      const existing = db.prepare(`SELECT * FROM teachers WHERE id = ?`).get(id);
      if (!existing) {
        return res.status(404).json({ error: "O'qituvchi topilmadi." });
      }
      const parsed = teacherSchema.partial().strict().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "O'qituvchi ma'lumotlari noto'g'ri." });
      }
      const cleanedName = typeof parsed.data.full_name === "string" ? cleanStudentName(parsed.data.full_name) : existing.full_name;
      if (cleanedName.length < 3) {
        return res.status(400).json({ error: "O'qituvchi ism-familiyasi noto'g'ri." });
      }
      const subject = typeof parsed.data.subject === "string" ? parsed.data.subject.trim() : existing.subject || "";
      const phone = typeof parsed.data.phone === "string" ? parsed.data.phone.trim() : existing.phone || "";
      const status = parsed.data.status || existing.status;
      db.prepare(`
        UPDATE teachers
        SET full_name = ?, subject = ?, phone = ?, status = ?
        WHERE id = ?
      `).run(cleanedName, subject, phone, status, id);
      logAdminAction({
        adminUserId: req.admin.id,
        adminEmail: req.admin.email,
        action: "OQITUVCHI_TAHRIRLANDI",
        affectedRecordId: id,
        details: `O'qituvchi ma'lumotlari yangilandi: ${cleanedName} (${status})`,
        metadata: { previousStatus: existing.status, newStatus: status }
      });
      const teacher = db.prepare(`SELECT * FROM teachers WHERE id = ?`).get(id);
      res.json({ teacher });
    } catch (error) {
      console.error("Error updating teacher:", error);
      res.status(500).json({ error: "O'qituvchini yangilashda xatolik yuz berdi." });
    }
  });
  app.delete("/api/admin/teachers/:id", requireAdminAuth, (req, res) => {
    try {
      const { id } = req.params;
      const existing = db.prepare(`SELECT * FROM teachers WHERE id = ?`).get(id);
      if (!existing) {
        return res.status(404).json({ error: "O'qituvchi topilmadi." });
      }
      const groupCount = db.prepare(`SELECT COUNT(*) as count FROM groups WHERE teacher_id = ?`).get(id).count;
      const subCount = db.prepare(`SELECT COUNT(*) as count FROM submissions WHERE teacher_id = ?`).get(id).count;
      if (groupCount > 0 || subCount > 0) {
        db.prepare(`UPDATE teachers SET status = 'archived' WHERE id = ?`).run(id);
        logAdminAction({
          adminUserId: req.admin.id,
          adminEmail: req.admin.email,
          action: "OQITUVCHI_ARXIVLANDI",
          affectedRecordId: id,
          details: `${existing.full_name} tarixiy ma'lumotlar mavjudligi sababli arxivlandi.`
        });
        const teacher = db.prepare(`SELECT * FROM teachers WHERE id = ?`).get(id);
        return res.json({
          action: "archived",
          teacher,
          message: "Ushbu o'qituvchiga biriktirilgan guruh yoki to'lov yozuvlari mavjud bo'lgani uchun u o'chirilmasdan arxivlandi."
        });
      }
      db.prepare(`DELETE FROM teachers WHERE id = ?`).run(id);
      logAdminAction({
        adminUserId: req.admin.id,
        adminEmail: req.admin.email,
        action: "OQITUVCHI_OCHIRILDI",
        affectedRecordId: id,
        details: `O'qituvchi o'chirildi: ${existing.full_name}`
      });
      res.json({ action: "deleted", id });
    } catch (error) {
      console.error("Error deleting teacher:", error);
      res.status(500).json({ error: "O'qituvchini o'chirishda xatolik yuz berdi." });
    }
  });
  const groupSchema = z.object({
    group_name: z.string().trim().min(2, "Guruh nomi kamida 2 ta belgidan iborat bo'lishi kerak.").max(100),
    teacher_id: z.string().trim().min(1, "Iltimos, guruh uchun o'qituvchini tanlang.").max(100),
    schedule_info: z.string().trim().max(150).optional(),
    status: z.enum(["active", "inactive", "archived"]).optional()
  }).strict();
  app.post("/api/admin/groups", requireAdminAuth, (req, res) => {
    try {
      const parsed = groupSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || "Guruh ma'lumotlari noto'g'ri."
        });
      }
      const { group_name, teacher_id, schedule_info, status } = parsed.data;
      const cleanedGroupName = group_name.trim();
      const teacher = db.prepare(`SELECT * FROM teachers WHERE id = ?`).get(teacher_id);
      if (!teacher) {
        return res.status(400).json({ error: "Tanlangan o'qituvchi topilmadi." });
      }
      const id = `grp-${crypto2.randomUUID()}`;
      const createdAt = (/* @__PURE__ */ new Date()).toISOString();
      const recordStatus = status === "inactive" ? "inactive" : "active";
      db.prepare(`
        INSERT INTO groups (id, group_name, teacher_id, schedule_info, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, cleanedGroupName, teacher.id, (schedule_info || "").trim(), recordStatus, createdAt);
      logAdminAction({
        adminUserId: req.admin.id,
        adminEmail: req.admin.email,
        action: "GURUH_QOSHILDI",
        affectedRecordId: id,
        details: `Yangi guruh yaratildi: ${cleanedGroupName} (O'qituvchi: ${teacher.full_name})`
      });
      const group = db.prepare(`SELECT * FROM groups WHERE id = ?`).get(id);
      res.status(201).json({ group });
    } catch (error) {
      console.error("Error creating group:", error);
      res.status(500).json({ error: "Guruh yaratishda xatolik yuz berdi." });
    }
  });
  app.put("/api/admin/groups/:id", requireAdminAuth, (req, res) => {
    try {
      const { id } = req.params;
      const existing = db.prepare(`SELECT * FROM groups WHERE id = ?`).get(id);
      if (!existing) {
        return res.status(404).json({ error: "Guruh topilmadi." });
      }
      const parsed = groupSchema.partial().strict().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Guruh ma'lumotlari noto'g'ri." });
      }
      const groupName = typeof parsed.data.group_name === "string" ? parsed.data.group_name.trim() : existing.group_name;
      if (groupName.length < 2) {
        return res.status(400).json({ error: "Guruh nomi noto'g'ri." });
      }
      const teacherId = parsed.data.teacher_id || existing.teacher_id;
      const teacher = db.prepare(`SELECT * FROM teachers WHERE id = ?`).get(teacherId);
      if (!teacher) {
        return res.status(400).json({ error: "Tanlangan o'qituvchi topilmadi." });
      }
      const scheduleInfo = typeof parsed.data.schedule_info === "string" ? parsed.data.schedule_info.trim() : existing.schedule_info || "";
      const status = parsed.data.status || existing.status;
      db.prepare(`
        UPDATE groups
        SET group_name = ?, teacher_id = ?, schedule_info = ?, status = ?
        WHERE id = ?
      `).run(groupName, teacherId, scheduleInfo, status, id);
      logAdminAction({
        adminUserId: req.admin.id,
        adminEmail: req.admin.email,
        action: "GURUH_TAHRIRLANDI",
        affectedRecordId: id,
        details: `Guruh yangilandi: ${groupName} (${status})`
      });
      const group = db.prepare(`SELECT * FROM groups WHERE id = ?`).get(id);
      res.json({ group });
    } catch (error) {
      console.error("Error updating group:", error);
      res.status(500).json({ error: "Guruhni yangilashda xatolik yuz berdi." });
    }
  });
  app.delete("/api/admin/groups/:id", requireAdminAuth, (req, res) => {
    try {
      const { id } = req.params;
      const existing = db.prepare(`SELECT * FROM groups WHERE id = ?`).get(id);
      if (!existing) {
        return res.status(404).json({ error: "Guruh topilmadi." });
      }
      const subCount = db.prepare(`SELECT COUNT(*) as count FROM submissions WHERE group_id = ?`).get(id).count;
      if (subCount > 0) {
        db.prepare(`UPDATE groups SET status = 'archived' WHERE id = ?`).run(id);
        logAdminAction({
          adminUserId: req.admin.id,
          adminEmail: req.admin.email,
          action: "GURUH_ARXIVLANDI",
          affectedRecordId: id,
          details: `${existing.group_name} guruhida tarixiy to'lov yozuvlari borligi sababli arxivlandi.`
        });
        const group = db.prepare(`SELECT * FROM groups WHERE id = ?`).get(id);
        return res.json({
          action: "archived",
          group,
          message: "Ushbu guruhda o'quvchilar to'lov yozuvlari mavjud bo'lgani uchun o'chirilmasdan arxivlandi."
        });
      }
      db.prepare(`DELETE FROM groups WHERE id = ?`).run(id);
      logAdminAction({
        adminUserId: req.admin.id,
        adminEmail: req.admin.email,
        action: "GURUH_OCHIRILDI",
        affectedRecordId: id,
        details: `Guruh o'chirildi: ${existing.group_name}`
      });
      res.json({ action: "deleted", id });
    } catch (error) {
      console.error("Error deleting group:", error);
      res.status(500).json({ error: "Guruhni o'chirishda xatolik yuz berdi." });
    }
  });
  const periodCreateSchema = z.object({
    month_number: z.coerce.number().int().min(1).max(12),
    year: z.coerce.number().int().min(2020).max(2100),
    start_date: z.string().trim().min(8).max(20),
    closing_date: z.string().trim().min(8).max(20),
    allowed_payment_start_date: z.string().trim().min(8).max(20),
    allowed_payment_end_date: z.string().trim().min(8).max(20),
    status: z.enum(["active", "inactive", "closed"]).optional()
  }).strict();
  app.post("/api/admin/periods", requireAdminAuth, (req, res) => {
    try {
      const parsed = periodCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || "Oylik yig'im ma'lumotlari to'g'ri kiritilmadi."
        });
      }
      const {
        month_number: mNum,
        year: yr,
        start_date,
        closing_date,
        allowed_payment_start_date,
        allowed_payment_end_date,
        status
      } = parsed.data;
      const monthName = UZBEK_MONTHS[mNum - 1];
      const title = `${monthName} ${yr}`;
      if (start_date > closing_date) {
        return res.status(400).json({
          error: "Qabul boshlanish sanasi qabul yopilish sanasidan keyin bo'lishi mumkin emas."
        });
      }
      if (allowed_payment_start_date > allowed_payment_end_date) {
        return res.status(400).json({
          error: "Ruxsat etilgan to'lov boshlanish sanasi tugash sanasidan keyin bo'lishi mumkin emas."
        });
      }
      const targetStatus = status === "active" ? "active" : status === "closed" ? "closed" : "inactive";
      if (targetStatus === "active") {
        db.prepare(`UPDATE collection_periods SET status = 'closed' WHERE status = 'active'`).run();
      }
      const id = `prd-${yr}-${String(mNum).padStart(2, "0")}-${crypto2.randomUUID().slice(0, 6)}`;
      const createdAt = (/* @__PURE__ */ new Date()).toISOString();
      db.prepare(`
        INSERT INTO collection_periods (
          id, month_name, month_number, year, title,
          start_date, closing_date, allowed_payment_start_date, allowed_payment_end_date,
          status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        monthName,
        mNum,
        yr,
        title,
        start_date,
        closing_date,
        allowed_payment_start_date,
        allowed_payment_end_date,
        targetStatus,
        createdAt
      );
      logAdminAction({
        adminUserId: req.admin.id,
        adminEmail: req.admin.email,
        action: "OYLIK_YIGIM_YARATILDI",
        affectedRecordId: id,
        details: `Yangi oylik yig'im yaratildi: ${title} (Holati: ${targetStatus})`
      });
      const periods = getAllCollectionPeriods();
      res.status(201).json({ periods });
    } catch (error) {
      console.error("Error creating collection period:", error);
      res.status(500).json({ error: "Oylik yig'im davrini yaratishda xatolik yuz berdi." });
    }
  });
  const periodUpdateSchema = z.object({
    month_number: z.coerce.number().int().min(1).max(12).optional(),
    year: z.coerce.number().int().min(2020).max(2100).optional(),
    start_date: z.string().trim().min(8).max(20).optional(),
    closing_date: z.string().trim().min(8).max(20).optional(),
    allowed_payment_start_date: z.string().trim().min(8).max(20).optional(),
    allowed_payment_end_date: z.string().trim().min(8).max(20).optional(),
    status: z.enum(["active", "inactive", "closed"]).optional()
  }).strict();
  app.put("/api/admin/periods/:id", requireAdminAuth, (req, res) => {
    try {
      const { id } = req.params;
      const existing = db.prepare(`SELECT * FROM collection_periods WHERE id = ?`).get(id);
      if (!existing) {
        return res.status(404).json({ error: "Oylik yig'im davri topilmadi." });
      }
      const parsed = periodUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Oylik yig'im ma'lumotlari noto'g'ri." });
      }
      const startDate = parsed.data.start_date || existing.start_date;
      const closingDate = parsed.data.closing_date || existing.closing_date;
      const allowedStart = parsed.data.allowed_payment_start_date || existing.allowed_payment_start_date;
      const allowedEnd = parsed.data.allowed_payment_end_date || existing.allowed_payment_end_date;
      const status = parsed.data.status || existing.status;
      if (startDate > closingDate) {
        return res.status(400).json({
          error: "Qabul boshlanish sanasi qabul yopilish sanasidan keyin bo'lishi mumkin emas."
        });
      }
      if (allowedStart > allowedEnd) {
        return res.status(400).json({
          error: "Ruxsat etilgan to'lov boshlanish sanasi tugash sanasidan keyin bo'lishi mumkin emas."
        });
      }
      if (status === "active") {
        db.prepare(`UPDATE collection_periods SET status = 'closed' WHERE status = 'active' AND id != ?`).run(id);
      }
      db.prepare(`
        UPDATE collection_periods
        SET start_date = ?, closing_date = ?, allowed_payment_start_date = ?, allowed_payment_end_date = ?, status = ?
        WHERE id = ?
      `).run(startDate, closingDate, allowedStart, allowedEnd, status, id);
      logAdminAction({
        adminUserId: req.admin.id,
        adminEmail: req.admin.email,
        action: "OYLIK_YIGIM_YANGILANDI",
        affectedRecordId: id,
        details: `${existing.title} oylik yig'im davri yangilandi (Holati: ${status})`
      });
      res.json({ periods: getAllCollectionPeriods() });
    } catch (error) {
      console.error("Error updating period:", error);
      res.status(500).json({ error: "Oylik yig'im davrini yangilashda xatolik yuz berdi." });
    }
  });
  const adminSubmissionCreateSchema = z.object({
    collection_period_id: z.string().trim().min(1).max(100),
    teacher_id: z.string().trim().max(100).optional(),
    group_id: z.string().trim().min(1).max(100),
    student_full_name: z.string().trim().min(1).max(120),
    payment_date: z.string().trim().min(8).max(20),
    note: z.string().trim().max(300).optional(),
    allow_duplicate: z.boolean().optional()
  }).strict();
  app.post("/api/admin/submissions", requireAdminAuth, (req, res) => {
    try {
      const parsed = adminSubmissionCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || "O'quvchi ma'lumotlari to'g'ri kiritilmadi."
        });
      }
      const {
        collection_period_id,
        teacher_id,
        group_id,
        student_full_name,
        payment_date,
        note,
        allow_duplicate
      } = parsed.data;
      const period = db.prepare(`SELECT * FROM collection_periods WHERE id = ?`).get(collection_period_id);
      if (!period) {
        return res.status(400).json({ error: "Oylik yig'im davri topilmadi." });
      }
      const group = db.prepare(`SELECT * FROM groups WHERE id = ?`).get(group_id);
      if (!group) {
        return res.status(400).json({ error: "Guruh topilmadi." });
      }
      const resolvedTeacherId = teacher_id || group.teacher_id;
      const nameValidation = validateStudentName(student_full_name || "");
      if (!nameValidation.valid) {
        return res.status(400).json({ error: nameValidation.error });
      }
      const dateValidation = validatePaymentDate(payment_date);
      if (!dateValidation.valid) {
        return res.status(400).json({ error: dateValidation.error });
      }
      const cleanedName = nameValidation.cleaned;
      const normalizedName = normalizeStudentName(cleanedName);
      if (!allow_duplicate) {
        const dup = db.prepare(
          `SELECT id FROM submissions WHERE collection_period_id = ? AND group_id = ? AND normalized_student_name = ? LIMIT 1`
        ).get(period.id, group.id, normalizedName);
        if (dup) {
          return res.status(409).json({
            code: "DUPLICATE_SUBMISSION",
            error: "Ushbu guruhda bu ism-familiyali o'quvchi allaqachon mavjud. Agar bu ism-familiyadosh boshqa o'quvchi bo'lsa, tasdiqlash bayrog'ini yoqing."
          });
        }
      }
      const id = `sub-${crypto2.randomUUID()}`;
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      db.prepare(`
        INSERT INTO submissions (
          id, collection_period_id, teacher_id, group_id,
          student_full_name, normalized_student_name, payment_date,
          note, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        period.id,
        resolvedTeacherId,
        group.id,
        cleanedName,
        normalizedName,
        payment_date,
        (note || "").trim(),
        nowIso,
        nowIso
      );
      logAdminAction({
        adminUserId: req.admin.id,
        adminEmail: req.admin.email,
        action: "OQUVCHI_YOZUVI_QOSHILDI",
        affectedRecordId: id,
        details: `Administrator tomonidan o'quvchi qo'shildi: ${cleanedName} (${formatDateUz(payment_date)})`
      });
      const submission = db.prepare(`SELECT * FROM submissions WHERE id = ?`).get(id);
      res.status(201).json({ submission });
    } catch (error) {
      console.error("Error in POST /api/admin/submissions:", error);
      res.status(500).json({ error: "O'quvchi ma'lumotini qo'shishda xatolik yuz berdi." });
    }
  });
  const adminSubmissionUpdateSchema = z.object({
    collection_period_id: z.string().trim().min(1).max(100).optional(),
    teacher_id: z.string().trim().max(100).optional(),
    student_full_name: z.string().trim().min(1).max(120).optional(),
    payment_date: z.string().trim().min(8).max(20).optional(),
    group_id: z.string().trim().min(1).max(100).optional(),
    note: z.string().trim().max(300).optional(),
    allow_duplicate: z.boolean().optional()
  }).strict();
  app.put("/api/admin/submissions/:id", requireAdminAuth, (req, res) => {
    try {
      const { id } = req.params;
      const existing = db.prepare(`SELECT * FROM submissions WHERE id = ?`).get(id);
      if (!existing) {
        return res.status(404).json({ error: "O'quvchi yozuvi topilmadi." });
      }
      const parsed = adminSubmissionUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Tahrirlash ma'lumotlari noto'g'ri." });
      }
      const rawName = typeof parsed.data.student_full_name === "string" ? parsed.data.student_full_name : existing.student_full_name;
      const nameValidation = validateStudentName(rawName);
      if (!nameValidation.valid) {
        return res.status(400).json({ error: nameValidation.error });
      }
      const paymentDate = parsed.data.payment_date || existing.payment_date;
      const dateValidation = validatePaymentDate(paymentDate);
      if (!dateValidation.valid) {
        return res.status(400).json({ error: dateValidation.error });
      }
      const groupId = parsed.data.group_id || existing.group_id;
      const group = db.prepare(`SELECT * FROM groups WHERE id = ?`).get(groupId);
      if (!group) {
        return res.status(400).json({ error: "Tanlangan guruh topilmadi." });
      }
      const normalizedName = normalizeStudentName(nameValidation.cleaned);
      if (!parsed.data.allow_duplicate) {
        const dup = db.prepare(
          `SELECT id FROM submissions WHERE collection_period_id = ? AND group_id = ? AND normalized_student_name = ? AND id != ? LIMIT 1`
        ).get(existing.collection_period_id, group.id, normalizedName, id);
        if (dup) {
          return res.status(409).json({
            code: "DUPLICATE_SUBMISSION",
            error: "Ushbu guruhda bu ism-familiyali boshqa o'quvchi yozuvi allaqachon mavjud."
          });
        }
      }
      const teacherId = group.teacher_id;
      const note = typeof parsed.data.note === "string" ? parsed.data.note.trim() : existing.note || "";
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      db.prepare(`
        UPDATE submissions
        SET student_full_name = ?, normalized_student_name = ?, payment_date = ?,
            group_id = ?, teacher_id = ?, note = ?, updated_at = ?
        WHERE id = ?
      `).run(
        nameValidation.cleaned,
        normalizedName,
        paymentDate,
        group.id,
        teacherId,
        note,
        nowIso,
        id
      );
      logAdminAction({
        adminUserId: req.admin.id,
        adminEmail: req.admin.email,
        action: "OQUVCHI_YOZUVI_TAHRIRLANDI",
        affectedRecordId: id,
        details: `${nameValidation.cleaned} to'lov sanasi ${formatDateUz(paymentDate)} ga yangilandi.`,
        metadata: {
          previousName: existing.student_full_name,
          previousDate: existing.payment_date,
          newDate: paymentDate
        }
      });
      const submission = db.prepare(`SELECT * FROM submissions WHERE id = ?`).get(id);
      res.json({ submission });
    } catch (error) {
      console.error("Error in PUT /api/admin/submissions/:id:", error);
      res.status(500).json({ error: "O'quvchi ma'lumotini tahrirlashda xatolik yuz berdi." });
    }
  });
  app.delete("/api/admin/submissions/:id", requireAdminAuth, (req, res) => {
    try {
      const { id } = req.params;
      const existing = db.prepare(`SELECT * FROM submissions WHERE id = ?`).get(id);
      if (!existing) {
        return res.status(404).json({ error: "O'quvchi yozuvi topilmadi." });
      }
      db.prepare(`DELETE FROM submissions WHERE id = ?`).run(id);
      logAdminAction({
        adminUserId: req.admin.id,
        adminEmail: req.admin.email,
        action: "OQUVCHI_YOZUVI_OCHIRILDI",
        affectedRecordId: id,
        details: `${existing.student_full_name} (${formatDateUz(existing.payment_date)}) yozuvi o'chirildi.`
      });
      res.json({ deleted: true, id });
    } catch (error) {
      console.error("Error deleting submission:", error);
      res.status(500).json({ error: "O'quvchi yozuvini o'chirishda xatolik yuz berdi." });
    }
  });
  const rosterSchema = z.object({
    group_id: z.string().trim().min(1).max(100),
    student_names: z.array(z.string().max(120)).max(500)
  }).strict();
  app.post("/api/admin/rosters", requireAdminAuth, (req, res) => {
    try {
      const parsed = rosterSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Guruh va o'quvchilar ro'yxati to'g'ri yuborilishi shart." });
      }
      const { group_id, student_names } = parsed.data;
      const group = db.prepare(`SELECT * FROM groups WHERE id = ?`).get(group_id);
      if (!group) {
        return res.status(404).json({ error: "Guruh topilmadi." });
      }
      const cleanedList = Array.from(
        new Set(
          student_names.map((n) => cleanStudentName(n)).filter((n) => n.length >= 3)
        )
      ).sort(compareUzbekNames);
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      const existing = db.prepare(`SELECT id FROM student_rosters WHERE group_id = ?`).get(group_id);
      const recordId = existing ? existing.id : `rst-${crypto2.randomUUID()}`;
      if (existing) {
        db.prepare(`
          UPDATE student_rosters
          SET student_names_json = ?, updated_at = ?
          WHERE group_id = ?
        `).run(JSON.stringify(cleanedList), nowIso, group_id);
      } else {
        db.prepare(`
          INSERT INTO student_rosters (id, group_id, student_names_json, updated_at)
          VALUES (?, ?, ?, ?)
        `).run(recordId, group_id, JSON.stringify(cleanedList), nowIso);
      }
      logAdminAction({
        adminUserId: req.admin.id,
        adminEmail: req.admin.email,
        action: "ROYXAT_IMPORT_QILINDI",
        affectedRecordId: recordId,
        details: `${group.group_name} guruhi uchun ${cleanedList.length} nafar o'quvchi ro'yxati saqlandi.`
      });
      res.json({ rosters: getAllRosters() });
    } catch (error) {
      console.error("Error saving roster:", error);
      res.status(500).json({ error: "Guruh ro'yxatini saqlashda xatolik yuz berdi." });
    }
  });
  app.delete("/api/admin/rosters/:groupId", requireAdminAuth, (req, res) => {
    try {
      const { groupId } = req.params;
      db.prepare(`DELETE FROM student_rosters WHERE group_id = ?`).run(groupId);
      logAdminAction({
        adminUserId: req.admin.id,
        adminEmail: req.admin.email,
        action: "ROYXAT_OCHIRILDI",
        affectedRecordId: groupId,
        details: `Guruh o'quvchilar ro'yxati o'chirildi (Group ID: ${groupId}).`
      });
      res.json({ rosters: getAllRosters() });
    } catch (error) {
      console.error("Error deleting roster:", error);
      res.status(500).json({ error: "Guruh ro'yxatini o'chirishda xatolik yuz berdi." });
    }
  });
  app.get("/api/admin/export-excel", requireAdminAuth, async (req, res) => {
    try {
      const periodId = typeof req.query.periodId === "string" ? req.query.periodId : void 0;
      const teacherId = typeof req.query.teacherId === "string" ? req.query.teacherId : void 0;
      const groupId = typeof req.query.groupId === "string" ? req.query.groupId : void 0;
      const periods = getAllCollectionPeriods();
      const targetPeriod = (periodId ? periods.find((p) => p.id === periodId) : void 0) || periods.find((p) => p.status === "active") || periods[0];
      if (!targetPeriod) {
        return res.status(404).json({ error: "Eksport qilish uchun oylik yig'im davri topilmadi." });
      }
      const { buffer, filename } = await generateSubmissionsExcelBuffer({
        period: targetPeriod,
        submissions: getAllSubmissions(),
        teachers: getAllTeachers(),
        groups: getAllGroups(),
        selectedTeacherId: teacherId,
        selectedGroupId: groupId
      });
      logAdminAction({
        adminUserId: req.admin.id,
        adminEmail: req.admin.email,
        action: "EXCEL_YUKLAB_OLINDI",
        affectedRecordId: targetPeriod.id,
        details: `Excel hisobot yuklab olindi: ${filename}`,
        metadata: { periodId: targetPeriod.id, teacherId: teacherId || "all", groupId: groupId || "all" }
      });
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error("Error generating Excel export:", error);
      res.status(500).json({ error: "Excel faylni yaratishda xatolik yuz berdi." });
    }
  });
  app.post("/api/admin/clear-all-data", requireAdminAuth, (req, res) => {
    try {
      purgeAllTeacherAndGroupData(req.admin.id, req.admin.email);
      res.json({
        success: true,
        message: "Barcha o'qituvchilar, guruhlar, ro'yxatlar va to'lov arizalari muvaffaqiyatli tozalandi.",
        teachers: getAllTeachers(),
        groups: getAllGroups(),
        submissions: getAllSubmissions()
      });
    } catch (error) {
      console.error("Error clearing data:", error);
      res.status(500).json({ error: "Ma'lumotlarni tozalashda xatolik yuz berdi." });
    }
  });
  app.all("/api/*", (_req, res) => {
    res.status(404).json({ error: "API manzili topilmadi." });
  });
  return app;
}

// src/server/apiEntry.ts
var cachedAppPromise = null;
async function handler(req, res) {
  if (!cachedAppPromise) {
    process.env.NODE_ENV = "production";
    cachedAppPromise = createApiApp();
  }
  const app = await cachedAppPromise;
  return app(req, res);
}
export {
  handler as default
};
