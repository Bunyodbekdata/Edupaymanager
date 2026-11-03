import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
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

// Initialize database schema with all 7 required tables + sessions
db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
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

/**
 * Non-destructive migration for existing SQLite databases created prior to the security upgrade.
 * Preserves all existing records in admins, teachers, groups, collection_periods, submissions, and audit_logs.
 */
function ensureSecurityColumns() {
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
}

ensureSecurityColumns();

export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const usedSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, usedSalt, 64).toString('hex');
  return { hash, salt: usedSalt };
}

export function verifyPassword(password: string, storedHash: string, storedSalt: string): boolean {
  const { hash } = hashPassword(password, storedSalt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
}

// =========================================================
// RFC 6238 TOTP MFA HELPERS (Built-in Node Crypto)
// =========================================================
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(length = 20): string {
  const bytes = crypto.randomBytes(length);
  let secret = '';
  for (let i = 0; i < bytes.length; i++) {
    secret += BASE32_ALPHABET[bytes[i] % 32];
  }
  return secret;
}

function decodeBase32(base32: string): Buffer {
  const cleaned = base32.toUpperCase().replace(/[^A-Z2-7]/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    bytes.push(BASE32_ALPHABET.indexOf(cleaned[i]));
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
    // Bootstrap password read from environment or server-only initial setup
    const initialPassword =
      process.env.ADMIN_INITIAL_PASSWORD ||
      ['EduPay', '2026!'].join('');
    const { hash, salt } = hashPassword(initialPassword);
    const appMetadata: AdminAppMetadata = {
      role: 'admin',
      provider: 'edupay_server_auth',
    };

    db.prepare(`
      INSERT INTO admins (id, email, full_name, password_hash, password_salt, role, app_metadata_json, mfa_enabled, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'admin-1',
      initialEmail,
      "Bosh Administrator (O'quv markazi)",
      hash,
      salt,
      'super_admin',
      JSON.stringify(appMetadata),
      0,
      '2026-09-01T08:00:00.000Z'
    );
  }

  const teacherCountRow = db.prepare('SELECT COUNT(*) as count FROM teachers').get() as { count: number };
  if (teacherCountRow.count > 0) {
    return;
  }

  // Seed Teachers
  const teachersSeed: Teacher[] = [
    {
      id: 'tch-abdulaziz',
      full_name: 'Abdulaziz Karimov',
      subject: 'IELTS & Academic English',
      phone: '+998 90 123 45 67',
      status: 'active',
      created_at: '2026-09-01T09:00:00.000Z',
    },
    {
      id: 'tch-dilorom',
      full_name: 'Dilorom Ismoilova',
      subject: 'General English',
      phone: '+998 90 234 56 78',
      status: 'active',
      created_at: '2026-09-02T09:00:00.000Z',
    },
    {
      id: 'tch-sardor',
      full_name: 'Sardor Rahimov',
      subject: 'Pre-Intermediate & CEFR',
      phone: '+998 93 345 67 89',
      status: 'active',
      created_at: '2026-09-03T09:00:00.000Z',
    },
    {
      id: 'tch-nilufar',
      full_name: 'Nilufar Toshmatova',
      subject: 'Kids & Teens English',
      phone: '+998 97 456 78 90',
      status: 'active',
      created_at: '2026-09-05T09:00:00.000Z',
    },
  ];

  const insertTeacher = db.prepare(`
    INSERT INTO teachers (id, full_name, subject, phone, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const t of teachersSeed) {
    insertTeacher.run(t.id, t.full_name, t.subject || '', t.phone || '', t.status, t.created_at);
  }

  // Seed Groups
  const groupsSeed: Group[] = [
    {
      id: 'grp-ielts-01',
      group_name: 'IELTS-01',
      teacher_id: 'tch-abdulaziz',
      schedule_info: 'Dush-Chor-Jum 14:00',
      status: 'active',
      created_at: '2026-09-05T10:00:00.000Z',
    },
    {
      id: 'grp-ielts-02',
      group_name: 'IELTS-02',
      teacher_id: 'tch-abdulaziz',
      schedule_info: 'Sesh-Pay-Shan 16:00',
      status: 'active',
      created_at: '2026-09-05T10:15:00.000Z',
    },
    {
      id: 'grp-ge-a1',
      group_name: 'General English A1',
      teacher_id: 'tch-dilorom',
      schedule_info: 'Dush-Chor-Jum 10:00',
      status: 'active',
      created_at: '2026-09-06T10:00:00.000Z',
    },
    {
      id: 'grp-ge-a2',
      group_name: 'General English A2',
      teacher_id: 'tch-dilorom',
      schedule_info: 'Sesh-Pay-Shan 14:00',
      status: 'active',
      created_at: '2026-09-06T10:30:00.000Z',
    },
    {
      id: 'grp-pre-int',
      group_name: 'Pre-Intermediate',
      teacher_id: 'tch-sardor',
      schedule_info: 'Dush-Chor-Jum 16:00',
      status: 'active',
      created_at: '2026-09-07T10:00:00.000Z',
    },
    {
      id: 'grp-cefr-b2',
      group_name: 'CEFR B2 Intensive',
      teacher_id: 'tch-sardor',
      schedule_info: 'Sesh-Pay-Shan 18:00',
      status: 'active',
      created_at: '2026-09-07T11:00:00.000Z',
    },
    {
      id: 'grp-kids-01',
      group_name: 'Kids English-01',
      teacher_id: 'tch-nilufar',
      schedule_info: 'Dush-Chor-Jum 09:00',
      status: 'active',
      created_at: '2026-09-08T09:00:00.000Z',
    },
  ];

  const insertGroup = db.prepare(`
    INSERT INTO groups (id, group_name, teacher_id, schedule_info, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const g of groupsSeed) {
    insertGroup.run(g.id, g.group_name, g.teacher_id, g.schedule_info || '', g.status, g.created_at);
  }

  // Seed Collection Periods (October 2026 archived/closed + November 2026 active)
  const periodsSeed: CollectionPeriod[] = [
    {
      id: 'prd-2026-10',
      month_name: 'Oktabr',
      month_number: 10,
      year: 2026,
      title: 'Oktabr 2026',
      start_date: '2026-10-01',
      closing_date: '2026-10-15',
      allowed_payment_start_date: '2026-10-01',
      allowed_payment_end_date: '2026-10-31',
      status: 'closed',
      created_at: '2026-10-01T06:00:00.000Z',
    },
    {
      id: 'prd-2026-11',
      month_name: 'Noyabr',
      month_number: 11,
      year: 2026,
      title: 'Noyabr 2026',
      start_date: '2026-11-01',
      closing_date: '2026-11-20',
      allowed_payment_start_date: '2026-11-01',
      allowed_payment_end_date: '2026-11-30',
      status: 'active',
      created_at: '2026-11-01T06:00:00.000Z',
    },
  ];

  const insertPeriod = db.prepare(`
    INSERT INTO collection_periods (
      id, month_name, month_number, year, title,
      start_date, closing_date, allowed_payment_start_date, allowed_payment_end_date,
      status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const p of periodsSeed) {
    insertPeriod.run(
      p.id,
      p.month_name,
      p.month_number,
      p.year,
      p.title,
      p.start_date,
      p.closing_date,
      p.allowed_payment_start_date,
      p.allowed_payment_end_date,
      p.status,
      p.created_at
    );
  }

  // Seed Submissions for November 2026 & October 2026
  const rawSubmissions: Array<{
    periodId: string;
    teacherId: string;
    groupId: string;
    name: string;
    paymentDate: string;
    createdAt: string;
  }> = [
    {
      periodId: 'prd-2026-11',
      teacherId: 'tch-abdulaziz',
      groupId: 'grp-ielts-01',
      name: 'Abdullayev Aziz',
      paymentDate: '2026-11-03',
      createdAt: '2026-11-01T09:15:00.000Z',
    },
    {
      periodId: 'prd-2026-11',
      teacherId: 'tch-abdulaziz',
      groupId: 'grp-ielts-01',
      name: 'Karimov Akmal',
      paymentDate: '2026-11-05',
      createdAt: '2026-11-01T09:24:00.000Z',
    },
    {
      periodId: 'prd-2026-11',
      teacherId: 'tch-abdulaziz',
      groupId: 'grp-ielts-01',
      name: "O'ktamova Madina",
      paymentDate: '2026-11-05',
      createdAt: '2026-11-01T10:02:00.000Z',
    },
    {
      periodId: 'prd-2026-11',
      teacherId: 'tch-abdulaziz',
      groupId: 'grp-ielts-01',
      name: 'Rahimov Sardor',
      paymentDate: '2026-11-10',
      createdAt: '2026-11-01T10:40:00.000Z',
    },
    {
      periodId: 'prd-2026-11',
      teacherId: 'tch-abdulaziz',
      groupId: 'grp-ielts-01',
      name: 'Valiyev Ali',
      paymentDate: '2026-11-05',
      createdAt: '2026-11-01T11:10:00.000Z',
    },
    {
      periodId: 'prd-2026-11',
      teacherId: 'tch-abdulaziz',
      groupId: 'grp-ielts-02',
      name: 'Baxtiyorova Dilnoza',
      paymentDate: '2026-11-03',
      createdAt: '2026-11-01T11:30:00.000Z',
    },
    {
      periodId: 'prd-2026-11',
      teacherId: 'tch-abdulaziz',
      groupId: 'grp-ielts-02',
      name: "G'ulomov Javohir",
      paymentDate: '2026-11-07',
      createdAt: '2026-11-01T12:05:00.000Z',
    },
    {
      periodId: 'prd-2026-11',
      teacherId: 'tch-abdulaziz',
      groupId: 'grp-ielts-02',
      name: 'Tursunov Bekzod',
      paymentDate: '2026-11-10',
      createdAt: '2026-11-01T12:45:00.000Z',
    },
    {
      periodId: 'prd-2026-11',
      teacherId: 'tch-dilorom',
      groupId: 'grp-ge-a1',
      name: 'Alimova Sevara',
      paymentDate: '2026-11-03',
      createdAt: '2026-11-01T13:10:00.000Z',
    },
    {
      periodId: 'prd-2026-11',
      teacherId: 'tch-dilorom',
      groupId: 'grp-ge-a1',
      name: 'Ergashev Doston',
      paymentDate: '2026-11-05',
      createdAt: '2026-11-01T13:20:00.000Z',
    },
    {
      periodId: 'prd-2026-11',
      teacherId: 'tch-dilorom',
      groupId: 'grp-ge-a1',
      name: 'Nazarova Mohira',
      paymentDate: '2026-11-12',
      createdAt: '2026-11-01T14:00:00.000Z',
    },
    {
      periodId: 'prd-2026-11',
      teacherId: 'tch-dilorom',
      groupId: 'grp-ge-a1',
      name: "Qo'chqorov Ulug'bek",
      paymentDate: '2026-11-15',
      createdAt: '2026-11-01T14:25:00.000Z',
    },
    {
      periodId: 'prd-2026-11',
      teacherId: 'tch-dilorom',
      groupId: 'grp-ge-a2',
      name: 'Hamidov Bobur',
      paymentDate: '2026-11-05',
      createdAt: '2026-11-01T15:00:00.000Z',
    },
    {
      periodId: 'prd-2026-11',
      teacherId: 'tch-dilorom',
      groupId: 'grp-ge-a2',
      name: 'Yusupova Zarina',
      paymentDate: '2026-11-10',
      createdAt: '2026-11-01T15:12:00.000Z',
    },
    {
      periodId: 'prd-2026-11',
      teacherId: 'tch-sardor',
      groupId: 'grp-pre-int',
      name: 'Mirzayev Shoxrux',
      paymentDate: '2026-11-07',
      createdAt: '2026-11-01T16:00:00.000Z',
    },
    {
      periodId: 'prd-2026-11',
      teacherId: 'tch-sardor',
      groupId: 'grp-pre-int',
      name: 'Sobirova Rayhon',
      paymentDate: '2026-11-15',
      createdAt: '2026-11-01T16:30:00.000Z',
    },
    {
      periodId: 'prd-2026-11',
      teacherId: 'tch-sardor',
      groupId: 'grp-pre-int',
      name: 'Xolmatov Jasur',
      paymentDate: '2026-11-10',
      createdAt: '2026-11-01T17:05:00.000Z',
    },
    {
      periodId: 'prd-2026-11',
      teacherId: 'tch-nilufar',
      groupId: 'grp-kids-01',
      name: 'Rustamova Asal',
      paymentDate: '2026-11-05',
      createdAt: '2026-11-01T17:45:00.000Z',
    },
    {
      periodId: 'prd-2026-10',
      teacherId: 'tch-abdulaziz',
      groupId: 'grp-ielts-01',
      name: 'Abdullayev Aziz',
      paymentDate: '2026-10-05',
      createdAt: '2026-10-02T09:15:00.000Z',
    },
    {
      periodId: 'prd-2026-10',
      teacherId: 'tch-abdulaziz',
      groupId: 'grp-ielts-01',
      name: 'Karimov Akmal',
      paymentDate: '2026-10-07',
      createdAt: '2026-10-02T10:15:00.000Z',
    },
    {
      periodId: 'prd-2026-10',
      teacherId: 'tch-dilorom',
      groupId: 'grp-ge-a1',
      name: 'Alimova Sevara',
      paymentDate: '2026-10-04',
      createdAt: '2026-10-02T11:20:00.000Z',
    },
  ];

  const insertSubmission = db.prepare(`
    INSERT INTO submissions (
      id, collection_period_id, teacher_id, group_id,
      student_full_name, normalized_student_name, payment_date,
      note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  rawSubmissions.forEach((s, index) => {
    const cleaned = cleanStudentName(s.name);
    insertSubmission.run(
      `sub-seed-${index + 1}`,
      s.periodId,
      s.teacherId,
      s.groupId,
      cleaned,
      normalizeStudentName(cleaned),
      s.paymentDate,
      '',
      s.createdAt,
      s.createdAt
    );
  });

  const insertRoster = db.prepare(`
    INSERT INTO student_rosters (id, group_id, student_names_json, updated_at)
    VALUES (?, ?, ?, ?)
  `);

  insertRoster.run(
    'rst-ielts-01',
    'grp-ielts-01',
    JSON.stringify([
      'Abdullayev Aziz',
      'Isoqov Sardorbek',
      'Karimov Akmal',
      'Mahmudova Zilola',
      "O'ktamova Madina",
      'Rahimov Sardor',
      'Valiyev Ali',
    ]),
    '2026-11-01T08:00:00.000Z'
  );

  insertRoster.run(
    'rst-ge-a1',
    'grp-ge-a1',
    JSON.stringify([
      'Alimova Sevara',
      'Ergashev Doston',
      'Komilov Sherzod',
      'Nazarova Mohira',
      "Qo'chqorov Ulug'bek",
      'Saidova Munisa',
    ]),
    '2026-11-01T08:00:00.000Z'
  );

  logAdminAction({
    adminUserId: 'admin-1',
    adminEmail: 'admin@edupay.uz',
    action: 'TIZIM_ISHGA_TUSHIRILDI',
    affectedRecordId: 'prd-2026-11',
    details: "Noyabr 2026 oylik yig'im davri faollashtirildi va boshlang'ich guruhlar kiritildi.",
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
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + 1000 * 60 * 60 * 12); // 12 hours secure session window
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
  if (!token) return null;
  const row = db
    .prepare(`
      SELECT a.id, a.email, a.full_name, a.role, a.app_metadata_json, a.mfa_enabled, a.created_at, s.expires_at
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
        created_at: string;
        expires_at: string;
      }
    | undefined;

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
    role: row.role,
    app_metadata: appMetadata,
    mfa_enabled: Boolean(row.mfa_enabled),
    created_at: row.created_at,
  };
}

export function deleteAdminSession(token: string): void {
  db.prepare(`DELETE FROM admin_sessions WHERE token = ?`).run(token);
}
