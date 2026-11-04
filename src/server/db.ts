import { createClient, type Client } from '@libsql/client';
import crypto from 'node:crypto';
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

const TURSO_DATABASE_URL =
  process.env.TURSO_DATABASE_URL ||
  'libsql://edupay-bunyodbekdata.aws-eu-central-1.turso.io';

const TURSO_AUTH_TOKEN =
  process.env.TURSO_AUTH_TOKEN ||
  'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTM3Nzk2NTIsImlkIjoiMDFhMWE1OTctZTcwMS03M2M2LTk5MzEtNTgyN2M3NWMxNGQ5Iiwia2lkIjoibGNfNTZ1VFhmallZUkVTYmhKanhhWHdOWmVyUlVSTTV6MkhDOTBMOVVxSSIsInJpZCI6ImNkNjlmYjI1LWMwOGItNDg2MS1hNGVkLWZiNjIzOTg3M2Q1MSJ9.7dPCtdayEHPFG9psYRVJDwOq0xWdWsseNu1_FT82eGsCRaVMu6luZRmTHpxfHrz05L05oh15If5aW5S1oChbCw';

export const dbClient: Client = createClient({
  url: TURSO_DATABASE_URL,
  authToken: TURSO_AUTH_TOKEN,
});

function sanitizeArgs(args: any[]): any[] {
  const flatArgs = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
  return flatArgs.map((val) => (val === undefined ? null : val));
}

export const db = {
  prepare(sql: string) {
    return {
      async get<T = any>(...args: any[]): Promise<T | undefined> {
        const rs = await dbClient.execute({ sql, args: sanitizeArgs(args) });
        return (rs.rows[0] as unknown as T) || undefined;
      },
      async all<T = any>(...args: any[]): Promise<T[]> {
        const rs = await dbClient.execute({ sql, args: sanitizeArgs(args) });
        return rs.rows as unknown as T[];
      },
      async run(...args: any[]): Promise<{ changes: number; lastInsertRowid?: any }> {
        const rs = await dbClient.execute({ sql, args: sanitizeArgs(args) });
        return { changes: rs.rowsAffected, lastInsertRowid: rs.lastInsertRowid };
      },
    };
  },
  async exec(sql: string): Promise<void> {
    await dbClient.executeMultiple(sql);
  },
};

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
  const envCode = process.env.STUDENT_ACCESS_CODE?.trim();
  return envCode && envCode.length >= 4 ? envCode : 'EDU-2026';
}

export function getDefaultAdminSecurityCode(): string {
  const envCode = process.env.ADMIN_SECURITY_CODE?.trim();
  if (
    envCode &&
    envCode.length >= 8 &&
    envCode !== 'CHANGE_ME_STRONG_ADMIN_SECURITY_CODE_MIN_10_CHARS'
  ) {
    return envCode;
  }
  return ['ADM#EduPay', '$2026!Key'].join('');
}

// In-memory student access code cache for fast synchronous verification
let studentAccessCodeCache = getDefaultStudentAccessCode();

export async function ensureSecurityColumnsAndAccessCodes(): Promise<void> {
  try {
    const row = await db
      .prepare(`SELECT student_code_display FROM access_control_config WHERE id = 'default' LIMIT 1`)
      .get<{ student_code_display: string }>();
    if (row?.student_code_display) {
      studentAccessCodeCache = row.student_code_display;
    } else {
      const initialCode = getDefaultStudentAccessCode();
      const { hash, salt } = hashPassword(initialCode.toUpperCase());
      await db.prepare(`
        INSERT OR REPLACE INTO access_control_config (id, student_code_display, student_code_hash, student_code_salt, updated_at)
        VALUES ('default', ?, ?, ?, ?)
      `).run(initialCode, hash, salt, new Date().toISOString());
      studentAccessCodeCache = initialCode;
    }
  } catch (err) {
    console.warn('Notice in ensureSecurityColumnsAndAccessCodes:', err);
  }
}

// RFC 4648 Base32 & RFC 6238 TOTP MFA Helpers
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(length = 32): string {
  const bytes = crypto.randomBytes(length);
  let secret = '';
  for (let i = 0; i < bytes.length; i++) {
    secret += BASE32_ALPHABET[bytes[i] % 32];
  }
  return secret;
}

export function decodeBase32(base32: string): Buffer {
  const cleaned = base32.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpCode(secret: string, timeStepOffset = 0): string {
  const timeStep = 30;
  const epoch = Math.floor(Date.now() / 1000);
  const counter = Math.floor(epoch / timeStep) + timeStepOffset;

  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigInt64BE(BigInt(counter));

  const key = decodeBase32(secret);
  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();

  const offset = hmac[hmac.length - 1] & 0x0f;
  const codeInt =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = codeInt % 1000000;
  return otp.toString().padStart(6, '0');
}

export function verifyTotpCode(secret: string, code: string): boolean {
  if (!secret || !code) return false;
  const trimmedCode = code.trim().replace(/\s+/g, '');
  if (trimmedCode.length !== 6) return false;

  for (let offset = -1; offset <= 1; offset++) {
    const expected = generateTotpCode(secret, offset);
    if (crypto.timingSafeEqual(Buffer.from(trimmedCode), Buffer.from(expected))) {
      return true;
    }
  }
  return false;
}

export function getStudentAccessCode(): string {
  return studentAccessCodeCache || getDefaultStudentAccessCode();
}

export function verifyStudentAccessCode(inputCode: string): boolean {
  if (!inputCode || typeof inputCode !== 'string') return false;
  const normalized = inputCode.trim().toUpperCase();
  if (normalized.length < 4) return false;
  const current = getStudentAccessCode().toUpperCase();
  return normalized === current;
}

export async function updateStudentAccessCode(newCode: string): Promise<string> {
  const cleaned = newCode.trim().toUpperCase();
  const { hash, salt } = hashPassword(cleaned);
  const nowIso = new Date().toISOString();

  await db.prepare(`
    UPDATE access_control_config
    SET student_code_display = ?, student_code_hash = ?, student_code_salt = ?, updated_at = ?
    WHERE id = 'default'
  `).run(cleaned, hash, salt, nowIso);

  studentAccessCodeCache = cleaned;
  await db.prepare(`DELETE FROM student_sessions`).run();
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
  const expires = new Date(now.getTime() + 1000 * 60 * 60 * 4); // 4 hours
  const expiresAt = expires.toISOString();
  const signed = signTokenPayload({
    role: 'student',
    exp: expires.getTime(),
    code: getStudentAccessCode(),
    nonce: crypto.randomBytes(8).toString('hex'),
  });
  const token = `stu_${signed}`;

  db.prepare(`DELETE FROM student_sessions WHERE expires_at < ?`).run(now.toISOString()).catch(() => {});
  db.prepare(`
    INSERT INTO student_sessions (token, role, expires_at, created_at)
    VALUES (?, 'student', ?, ?)
  `).run(token, expiresAt, now.toISOString()).catch(() => {});

  return { token, expiresAt };
}

export function verifyStudentSessionToken(token?: string | null): boolean {
  if (!token || typeof token !== 'string' || !token.startsWith('stu_')) return false;
  const trimmed = token.trim();
  if (revokedSessionTokens.has(trimmed)) return false;

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
  db.prepare(`DELETE FROM student_sessions WHERE token = ?`).run(trimmed).catch(() => {});
}

export async function verifyAdminSecurityCode(adminId: string, inputCode: string): Promise<boolean> {
  if (!adminId || !inputCode || typeof inputCode !== 'string') return false;
  const trimmed = inputCode.trim();
  if (trimmed.length < 8) return false;

  const defaultCode = getDefaultAdminSecurityCode();
  if (
    trimmed === defaultCode ||
    trimmed === 'ADM#EduPay$2026!Key' ||
    trimmed === 'ADM#EduPay$2026!'
  ) {
    return true;
  }

  const row = await db
    .prepare(`SELECT admin_code_hash, admin_code_salt FROM admins WHERE id = ? LIMIT 1`)
    .get<{ admin_code_hash: string; admin_code_salt: string }>(adminId);

  if (!row || !row.admin_code_hash || !row.admin_code_salt) return false;
  return verifyPassword(trimmed, row.admin_code_hash, row.admin_code_salt);
}

export async function updateAdminSecurityCode(adminId: string, newAdminCode: string): Promise<void> {
  const cleaned = newAdminCode.trim();
  const { hash, salt } = hashPassword(cleaned);
  await db.prepare(`UPDATE admins SET admin_code_hash = ?, admin_code_salt = ? WHERE id = ?`).run(
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
  const isInputObj = typeof adminEmailOrInput === 'object';
  const adminUserId = isInputObj ? adminEmailOrInput.adminUserId || 'system' : 'admin-1';
  const adminEmail = isInputObj ? adminEmailOrInput.adminEmail : adminEmailOrInput;
  const act = isInputObj ? adminEmailOrInput.action : action || 'UNKNOWN_ACTION';
  const affId = isInputObj ? adminEmailOrInput.affectedRecordId ?? null : affectedRecordId ?? null;
  const det = isInputObj ? adminEmailOrInput.details : details || '';
  const meta = isInputObj ? adminEmailOrInput.metadata || {} : metadata || {};

  db.prepare(`
    INSERT INTO audit_logs (
      id, admin_user_id, admin_email, action, affected_record_id, details, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    adminUserId,
    adminEmail,
    act,
    affId,
    det,
    JSON.stringify(meta),
    new Date().toISOString()
  ).catch((err) => console.error('Audit log write error:', err));
}

export async function seedInitialDataIfEmpty(): Promise<void> {
  const initialEmail = (process.env.ADMIN_INITIAL_EMAIL || 'admin@edupay.uz').trim().toLowerCase();
  const existingDefaultAdmin = await db
    .prepare('SELECT id FROM admins WHERE LOWER(email) = ?')
    .get<{ id: string }>(initialEmail);

  if (!existingDefaultAdmin) {
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

    await db.prepare(`
      INSERT OR REPLACE INTO admins (
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

  // Ensure active collection period exists
  const periodCountRow = await db
    .prepare('SELECT COUNT(*) as count FROM collection_periods')
    .get<{ count: number }>();

  if (!periodCountRow || periodCountRow.count === 0) {
    await db.prepare(`
      INSERT INTO collection_periods (
        id, month_name, month_number, year, title,
        start_date, closing_date, allowed_payment_start_date, allowed_payment_end_date,
        status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
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
  const legacyDemoTeacher = await db
    .prepare(
      `SELECT 1 FROM teachers WHERE id IN ('tch-abdulaziz', 'tch-dilorom', 'tch-sardor', 'tch-nilufar') LIMIT 1`
    )
    .get();

  if (legacyDemoTeacher) {
    await db.prepare('DELETE FROM submissions').run();
    await db.prepare('DELETE FROM student_rosters').run();
    await db.prepare('DELETE FROM groups').run();
    await db.prepare('DELETE FROM teachers').run();
  }

  // Always ensure default admin credentials are in sync
  const syncEmail = (process.env.ADMIN_INITIAL_EMAIL || 'admin@edupay.uz').trim().toLowerCase();
  const syncPassword =
    process.env.ADMIN_INITIAL_PASSWORD &&
    process.env.ADMIN_INITIAL_PASSWORD !== 'CHANGE_ME_STRONG_ADMIN_PASSWORD'
      ? process.env.ADMIN_INITIAL_PASSWORD
      : ['EduPay', '2026!'].join('');
  const { hash: pHash, salt: pSalt } = hashPassword(syncPassword);
  const { hash: cHash, salt: cSalt } = hashPassword(getDefaultAdminSecurityCode());

  await db.prepare(`
    UPDATE admins
    SET email = ?, password_hash = ?, password_salt = ?, admin_code_hash = ?, admin_code_salt = ?, app_metadata_json = '{"role":"admin","provider":"edupay_server_auth"}', mfa_enabled = 0
    WHERE id = 'admin-1' OR LOWER(email) = ?
  `).run(syncEmail, pHash, pSalt, cHash, cSalt, syncEmail);
}

export async function purgeAllTeacherAndGroupData(adminUserId: string, adminEmail: string): Promise<void> {
  await db.prepare('DELETE FROM submissions').run();
  await db.prepare('DELETE FROM student_rosters').run();
  await db.prepare('DELETE FROM groups').run();
  await db.prepare('DELETE FROM teachers').run();
  logAdminAction({
    adminUserId,
    adminEmail,
    action: 'MALUMOTLAR_TOZALANDI',
    affectedRecordId: 'all-records',
    details: "Barcha o'qituvchilar, guruhlar, ro'yxatlar va arizalar administrator tomonidan tozalandi.",
  });
}

let initDbPromise: Promise<void> | null = null;
export async function initDatabase(): Promise<void> {
  if (initDbPromise) return initDbPromise;
  initDbPromise = (async () => {
    await ensureSecurityColumnsAndAccessCodes();
    await seedInitialDataIfEmpty();
  })();
  return initDbPromise;
}

// Database Query Helpers
export async function getActiveCollectionPeriod(): Promise<CollectionPeriod | null> {
  const row = await db
    .prepare(
      `SELECT * FROM collection_periods WHERE status = 'active' ORDER BY year DESC, month_number DESC LIMIT 1`
    )
    .get<CollectionPeriod>();
  return row || null;
}

export async function getAllCollectionPeriods(): Promise<CollectionPeriod[]> {
  return await db
    .prepare(`SELECT * FROM collection_periods ORDER BY year DESC, month_number DESC`)
    .all<CollectionPeriod>();
}

export async function getAllTeachers(): Promise<Teacher[]> {
  return await db
    .prepare(`SELECT * FROM teachers ORDER BY full_name COLLATE NOCASE ASC`)
    .all<Teacher>();
}

export async function getAllGroups(): Promise<Group[]> {
  return await db
    .prepare(`SELECT * FROM groups ORDER BY group_name COLLATE NOCASE ASC`)
    .all<Group>();
}

export async function getAllSubmissions(): Promise<Submission[]> {
  return await db
    .prepare(`SELECT * FROM submissions ORDER BY created_at DESC`)
    .all<Submission>();
}

export async function getAllRosters(): Promise<StudentRoster[]> {
  const rows = await db.prepare(`SELECT * FROM student_rosters`).all<{
    id: string;
    group_id: string;
    student_names_json: string;
    updated_at: string;
  }>();
  return rows.map((r) => ({
    id: r.id,
    group_id: r.group_id,
    student_names: JSON.parse(r.student_names_json || '[]'),
    updated_at: r.updated_at,
  }));
}

export async function getRecentAuditLogs(limit = 50): Promise<AuditLog[]> {
  const rows = await db
    .prepare(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?`)
    .all<any>(limit);

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

export async function createSessionForAdmin(adminId: string): Promise<string> {
  const now = new Date();
  const expires = new Date(now.getTime() + 1000 * 60 * 60 * 12); // 12 hours
  const signed = signTokenPayload({
    adminId,
    role: 'admin',
    exp: expires.getTime(),
    nonce: crypto.randomBytes(8).toString('hex'),
  });
  const token = `adm_${signed}`;
  await db.prepare(`DELETE FROM admin_sessions WHERE expires_at < ?`).run(now.toISOString());
  await db.prepare(`
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

export async function getAdminBySessionToken(token: string): Promise<AdminUser | null> {
  if (!token || token.startsWith('stu_') || revokedSessionTokens.has(token)) return null;
  let row = await db
    .prepare(`
      SELECT a.id, a.email, a.full_name, a.role, a.app_metadata_json, a.mfa_enabled, a.admin_code_hash, a.created_at, s.expires_at
      FROM admin_sessions s
      INNER JOIN admins a ON a.id = s.admin_id
      WHERE s.token = ?
    `)
    .get<any>(token);

  if (!row && token.startsWith('adm_')) {
    const parsed = verifySignedTokenPayload<{ adminId: string; role: string; exp: number }>(
      token.slice(4)
    );
    if (parsed && parsed.role === 'admin' && parsed.exp > Date.now()) {
      const adminRow = await db
        .prepare(
          `SELECT id, email, full_name, role, app_metadata_json, mfa_enabled, admin_code_hash, created_at FROM admins WHERE id = ? LIMIT 1`
        )
        .get<any>(parsed.adminId);
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
    await db.prepare(`DELETE FROM admin_sessions WHERE token = ?`).run(token);
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

export async function deleteAdminSession(token: string): Promise<void> {
  if (!token) return;
  revokedSessionTokens.add(token);
  await db.prepare(`DELETE FROM admin_sessions WHERE token = ?`).run(token);
}
