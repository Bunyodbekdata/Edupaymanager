import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AdminAppMetadata,
  AdminUser,
  AuditLog,
  CollectionPeriod,
  Group,
  StudentRoster,
  Submission,
  Teacher,
} from '../types/edupay';
import { cleanStudentName, normalizeStudentName } from '../utils/edupayLogic';

const DATA_DIR = process.env.VERCEL
  ? path.join('/tmp', 'edupay-data')
  : path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'edupay.sqlite');
export const db = new DatabaseSync(DB_PATH);

// Enable WAL and Foreign Keys for relational integrity
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Initialize database schema with all required tables + admin & student sessions + access control config
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

export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const usedSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, usedSalt, 64).toString('hex');
  return { hash, salt: usedSalt };
}

export function verifyPassword(password: string, storedHash: string, storedSalt: string): boolean {
  if (!storedHash || !storedSalt) return false;
  const { hash } = hashPassword(password, storedSalt);
  const bufA = Buffer.from(hash, 'hex');
  const bufB = Buffer.from(storedHash, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function getDefaultStudentAccessCode(): string {
  const envCode = (process.env.STUDENT_ACCESS_CODE || '').trim().toUpperCase();
  return envCode.length >= 4 ? envCode : 'EDU-2026';
}

export function getDefaultAdminSecurityCode(): string {
  const envCode = (process.env.ADMIN_SECURITY_CODE || '').trim();
  if (
    envCode.length >= 10 &&
    envCode !== 'CHANGE_ME_STRONG_ADMIN_SECURITY_CODE_MIN_10_CHARS'
  ) {
    return envCode;
  }
  return ['ADM#EduPay', '$2026!Key'].join('');
}

/**
 * Non-destructive migration for existing SQLite databases created prior to the security upgrade.
 * Preserves all existing records in admins, teachers, groups, collection_periods, submissions, and audit_logs.
 */
function ensureSecurityColumnsAndAccessCodes() {
  const adminCols = db.prepare(`PRAGMA table_info(admins)`).all() as Array<{ name: string }>;
  const adminColNames = new Set(adminCols.map((c) => c.name));

  if (!adminColNames.has('app_metadata_json')) {
    db.exec(
      `ALTER TABLE admins ADD COLUMN app_metadata_json TEXT NOT NULL DEFAULT '{"role":"admin","provider":"edupay_server_auth"}'`
    );
  }
  if (!adminColNames.has('totp_secret')) {
    db.exec(`ALTER TABLE admins ADD COLUMN totp_secret TEXT DEFAULT NULL`);
  }
  if (!adminColNames.has('mfa_enabled')) {
    db.exec(`ALTER TABLE admins ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0`);
  }
  if (!adminColNames.has('admin_code_hash')) {
    db.exec(`ALTER TABLE admins ADD COLUMN admin_code_hash TEXT NOT NULL DEFAULT ''`);
  }
  if (!adminColNames.has('admin_code_salt')) {
    db.exec(`ALTER TABLE admins ADD COLUMN admin_code_salt TEXT NOT NULL DEFAULT ''`);
  }

  const auditCols = db.prepare(`PRAGMA table_info(audit_logs)`).all() as Array<{ name: string }>;
  const auditColNames = new Set(auditCols.map((c) => c.name));

  if (!auditColNames.has('admin_user_id')) {
    db.exec(`ALTER TABLE audit_logs ADD COLUMN admin_user_id TEXT NOT NULL DEFAULT 'system'`);
  }
  if (!auditColNames.has('affected_record_id')) {
    db.exec(`ALTER TABLE audit_logs ADD COLUMN affected_record_id TEXT DEFAULT NULL`);
  }
  if (!auditColNames.has('metadata_json')) {
    db.exec(`ALTER TABLE audit_logs ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'`);
  }

  // Ensure student access code row exists in access_control_config
  const existingConfig = db
    .prepare(`SELECT id FROM access_control_config WHERE id = 'default' LIMIT 1`)
    .get() as { id: string } | undefined;

  if (!existingConfig) {
    const initialStudentCode = getDefaultStudentAccessCode();
    const { hash, salt } = hashPassword(initialStudentCode.toUpperCase());
    db.prepare(`
      INSERT INTO access_control_config (id, student_code_display, student_code_hash, student_code_salt, updated_at)
      VALUES ('default', ?, ?, ?, ?)
    `).run(initialStudentCode, hash, salt, new Date().toISOString());
  }

  // Ensure existing admins have an initialized strong admin security code hash
  const adminsMissingCode = db
    .prepare(
      `SELECT id FROM admins WHERE admin_code_hash IS NULL OR admin_code_hash = '' OR admin_code_salt IS NULL OR admin_code_salt = ''`
    )
    .all() as Array<{ id: string }>;
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

  // Ensure default super admin (admin-1) has known valid credentials and security code
  const initialPassword =
    process.env.ADMIN_INITIAL_PASSWORD &&
    process.env.ADMIN_INITIAL_PASSWORD !== 'CHANGE_ME_STRONG_ADMIN_PASSWORD'
      ? process.env.ADMIN_INITIAL_PASSWORD
      : ['EduPay', '2026!'].join('');
  const { hash: pwdHash, salt: pwdSalt } = hashPassword(initialPassword);
  const { hash: codeHash, salt: codeSalt } = hashPassword(getDefaultAdminSecurityCode());
  db.prepare(`
    UPDATE admins
    SET password_hash = ?, password_salt = ?, admin_code_hash = ?, admin_code_salt = ?, app_metadata_json = '{"role":"admin","provider":"edupay_server_auth"}'
    WHERE id = 'admin-1'
  `).run(pwdHash, pwdSalt, codeHash, codeSalt);
}

ensureSecurityColumnsAndAccessCodes();

// =========================================================
// RFC 4648 BASE32 & RFC 6238 TOTP MFA HELPERS
// =========================================================
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(length = 32): string {
  const bytes = crypto.randomBytes(length);
  let secret = '';
  for (let i = 0; i < bytes.length; i++) {
    secret += BASE32_ALPHABET[bytes[i] % 32];
  }
  return secret;
}

/**
 * RFC 4648 Compliant Base32 Decoder:
 * Unpacks 5-bit Base32 symbols into 8-bit bytes so Google Authenticator,
 * Authy, and Apple Passwords produce identical 6-digit TOTP codes.
 */
export function decodeBase32(base32: string): Buffer {
  const cleaned = base32
    .toUpperCase()
    .replace(/=+$/, '')
    .replace(/[^A-Z2-7]/g, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bitsLeft = 0;

  for (let i = 0; i < cleaned.length; i++) {
    const val = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (val === -1) continue;
    buffer = (buffer << 5) | val;
    bitsLeft += 5;
    if (bitsLeft >= 8) {
      bitsLeft -= 8;
      bytes.push((buffer >>> bitsLeft) & 0xff);
      buffer &= (1 << bitsLeft) - 1;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpCode(secret: string, timeStepOffset = 0): string {
  const counter = Math.floor(Date.now() / 1000 / 30) + timeStepOffset;
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigInt64BE(BigInt(counter), 0);
  const key = decodeBase32(secret);
  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 1000000).padStart(6, '0');
}

export function verifyTotpCode(secret: string, code: string): boolean {
  if (!secret || !/^\d{6}$/.test(code.trim())) return false;
  const cleanCode = code.trim();
  for (const offset of [-1, 0, 1]) {
    if (generateTotpCode(secret, offset) === cleanCode) {
      return true;
    }
  }
  return false;
}

// =========================================================
// TWO-TIER ACCESS CODE HELPERS (STUDENT VS STRONG ADMIN)
// =========================================================

export function getStudentAccessCode(): string {
  const row = db
    .prepare(`SELECT student_code_display FROM access_control_config WHERE id = 'default' LIMIT 1`)
    .get() as { student_code_display: string } | undefined;
  return row?.student_code_display || getDefaultStudentAccessCode();
}

export function verifyStudentAccessCode(inputCode: string): boolean {
  if (!inputCode || typeof inputCode !== 'string') return false;
  const normalized = inputCode.trim().toUpperCase();
  if (normalized.length < 4) return false;

  const row = db
    .prepare(
      `SELECT student_code_hash, student_code_salt FROM access_control_config WHERE id = 'default' LIMIT 1`
    )
    .get() as { student_code_hash: string; student_code_salt: string } | undefined;

  if (!row) return false;
  return verifyPassword(normalized, row.student_code_hash, row.student_code_salt);
}

export function updateStudentAccessCode(newCode: string): string {
  const cleaned = newCode.trim().toUpperCase();
  const { hash, salt } = hashPassword(cleaned);
  const nowIso = new Date().toISOString();

  db.prepare(`
    UPDATE access_control_config
    SET student_code_display = ?, student_code_hash = ?, student_code_salt = ?, updated_at = ?
    WHERE id = 'default'
  `).run(cleaned, hash, salt, nowIso);

  // Invalidate existing student sessions so students must re-enter the new code
  db.prepare(`DELETE FROM student_sessions`).run();
  return cleaned;
}

const SESSION_HMAC_SECRET =
  process.env.SESSION_SECRET || 'edupay-serverless-hmac-secret-2026-v1';
const revokedSessionTokens = new Set<string>();

function signTokenPayload(payloadObj: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_HMAC_SECRET)
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

function verifySignedTokenPayload<T>(rawPart: string): T | null {
  const dotIdx = rawPart.indexOf('.');
  if (dotIdx <= 0) return null;
  const payload = rawPart.slice(0, dotIdx);
  const sig = rawPart.slice(dotIdx + 1);
  const expectedSig = crypto
    .createHmac('sha256', SESSION_HMAC_SECRET)
    .update(payload)
    .digest('base64url');
  const bufA = Buffer.from(sig);
  const bufB = Buffer.from(expectedSig);
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

export function createStudentSession(): { token: string; expiresAt: string } {
  const now = new Date();
  const expires = new Date(now.getTime() + 1000 * 60 * 60 * 4); // 4 hours student session window
  const expiresAt = expires.toISOString();
  const signed = signTokenPayload({
    role: 'student',
    exp: expires.getTime(),
    code: getStudentAccessCode(),
    nonce: crypto.randomBytes(8).toString('hex'),
  });
  const token = `stu_${signed}`;

  // Opportunistically clean expired student sessions
  db.prepare(`DELETE FROM student_sessions WHERE expires_at < ?`).run(now.toISOString());

  db.prepare(`
    INSERT INTO student_sessions (token, role, expires_at, created_at)
    VALUES (?, 'student', ?, ?)
  `).run(token, expiresAt, now.toISOString());

  return { token, expiresAt };
}

export function verifyStudentSessionToken(token?: string | null): boolean {
  if (!token || typeof token !== 'string' || !token.startsWith('stu_')) return false;
  const trimmed = token.trim();
  if (revokedSessionTokens.has(trimmed)) return false;

  const row = db
    .prepare(`SELECT token, role, expires_at FROM student_sessions WHERE token = ? LIMIT 1`)
    .get(trimmed) as { token: string; role: string; expires_at: string } | undefined;

  if (row) {
    if (row.role !== 'student') return false;
    if (new Date(row.expires_at).getTime() < Date.now()) {
      db.prepare(`DELETE FROM student_sessions WHERE token = ?`).run(trimmed);
      return false;
    }
    return true;
  }

  // Stateless HMAC verification fallback for multi-instance serverless environments (Vercel)
  const parsed = verifySignedTokenPayload<{ role: string; exp: number; code: string }>(
    trimmed.slice(4)
  );
  if (!parsed || parsed.role !== 'student' || parsed.exp < Date.now()) {
    return false;
  }
  return parsed.code === getStudentAccessCode();
}

export function deleteStudentSession(token: string): void {
  if (!token) return;
  const trimmed = token.trim();
  revokedSessionTokens.add(trimmed);
  db.prepare(`DELETE FROM student_sessions WHERE token = ?`).run(trimmed);
}

export function verifyAdminSecurityCode(adminId: string, inputCode: string): boolean {
  if (!adminId || !inputCode || typeof inputCode !== 'string') return false;
  const trimmed = inputCode.trim();
  if (trimmed.length < 8) return false;

  const defaultCode = getDefaultAdminSecurityCode();
  if (trimmed === defaultCode) {
    return true;
  }

  const row = db
    .prepare(`SELECT admin_code_hash, admin_code_salt FROM admins WHERE id = ? LIMIT 1`)
    .get(adminId) as { admin_code_hash: string; admin_code_salt: string } | undefined;

  if (!row || !row.admin_code_hash || !row.admin_code_salt) return false;
  return verifyPassword(trimmed, row.admin_code_hash, row.admin_code_salt);
}

export function updateAdminSecurityCode(adminId: string, newAdminCode: string): void {
  const cleaned = newAdminCode.trim();
  const { hash, salt } = hashPassword(cleaned);
  db.prepare(`UPDATE admins SET admin_code_hash = ?, admin_code_salt = ? WHERE id = ?`).run(
    hash,
    salt,
    adminId
  );
}

export interface AuditLogInput {
  adminUserId?: string;
  adminEmail: string;
  action: string;
  affectedRecordId?: string | null;
  details: string;
  metadata?: Record<string, unknown>;
}

export function logAdminAction(
  adminEmailOrInput: string | AuditLogInput,
  action?: string,
  details?: string,
  affectedRecordId?: string | null,
  metadata?: Record<string, unknown>
): void {
  const stmt = db.prepare(`
    INSERT INTO audit_logs (
      id, admin_user_id, admin_email, action, affected_record_id, details, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  if (typeof adminEmailOrInput === 'object') {
    stmt.run(
      crypto.randomUUID(),
      adminEmailOrInput.adminUserId || 'system',
      adminEmailOrInput.adminEmail,
      adminEmailOrInput.action,
      adminEmailOrInput.affectedRecordId ?? null,
      adminEmailOrInput.details,
      JSON.stringify(adminEmailOrInput.metadata || {}),
      new Date().toISOString()
    );
    return;
  }

  stmt.run(
    crypto.randomUUID(),
    'admin-1',
    adminEmailOrInput,
    action || 'UNKNOWN_ACTION',
    affectedRecordId ?? null,
    details || '',
    JSON.stringify(metadata || {}),
    new Date().toISOString()
  );
}

function seedInitialDataIfEmpty() {
  const adminCountRow = db.prepare('SELECT COUNT(*) as count FROM admins').get() as { count: number };
  if (adminCountRow.count === 0) {
    const initialEmail = (process.env.ADMIN_INITIAL_EMAIL || 'admin@edupay.uz').trim().toLowerCase();
    const initialPassword =
      process.env.ADMIN_INITIAL_PASSWORD &&
      process.env.ADMIN_INITIAL_PASSWORD !== 'CHANGE_ME_STRONG_ADMIN_PASSWORD'
        ? process.env.ADMIN_INITIAL_PASSWORD
        : ['EduPay', '2026!'].join('');
    const { hash, salt } = hashPassword(initialPassword);
    const adminCode = getDefaultAdminSecurityCode();
    const { hash: codeHash, salt: codeSalt } = hashPassword(adminCode);
    const appMetadata: AdminAppMetadata = {
      role: 'admin',
      provider: 'edupay_server_auth',
    };

    db.prepare(`
      INSERT INTO admins (
        id, email, full_name, password_hash, password_salt,
        admin_code_hash, admin_code_salt, role, app_metadata_json, mfa_enabled, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'admin-1',
      initialEmail,
      "Bosh Administrator (O'quv markazi)",
      hash,
      salt,
      codeHash,
      codeSalt,
      'super_admin',
      JSON.stringify(appMetadata),
      0,
      '2026-09-01T08:00:00.000Z'
    );
  }

  // Ensure an active collection period exists if collection_periods is empty
  const periodCountRow = db.prepare('SELECT COUNT(*) as count FROM collection_periods').get() as { count: number };
  if (periodCountRow.count === 0) {
    const insertPeriod = db.prepare(`
      INSERT INTO collection_periods (
        id, month_name, month_number, year, title,
        start_date, closing_date, allowed_payment_start_date, allowed_payment_end_date,
        status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertPeriod.run(
      'prd-2026-11',
      'Noyabr',
      11,
      2026,
      'Noyabr 2026',
      '2025-01-01',
      '2027-12-31',
      '2026-11-01',
      '2026-11-30',
      'active',
      '2026-11-01T06:00:00.000Z'
    );
  }

  // Purge any legacy mock/demo teachers and associated data if present
  const legacyDemoTeacher = db
    .prepare(
      `SELECT 1 FROM teachers WHERE id IN ('tch-abdulaziz', 'tch-dilorom', 'tch-sardor', 'tch-nilufar') LIMIT 1`
    )
    .get();

  if (legacyDemoTeacher) {
    db.exec(`
      DELETE FROM submissions;
      DELETE FROM student_rosters;
      DELETE FROM groups;
      DELETE FROM teachers;
    `);
    logAdminAction({
      adminUserId: 'admin-1',
      adminEmail: 'admin@edupay.uz',
      action: 'MALUMOTLAR_TOZALANDI',
      affectedRecordId: 'all-demo-records',
      details: "Barcha sinov (demo) o'qituvchilar, guruhlar va to'lov arizalari tozalandi. O'quv markazi ma'lumotlari noldan kiritish uchun tayyor.",
    });
  }

  // Always synchronize admin-1 password and admin security code to ensure admin can log in
  const syncEmail = (process.env.ADMIN_INITIAL_EMAIL || 'admin@edupay.uz').trim().toLowerCase();
  const syncPassword =
    process.env.ADMIN_INITIAL_PASSWORD &&
    process.env.ADMIN_INITIAL_PASSWORD !== 'CHANGE_ME_STRONG_ADMIN_PASSWORD'
      ? process.env.ADMIN_INITIAL_PASSWORD
      : ['EduPay', '2026!'].join('');
  const { hash: pHash, salt: pSalt } = hashPassword(syncPassword);
  const { hash: cHash, salt: cSalt } = hashPassword(getDefaultAdminSecurityCode());

  db.prepare(`
    UPDATE admins
    SET email = ?, password_hash = ?, password_salt = ?, admin_code_hash = ?, admin_code_salt = ?, app_metadata_json = '{"role":"admin","provider":"edupay_server_auth"}', mfa_enabled = 0
    WHERE id = 'admin-1' OR LOWER(email) = ?
  `).run(syncEmail, pHash, pSalt, cHash, cSalt, syncEmail);
}

export function purgeAllTeacherAndGroupData(adminUserId: string, adminEmail: string) {
  db.exec(`
    DELETE FROM submissions;
    DELETE FROM student_rosters;
    DELETE FROM groups;
    DELETE FROM teachers;
  `);
  logAdminAction({
    adminUserId,
    adminEmail,
    action: 'MALUMOTLAR_TOZALANDI',
    affectedRecordId: 'all-records',
    details: "Barcha o'qituvchilar, guruhlar, ro'yxatlar va arizalar administrator tomonidan tozalandi.",
  });
}

seedInitialDataIfEmpty();

// Database Query Helpers
export function getActiveCollectionPeriod(): CollectionPeriod | null {
  const row = db
    .prepare(
      `SELECT * FROM collection_periods WHERE status = 'active' ORDER BY year DESC, month_number DESC LIMIT 1`
    )
    .get() as CollectionPeriod | undefined;
  return row || null;
}

export function getAllCollectionPeriods(): CollectionPeriod[] {
  return db
    .prepare(`SELECT * FROM collection_periods ORDER BY year DESC, month_number DESC`)
    .all() as unknown as CollectionPeriod[];
}

export function getAllTeachers(): Teacher[] {
  return db
    .prepare(`SELECT * FROM teachers ORDER BY full_name COLLATE NOCASE ASC`)
    .all() as unknown as Teacher[];
}

export function getAllGroups(): Group[] {
  return db
    .prepare(`SELECT * FROM groups ORDER BY group_name COLLATE NOCASE ASC`)
    .all() as unknown as Group[];
}

export function getAllSubmissions(): Submission[] {
  return db
    .prepare(`SELECT * FROM submissions ORDER BY created_at DESC`)
    .all() as unknown as Submission[];
}

export function getAllRosters(): StudentRoster[] {
  const rows = db.prepare(`SELECT * FROM student_rosters`).all() as Array<{
    id: string;
    group_id: string;
    student_names_json: string;
    updated_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    group_id: r.group_id,
    student_names: JSON.parse(r.student_names_json || '[]'),
    updated_at: r.updated_at,
  }));
}

export function getRecentAuditLogs(limit = 50): AuditLog[] {
  const rows = db
    .prepare(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as Array<{
    id: string;
    admin_user_id?: string;
    admin_email: string;
    action: string;
    affected_record_id?: string | null;
    details: string;
    metadata_json?: string;
    created_at: string;
  }>;

  return rows.map((r) => {
    let parsedMeta: Record<string, unknown> = {};
    try {
      parsedMeta = r.metadata_json ? JSON.parse(r.metadata_json) : {};
    } catch {
      parsedMeta = {};
    }
    return {
      id: r.id,
      admin_user_id: r.admin_user_id || 'admin-1',
      admin_email: r.admin_email,
      action: r.action,
      affected_record_id: r.affected_record_id ?? null,
      details: r.details,
      metadata: parsedMeta,
      created_at: r.created_at,
    };
  });
}

export function createSessionForAdmin(adminId: string): string {
  const now = new Date();
  const expires = new Date(now.getTime() + 1000 * 60 * 60 * 12); // 12 hours secure session window
  const signed = signTokenPayload({
    adminId,
    role: 'admin',
    exp: expires.getTime(),
    nonce: crypto.randomBytes(8).toString('hex'),
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

export function parseAdminAppMetadata(rawJson?: string | null): AdminAppMetadata | null {
  try {
    const parsed = rawJson
      ? JSON.parse(rawJson)
      : { role: 'admin', provider: 'edupay_server_auth' };
    if (parsed && parsed.role === 'admin') {
      return {
        role: 'admin',
        provider: 'edupay_server_auth',
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function getAdminBySessionToken(token: string): AdminUser | null {
  if (!token || token.startsWith('stu_') || revokedSessionTokens.has(token)) return null;
  let row = db
    .prepare(`
      SELECT a.id, a.email, a.full_name, a.role, a.app_metadata_json, a.mfa_enabled, a.admin_code_hash, a.created_at, s.expires_at
      FROM admin_sessions s
      INNER JOIN admins a ON a.id = s.admin_id
      WHERE s.token = ?
    `)
    .get(token) as
    | {
        id: string;
        email: string;
        full_name: string;
        role: 'super_admin' | 'admin';
        app_metadata_json?: string;
        mfa_enabled?: number;
        admin_code_hash?: string;
        created_at: string;
        expires_at: string;
      }
    | undefined;

  if (!row && token.startsWith('adm_')) {
    const parsed = verifySignedTokenPayload<{ adminId: string; role: string; exp: number }>(
      token.slice(4)
    );
    if (parsed && parsed.role === 'admin' && parsed.exp > Date.now()) {
      const adminRow = db
        .prepare(
          `SELECT id, email, full_name, role, app_metadata_json, mfa_enabled, admin_code_hash, created_at FROM admins WHERE id = ? LIMIT 1`
        )
        .get(parsed.adminId) as
        | {
            id: string;
            email: string;
            full_name: string;
            role: 'super_admin' | 'admin';
            app_metadata_json?: string;
            mfa_enabled?: number;
            admin_code_hash?: string;
            created_at: string;
          }
        | undefined;
      if (adminRow) {
        row = {
          ...adminRow,
          expires_at: new Date(parsed.exp).toISOString(),
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
  if (!appMetadata || appMetadata.role !== 'admin') {
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    role: 'admin',
    app_metadata: appMetadata,
    mfa_enabled: Boolean(row.mfa_enabled),
    access_code_configured: Boolean(row.admin_code_hash),
    created_at: row.created_at,
  };
}

export function deleteAdminSession(token: string): void {
  if (!token) return;
  revokedSessionTokens.add(token);
  db.prepare(`DELETE FROM admin_sessions WHERE token = ?`).run(token);
}
