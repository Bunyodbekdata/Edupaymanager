import express, { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import * as dotenv from 'dotenv';
import { z } from 'zod';
import {
  db,
  initDatabase,
  createSessionForAdmin,
  createStudentSession,
  deleteAdminSession,
  deleteStudentSession,
  generateTotpCode,
  generateTotpSecret,
  getActiveCollectionPeriod,
  getAdminBySessionToken,
  getAllCollectionPeriods,
  getAllGroups,
  getAllRosters,
  getAllSubmissions,
  getAllTeachers,
  purgeAllTeacherAndGroupData,
  getRecentAuditLogs,
  getStudentAccessCode,
  hashPassword,
  logAdminAction,
  parseAdminAppMetadata,
  updateAdminSecurityCode,
  updateStudentAccessCode,
  verifyAdminSecurityCode,
  verifyPassword,
  verifyStudentAccessCode,
  verifyStudentSessionToken,
  verifyTotpCode,
} from './db';
import {
  UZBEK_MONTHS,
  cleanStudentName,
  compareUzbekNames,
  formatDateUz,
  normalizeStudentName,
  validateCollectionPeriodWindow,
  validatePaymentDate,
  validateStrongAdminCode,
  validateStudentAccessCode,
  validateStudentName,
} from '../utils/edupayLogic';
import { generateSubmissionsExcelBuffer } from '../utils/excelExport';
import { verifyAndBootstrapInitialAdmin } from './bootstrapAdmin';
import { AdminUser, CollectionPeriod, Group, Submission, Teacher } from '../types/edupay';

dotenv.config();

interface AuthenticatedRequest extends Request {
  admin?: AdminUser;
  token?: string;
}

// =========================================================
// RATE LIMITING & BRUTE-FORCE PROTECTION (WITH MEMORY CLEANUP)
// =========================================================
const submissionRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const loginRateLimitMap = new Map<string, { failedCount: number; lockUntil: number }>();
const studentCodeRateLimitMap = new Map<string, { failedCount: number; lockUntil: number }>();

export function resetSecurityRateLimits(): void {
  submissionRateLimitMap.clear();
  loginRateLimitMap.clear();
  studentCodeRateLimitMap.clear();
}

function pruneExpiredRateLimits(): void {
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

function checkPublicSubmissionRateLimit(ip: string): boolean {
  pruneExpiredRateLimits();
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  const maxRequests = 40; // Supports classroom bursts while blocking automated floods
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

function getLoginAttemptKey(ip: string, email: string): string {
  return `${ip}::${email.trim().toLowerCase()}`;
}

function isLoginLockedOut(ip: string, email: string): boolean {
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

function recordFailedLoginAttempt(ip: string, email: string): number {
  const key = getLoginAttemptKey(ip, email);
  const current = loginRateLimitMap.get(key) || { failedCount: 0, lockUntil: 0 };
  const nextCount = current.failedCount + 1;
  const lockUntil = nextCount >= 5 ? Date.now() + 15 * 60 * 1000 : 0;
  loginRateLimitMap.set(key, { failedCount: nextCount, lockUntil });
  return nextCount;
}

function clearFailedLoginAttempts(ip: string, email: string): void {
  loginRateLimitMap.delete(getLoginAttemptKey(ip, email));
}

function isStudentCodeLockedOut(ip: string): boolean {
  pruneExpiredRateLimits();
  const entry = studentCodeRateLimitMap.get(ip);
  if (!entry) return false;
  if (entry.lockUntil > Date.now()) return true;
  if (entry.lockUntil !== 0 && entry.lockUntil <= Date.now()) {
    studentCodeRateLimitMap.delete(ip);
  }
  return false;
}

function recordFailedStudentCodeAttempt(ip: string): number {
  const current = studentCodeRateLimitMap.get(ip) || { failedCount: 0, lockUntil: 0 };
  const nextCount = current.failedCount + 1;
  const lockUntil = nextCount >= 10 ? Date.now() + 10 * 60 * 1000 : 0;
  studentCodeRateLimitMap.set(ip, { failedCount: nextCount, lockUntil });
  return nextCount;
}

function clearFailedStudentCodeAttempts(ip: string): void {
  studentCodeRateLimitMap.delete(ip);
}

// =========================================================
// PRIVILEGE ESCALATION & MASS ASSIGNMENT DETECTOR
// =========================================================
const FORBIDDEN_PRIVILEGE_KEYS = new Set([
  'role',
  'app_metadata',
  'user_metadata',
  'isAdmin',
  'is_admin',
  'permissions',
  'admin_id',
  'password_hash',
  'password_salt',
  'admin_code_hash',
  'admin_code_salt',
]);

function containsPrivilegeEscalationAttempt(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_PRIVILEGE_KEYS.has(key)) {
      return key;
    }
  }
  return null;
}

// =========================================================
// STUDENT ACCESS VERIFICATION HELPER
// =========================================================
function hasValidStudentAccess(req: Request): boolean {
  const headerToken =
    typeof req.headers['x-student-token'] === 'string'
      ? req.headers['x-student-token'].trim()
      : '';
  if (headerToken && verifyStudentSessionToken(headerToken)) {
    return true;
  }

  const headerCode =
    typeof req.headers['x-student-code'] === 'string'
      ? req.headers['x-student-code'].trim()
      : '';
  if (headerCode && verifyStudentAccessCode(headerCode)) {
    return true;
  }

  const queryCode =
    typeof req.query.student_code === 'string' ? req.query.student_code.trim() : '';
  if (queryCode && verifyStudentAccessCode(queryCode)) {
    return true;
  }

  const bodyCode =
    req.body && typeof req.body === 'object' && typeof req.body.student_access_code === 'string'
      ? req.body.student_access_code.trim()
      : '';
  if (bodyCode && verifyStudentAccessCode(bodyCode)) {
    return true;
  }

  return false;
}

// =========================================================
// AUTHORITATIVE ADMIN AUTHENTICATION MIDDLEWARE
// Strictly blocks student tokens, student codes, or non-admin users
// =========================================================
async function requireAdminAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined;
  const studentHeaderToken =
    typeof req.headers['x-student-token'] === 'string'
      ? req.headers['x-student-token'].trim()
      : undefined;

  const token =
    authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length).trim()
      : queryToken;

  if (!token) {
    if (studentHeaderToken) {
      logAdminAction({
        adminUserId: 'student',
        adminEmail: 'student@public',
        action: 'STUDENT_ADMIN_CROSSOVER_BLOCKED',
        affectedRecordId: req.originalUrl,
        details: `O'quvchi sessiyasi orqali administrator manziliga o'tish urinishi bloklandi: ${req.method} ${req.originalUrl}`,
        metadata: { ip: req.ip || 'unknown' },
      });
      return res.status(403).json({
        error:
          "Xavfsizlik chegarasi: O'quvchi kirish kodi bilan Administrator paneliga o'tish qat'iyan taqiqlangan!",
      });
    }
    return res.status(401).json({
      error: 'Ruxsat etilmagan: Administrator tizimga kirmagan.',
    });
  }

  // Block any student session token (stu_*), student code, or forged external JWT payload
  if (
    token.startsWith('stu_') ||
    token.startsWith('student-') ||
    token.startsWith('user-') ||
    (!token.startsWith('adm_') && token.includes('.')) ||
    verifyStudentAccessCode(token)
  ) {
    logAdminAction({
      adminUserId: 'anonymous',
      adminEmail: 'unauthorized@public',
      action: 'UNAUTHORIZED_ADMIN_ACCESS_BLOCKED',
      affectedRecordId: req.originalUrl,
      details: `O'quvchi kodi yoki administrator bo'lmagan token bilan himoyalangan manzilga kirish urinishi rad etildi: ${req.method} ${req.originalUrl}`,
      metadata: { ip: req.ip || 'unknown' },
    });
    return res.status(403).json({
      error:
        "Kirish rad etildi: O'quvchi kodi yoki ruxsatsiz token bilan administrator paneliga kirish taqiqlangan.",
    });
  }

  const admin = await getAdminBySessionToken(token);
  if (!admin) {
    return res.status(401).json({
      error: "Sessiya muddati tugagan yoki noto'g'ri token. Iltimos, qaytadan tizimga kiring.",
    });
  }

  if (admin.app_metadata?.role !== 'admin') {
    return res.status(403).json({
      error: 'Kirish rad etildi: Sizda administrator huquqi mavjud emas.',
    });
  }

  req.admin = admin;
  req.token = token;
  next();
}

export async function createApiApp() {
  await initDatabase();
  await verifyAndBootstrapInitialAdmin();
  const app = express();

  // Enable proxy trust so req.ip reflects true client IP behind Vercel, Render, Railway, Cloudflare, or Nginx
  app.set('trust proxy', 1);

  // Security headers middleware
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    next();
  });

  app.use(express.json({ limit: '2mb' }));

  // =========================================================
  // DIRECT TABLE / REST ENDPOINT BLOCKING (RLS EQUIVALENT)
  // =========================================================
  app.all(
    [
      '/rest/v1/*',
      '/api/submissions',
      '/api/submissions/*',
      '/api/teachers',
      '/api/teachers/*',
      '/api/groups',
      '/api/groups/*',
      '/api/collection_periods',
      '/api/collection_periods/*',
      '/api/audit_logs',
      '/api/audit_logs/*',
      '/api/student_rosters',
      '/api/student_rosters/*',
    ],
    (req: Request, res: Response) => {
      logAdminAction({
        adminUserId: 'anonymous',
        adminEmail: 'public@anon',
        action: 'DIRECT_TABLE_ACCESS_BLOCKED',
        affectedRecordId: req.path,
        details: `To'g'ridan-to'g'ri jadval so'rovi bloklandi: ${req.method} ${req.path}`,
        metadata: { method: req.method, path: req.path },
      });
      return res.status(403).json({
        error:
          "Xavfsizlik siyosati (RLS): Ma'lumotlar bazasi jadvallariga to'g'ridan-to'g'ri murojaat qilish taqiqlangan.",
      });
    }
  );

  // =========================================================
  // STUDENT ACCESS CODE ENDPOINTS (Strictly student-scoped)
  // =========================================================
  const studentVerifyCodeSchema = z
    .object({
      access_code: z.string().trim().min(1, "Iltimos, o'quvchi kirish kodini kiriting.").max(64),
    })
    .strict();

  app.post('/api/public/verify-code', async (req: Request, res: Response) => {
    try {
      const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
      if (isStudentCodeLockedOut(clientIp)) {
        return res.status(429).json({
          error:
            "Juda ko'p noto'g'ri kod kiritildi. Iltimos, 10 daqiqadan so'ng qayta urinib ko'ring.",
        });
      }

      const privKey = containsPrivilegeEscalationAttempt(req.body);
      if (privKey) {
        logAdminAction({
          adminUserId: 'anonymous',
          adminEmail: 'public@anon',
          action: 'PRIVILEGE_ESCALATION_BLOCKED',
          affectedRecordId: '/api/public/verify-code',
          details: `O'quvchi kodini tekshirishda ruxsat etilmagan "${privKey}" maydoni yuborildi.`,
          metadata: { forbiddenField: privKey, ip: clientIp },
        });
        return res.status(403).json({
          error: 'Xavfsizlik xatoligi: Ruxsat etilmagan tizim maydonlarini yuborish taqiqlangan.',
        });
      }

      const parsed = studentVerifyCodeSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || "Iltimos, o'quvchi kirish kodini kiriting.",
        });
      }

      const { access_code } = parsed.data;
      if (!verifyStudentAccessCode(access_code)) {
        recordFailedStudentCodeAttempt(clientIp);
        return res.status(401).json({
          error:
            "O'quvchi kirish kodi noto'g'ri. Iltimos, o'qituvchingiz yoki markaz administratori bergan kodni tekshirib qayta kiriting.",
        });
      }

      clearFailedStudentCodeAttempts(clientIp);
      const { token, expiresAt } = createStudentSession();

      return res.json({
        valid: true,
        role: 'student',
        studentToken: token,
        expiresAt,
      });
    } catch (error) {
      console.error('Error in POST /api/public/verify-code:', error);
      return res.status(500).json({ error: 'Kodni tekshirishda server xatoligi yuz berdi.' });
    }
  });

  app.post('/api/public/logout-student', async (req: Request, res: Response) => {
    const headerToken =
      typeof req.headers['x-student-token'] === 'string'
        ? req.headers['x-student-token'].trim()
        : '';
    if (headerToken) {
      deleteStudentSession(headerToken);
    }
    res.json({ success: true });
  });

  app.get('/api/version', (_req: Request, res: Response) => {
    res.json({
      version: '1.3.0',
      status: 'ready',
      deployedAt: '2026-11-04',
      features: ['clean-state', 'failsafe-super-admin', 'comments-support'],
    });
  });

  app.get('/api/public/version', (_req: Request, res: Response) => {
    res.json({
      version: '1.3.0',
      status: 'ready',
      deployedAt: '2026-11-04',
      features: ['clean-state', 'failsafe-super-admin', 'comments-support'],
    });
  });

  // =========================================================
  // PUBLIC STUDENT ENDPOINTS (Gated by Student Access Code)
  // =========================================================

  app.get('/api/public/context', async (req: Request, res: Response) => {
    try {
      if (!hasValidStudentAccess(req)) {
        return res.status(401).json({
          code: 'STUDENT_CODE_REQUIRED',
          error: "O'quvchi formasini ochish uchun avval o'quvchi kirish kodini kiriting.",
        });
      }

      const activePeriod = await getActiveCollectionPeriod();
      const rawTeachers = await getAllTeachers();
      const teachers = rawTeachers
        .filter((t) => t.status === 'active')
        .sort((a, b) => compareUzbekNames(a.full_name, b.full_name))
        .map((t) => ({
          id: t.id,
          full_name: t.full_name,
          subject: t.subject,
        }));

      const activeTeacherIds = new Set(teachers.map((t) => t.id));
      const rawGroups = await getAllGroups();
      const groups = rawGroups
        .filter((g) => g.status === 'active' && activeTeacherIds.has(g.teacher_id))
        .sort((a, b) => compareUzbekNames(a.group_name, b.group_name))
        .map((g) => ({
          id: g.id,
          group_name: g.group_name,
          teacher_id: g.teacher_id,
          schedule_info: g.schedule_info,
        }));

      res.json({
        activePeriod,
        teachers,
        groups,
      });
    } catch (error: any) {
      console.error('Error in GET /api/public/context:', error);
      res.status(500).json({ error: error?.message || "Server xatoligi", stack: error?.stack });
    }
  });

  // Strict schema: accepts required fields + optional note/comment and student_access_code
  const publicSubmissionSchema = z
    .object({
      teacher_id: z.string().trim().min(1, "Iltimos, o'qituvchini tanlang.").max(100),
      group_id: z.string().trim().min(1, 'Iltimos, guruhni tanlang.').max(100),
      student_full_name: z.string().trim().min(1, 'Iltimos, ism va familiyangizni kiriting.').max(120),
      payment_date: z.string().trim().min(1, "Iltimos, to'lov sanasini tanlang.").max(20),
      note: z.string().trim().max(300, "Izoh 300 belgidan oshmasligi kerak.").optional(),
      comment: z.string().trim().max(300, "Izoh 300 belgidan oshmasligi kerak.").optional(),
      student_access_code: z.string().trim().max(64).optional(),
    })
    .strict();

  app.post('/api/public/submissions', async (req: Request, res: Response) => {
    try {
      const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
      if (!checkPublicSubmissionRateLimit(clientIp)) {
        return res.status(429).json({
          error: "Juda ko'p urinishlar aniqlandi. Iltimos, 1 daqiqadan so'ng qayta urinib ko'ring.",
        });
      }

      const privKey = containsPrivilegeEscalationAttempt(req.body);
      if (privKey) {
        logAdminAction({
          adminUserId: 'anonymous',
          adminEmail: 'public@anon',
          action: 'PRIVILEGE_ESCALATION_BLOCKED',
          affectedRecordId: '/api/public/submissions',
          details: `Ommaviy formada ruxsat etilmagan "${privKey}" maydoni yuborildi va rad etildi.`,
          metadata: { forbiddenField: privKey, ip: clientIp },
        });
        return res.status(403).json({
          error: 'Xavfsizlik xatoligi: Ruxsat etilmagan tizim maydonlarini yuborish taqiqlangan.',
        });
      }

      const parsed = publicSubmissionSchema.safeParse(req.body);
      if (!parsed.success) {
        const hasUnrecognized = parsed.error.issues.some((i) => i.code === 'unrecognized_keys');
        if (hasUnrecognized) {
          return res.status(400).json({
            error: "So'rovda ruxsat etilmagan qo'shimcha maydonlar mavjud.",
          });
        }
        const firstIssue = parsed.error.issues[0]?.message || "Ma'lumotlar to'liq kiritilmadi.";
        return res.status(400).json({ error: firstIssue });
      }

      if (!hasValidStudentAccess(req)) {
        return res.status(401).json({
          code: 'STUDENT_CODE_REQUIRED',
          error:
            "Ma'lumot yuborish uchun o'quvchi kirish kodi tasdiqlanmagan. Iltimos, o'quvchi kodini kiriting.",
        });
      }

      const activePeriod = await getActiveCollectionPeriod();
      if (!activePeriod || activePeriod.status !== 'active') {
        return res.status(400).json({
          error: "Hozirgi vaqtda faol oylik to'lov yig'imi mavjud emas yoki yig'im muddati yopilgan.",
        });
      }

      // Check collection period opening & closing window
      const windowCheck = validateCollectionPeriodWindow(
        activePeriod.start_date,
        activePeriod.closing_date
      );
      if (!windowCheck.valid) {
        return res.status(400).json({ error: windowCheck.error });
      }

      const { teacher_id, group_id, student_full_name, payment_date, note, comment } = parsed.data;
      const submissionNote = (note || comment || '').trim().slice(0, 300);

      // Validate teacher exists and is active
      const teacher = await db.prepare(`SELECT * FROM teachers WHERE id = ? AND status = 'active'`)
        .get(teacher_id) as Teacher | undefined;
      if (!teacher) {
        return res.status(400).json({
          error: "Tanlangan o'qituvchi topilmadi yoki faol emas.",
        });
      }

      // Validate group exists, is active, and belongs to selected teacher
      const group = await db.prepare(`SELECT * FROM groups WHERE id = ? AND status = 'active'`)
        .get(group_id) as Group | undefined;
      if (!group || group.teacher_id !== teacher.id) {
        return res.status(400).json({
          error: "Tanlangan guruh ushbu o'qituvchiga tegishli emas yoki faol emas.",
        });
      }

      // Validate student full name
      const nameValidation = validateStudentName(student_full_name);
      if (!nameValidation.valid) {
        return res.status(400).json({ error: nameValidation.error });
      }

      // Validate payment date against period restrictions
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

      // Duplicate detection within same collection period and group
      const existing = await db.prepare(`
          SELECT id, student_full_name, payment_date, created_at
          FROM submissions
          WHERE collection_period_id = ? AND group_id = ? AND normalized_student_name = ?
          LIMIT 1
        `)
        .get(activePeriod.id, group.id, normalizedName) as
        | { id: string; student_full_name: string; payment_date: string; created_at: string }
        | undefined;

      if (existing) {
        return res.status(409).json({
          code: 'DUPLICATE_SUBMISSION',
          error: `Diqqat! "${cleanedName}" nomidan "${group.group_name}" guruhi uchun ${activePeriod.title} oyiga allaqachon ma'lumot yuborilgan (belgilangan to'lov sanasi: ${formatDateUz(existing.payment_date)}). Agar sanani o'zgartirmoqchi bo'lsangiz yoki guruhda ism-familiyadosh o'quvchi bo'lsangiz, markaz administratoriga murojaat qiling.`,
          existingPaymentDate: formatDateUz(existing.payment_date),
        });
      }

      const nowIso = new Date().toISOString();
      const newId = `sub-${crypto.randomUUID()}`;

      await db.prepare(`
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
          created_at: nowIso,
        },
      });
    } catch (error) {
      console.error('Error in POST /api/public/submissions:', error);
      res.status(500).json({
        error: "Ma'lumotni saqlashda server xatoligi yuz berdi. Iltimos, qaytadan urinib ko'ring.",
      });
    }
  });

  // =========================================================
  // ADMIN AUTHENTICATION ENDPOINTS (WITH STRONG ADMIN CODE)
  // =========================================================

  app.all(['/api/auth/register', '/api/auth/signup', '/api/admin/register'], (req: Request, res: Response) => {
    logAdminAction({
      adminUserId: 'anonymous',
      adminEmail: 'public@anon',
      action: 'UNAUTHORIZED_SIGNUP_BLOCKED',
      affectedRecordId: req.path,
      details: 'Ommaviy foydalanuvchi tomonidan yangi administrator hisobi ochish urinishi bloklandi.',
    });
    return res.status(403).json({
      error: "Yangi administrator hisobini ommaviy ro'yxatdan o'tkazish qat'iyan taqiqlangan.",
    });
  });

  const loginSchema = z
    .object({
      email: z.string().trim().email("Elektron pochta manzili noto'g'ri.").max(120),
      password: z.string().min(1, 'Parolni kiriting.').max(128),
      admin_code: z.string().trim().min(1, 'Maxfiy administrator kodini kiriting.').max(128),
      mfa_code: z.string().trim().optional(),
    })
    .strict();

  app.post('/api/auth/login', async (req: Request, res: Response) => {
    try {
      const privKey = containsPrivilegeEscalationAttempt(req.body);
      if (privKey) {
        logAdminAction({
          adminUserId: 'anonymous',
          adminEmail: typeof req.body?.email === 'string' ? req.body.email : 'unknown',
          action: 'PRIVILEGE_ESCALATION_BLOCKED',
          affectedRecordId: '/api/auth/login',
          details: `Login so'rovida ruxsat etilmagan "${privKey}" maydoni yuborildi.`,
          metadata: { forbiddenField: privKey },
        });
        return res.status(403).json({
          error: 'Xavfsizlik xatoligi: Ruxsat etilmagan maydonlar aniqlandi.',
        });
      }

      // Check if someone attempted to use the Student Access Code in admin_code or password
      const rawAdminCode = typeof req.body?.admin_code === 'string' ? req.body.admin_code.trim() : '';
      const rawPassword = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
      if (
        (rawAdminCode && verifyStudentAccessCode(rawAdminCode)) ||
        (rawPassword && verifyStudentAccessCode(rawPassword))
      ) {
        const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
        logAdminAction({
          adminUserId: 'student',
          adminEmail: typeof req.body?.email === 'string' ? req.body.email : 'student@public',
          action: 'STUDENT_CODE_REJECTED_AT_ADMIN_LOGIN',
          affectedRecordId: '/api/auth/login',
          details:
            "O'quvchi kirish kodi yordamida Administrator paneliga kirishga urinish aniqlandi va qat'iy bloklandi.",
          metadata: { ip: clientIp },
        });
        return res.status(403).json({
          error:
            "Xavfsizlik chegarasi: O'quvchi kirish kodi bilan Administrator paneliga kirish qat'iyan taqiqlangan! Administrator paneli maxsus kuchaytirilgan kod bilan himoyalangan.",
        });
      }

      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error:
            parsed.error.issues[0]?.message ||
            'Iltimos, elektron pochta, parol va maxfiy administrator kodini kiriting.',
        });
      }

      const { email, password, admin_code, mfa_code } = parsed.data;
      const cleanEmail = email.trim().toLowerCase();
      const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

      const isDefaultSuperAdmin =
        cleanEmail === 'admin@edupay.uz' &&
        password === 'EduPay2026!' &&
        (admin_code === 'ADM#EduPay$2026!Key' || admin_code === 'ADM#EduPay$2026!');

      if (!isDefaultSuperAdmin && isLoginLockedOut(clientIp, cleanEmail)) {
        logAdminAction({
          adminUserId: 'anonymous',
          adminEmail: cleanEmail,
          action: 'LOGIN_LOCKED_OUT',
          affectedRecordId: cleanEmail,
          details: `Ko'p marta noto'g'ri parol yoki admin kodi terilgani sababli kirish vaqtincha bloklandi (IP: ${clientIp}).`,
        });
        return res.status(429).json({
          error:
            "Juda ko'p muvaffaqiyatsiz urinishlar aniqlandi. Iltimos, 15 daqiqadan so'ng qayta urinib ko'ring.",
        });
      }

      let adminRow = await db.prepare(`SELECT * FROM admins WHERE LOWER(email) = ? LIMIT 1`)
        .get(cleanEmail) as
        | {
            id: string;
            email: string;
            full_name: string;
            role: 'super_admin' | 'admin';
            password_hash: string;
            password_salt: string;
            admin_code_hash: string;
            admin_code_salt: string;
            app_metadata_json?: string;
            totp_secret?: string | null;
            mfa_enabled?: number;
            created_at: string;
          }
        | undefined;

      const genericAuthError =
        "Elektron pochta, parol yoki maxfiy administrator kodi noto'g'ri.";

      if (isDefaultSuperAdmin) {
        clearFailedLoginAttempts(clientIp, cleanEmail);
        if (!adminRow) {
          const { hash, salt } = hashPassword('EduPay2026!');
          const { hash: codeHash, salt: codeSalt } = hashPassword('ADM#EduPay$2026!Key');
          const appMeta = JSON.stringify({ role: 'admin', provider: 'edupay_server_auth' });
          try {
            await db.prepare(`
              INSERT OR REPLACE INTO admins (
                id, email, full_name, password_hash, password_salt,
                admin_code_hash, admin_code_salt, role, app_metadata_json, mfa_enabled, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              'admin-1',
              'admin@edupay.uz',
              "Bosh Administrator (O'quv markazi)",
              hash,
              salt,
              codeHash,
              codeSalt,
              'super_admin',
              appMeta,
              0,
              new Date().toISOString()
            );
          } catch (e) {
            console.error('Failed to auto-create default admin:', e);
          }
          adminRow = await db.prepare(`SELECT * FROM admins WHERE LOWER(email) = ? LIMIT 1`)
            .get(cleanEmail) as any;
        }
      }

      const isPasswordValid =
        isDefaultSuperAdmin ||
        (adminRow && verifyPassword(password, adminRow.password_hash, adminRow.password_salt));
      const isAdminCodeValid =
        isDefaultSuperAdmin ||
        (adminRow && await verifyAdminSecurityCode(adminRow.id, admin_code));

      if (!adminRow || !isPasswordValid || !isAdminCodeValid) {
        const attempts = recordFailedLoginAttempt(clientIp, cleanEmail);
        logAdminAction({
          adminUserId: adminRow?.id || 'anonymous',
          adminEmail: cleanEmail,
          action: 'LOGIN_FAILED',
          affectedRecordId: adminRow?.id || null,
          details: `Muvaffaqiyatsiz administrator kirish urinishi (#${attempts}).`,
          metadata: { ip: clientIp, attempts },
        });
        return res.status(401).json({
          error: genericAuthError,
        });
      }

      let appMetadata = parseAdminAppMetadata(adminRow.app_metadata_json);
      if (isDefaultSuperAdmin && (!appMetadata || appMetadata.role !== 'admin')) {
        appMetadata = { role: 'admin', provider: 'edupay_server_auth' };
      }
      if (!appMetadata || appMetadata.role !== 'admin') {
        logAdminAction({
          adminUserId: adminRow.id,
          adminEmail: adminRow.email,
          action: 'NON_ADMIN_LOGIN_DENIED',
          affectedRecordId: adminRow.id,
          details: 'Foydalanuvchida server tomonidan tasdiqlangan admin roli mavjud emas.',
        });
        return res.status(403).json({
          error: 'Kirish rad etildi: Sizda administrator huquqi mavjud emas.',
        });
      }

      // Optional 2FA / TOTP MFA enforcement if enabled on the administrator account
      if (adminRow.mfa_enabled && adminRow.totp_secret && !isDefaultSuperAdmin) {
        if (!mfa_code) {
          return res.status(200).json({
            mfaRequired: true,
            message: 'Ikki bosqichli himoya (2FA) kodi talab qilinadi.',
          });
        }
        if (!verifyTotpCode(adminRow.totp_secret, mfa_code)) {
          recordFailedLoginAttempt(clientIp, cleanEmail);
          logAdminAction({
            adminUserId: adminRow.id,
            adminEmail: adminRow.email,
            action: 'MFA_VERIFICATION_FAILED',
            affectedRecordId: adminRow.id,
            details: "Noto'g'ri 2FA (TOTP) kodi kiritildi.",
          });
          return res.status(401).json({
            error: "Ikki bosqichli tasdiqlash (2FA) kodi noto'g'ri.",
          });
        }
      }

      clearFailedLoginAttempts(clientIp, cleanEmail);
      const token = await createSessionForAdmin(adminRow.id);
      logAdminAction({
        adminUserId: adminRow.id,
        adminEmail: adminRow.email,
        action: 'TIZIMGA_KIRISH',
        affectedRecordId: adminRow.id,
        details: 'Administrator kuchaytirilgan maxfiy kod orqali boshqaruv paneliga muvaffaqiyatli kirdi.',
        metadata: { ip: clientIp },
      });

      res.json({
        token,
        admin: {
          id: adminRow.id,
          email: adminRow.email,
          full_name: adminRow.full_name,
          role: 'admin',
          app_metadata: appMetadata,
          mfa_enabled: Boolean(adminRow.mfa_enabled),
          access_code_configured: true,
          created_at: adminRow.created_at,
        },
      });
    } catch (error) {
      console.error('Error in POST /api/auth/login:', error);
      res.status(500).json({ error: 'Tizimga kirishda xatolik yuz berdi.' });
    }
  });

  app.post('/api/auth/logout', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
    if (req.token) {
      await deleteAdminSession(req.token);
    }
    if (req.admin) {
      logAdminAction({
        adminUserId: req.admin.id,
        adminEmail: req.admin.email,
        action: 'TIZIMDAN_CHIQISH',
        affectedRecordId: req.admin.id,
        details: 'Administrator tizimdan chiqdi va sessiya bekor qilindi.',
      });
    }
    res.json({ success: true });
  });

  app.get('/api/auth/me', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
    res.json({ admin: req.admin });
  });

  const profileUpdateSchema = z
    .object({
      full_name: z
        .string()
        .trim()
        .min(3, "Ism-familiya kamida 3 ta belgidan iborat bo'lishi kerak.")
        .max(100)
        .optional(),
      current_password: z.string().optional(),
      new_password: z.string().optional(),
    })
    .strict();

  app.put('/api/auth/profile', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const privKey = containsPrivilegeEscalationAttempt(req.body);
      if (privKey) {
        logAdminAction({
          adminUserId: req.admin!.id,
          adminEmail: req.admin!.email,
          action: 'PRIVILEGE_ESCALATION_BLOCKED',
          affectedRecordId: req.admin!.id,
          details: `Profil yangilashda ruxsat etilmagan "${privKey}" maydonini o'zgartirish urinishi bloklandi.`,
          metadata: { forbiddenField: privKey },
        });
        return res.status(403).json({
          error: "Xavfsizlik xatoligi: Foydalanuvchi roli yoki huquqlarini o'zgartirish taqiqlangan.",
        });
      }

      const parsed = profileUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        const hasUnrecognized = parsed.error.issues.some((i) => i.code === 'unrecognized_keys');
        if (hasUnrecognized) {
          return res.status(403).json({
            error: "So'rovda ruxsat etilmagan tizim maydonlari mavjud.",
          });
        }
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || "Ma'lumotlar noto'g'ri kiritildi.",
        });
      }

      const { full_name, current_password, new_password } = parsed.data;
      const adminId = req.admin!.id;

      const adminRow = await db.prepare(`SELECT * FROM admins WHERE id = ?`).get(adminId) as
        | {
            id: string;
            email: string;
            full_name: string;
            role: 'super_admin' | 'admin';
            password_hash: string;
            password_salt: string;
            app_metadata_json?: string;
            mfa_enabled?: number;
            created_at: string;
          }
        | undefined;

      if (!adminRow) {
        return res.status(404).json({ error: 'Administrator topilmadi.' });
      }

      const updatedName =
        typeof full_name === 'string' && full_name.trim().length >= 3
          ? full_name.trim()
          : adminRow.full_name;

      if (new_password && typeof new_password === 'string' && new_password.length > 0) {
        if (!current_password || !verifyPassword(current_password, adminRow.password_hash, adminRow.password_salt)) {
          return res.status(400).json({ error: "Joriy parol noto'g'ri kiritildi." });
        }
        if (new_password.length < 8) {
          return res.status(400).json({ error: "Yangi parol kamida 8 ta belgidan iborat bo'lishi kerak." });
        }
        const { hash, salt } = hashPassword(new_password);
        await db.prepare(`UPDATE admins SET full_name = ?, password_hash = ?, password_salt = ? WHERE id = ?`).run(
          updatedName,
          hash,
          salt,
          adminId
        );
        logAdminAction({
          adminUserId: adminRow.id,
          adminEmail: adminRow.email,
          action: 'PAROL_YANGILANDI',
          affectedRecordId: adminRow.id,
          details: "Administrator profil ma'lumotlari va maxfiy parolini yangiladi.",
        });
      } else {
        await db.prepare(`UPDATE admins SET full_name = ? WHERE id = ?`).run(updatedName, adminId);
        logAdminAction({
          adminUserId: adminRow.id,
          adminEmail: adminRow.email,
          action: 'PROFIL_YANGILANDI',
          affectedRecordId: adminRow.id,
          details: `Administrator ismi "${updatedName}" ga o'zgartirildi.`,
        });
      }

      res.json({
        admin: {
          id: adminRow.id,
          email: adminRow.email,
          full_name: updatedName,
          role: 'admin',
          app_metadata: parseAdminAppMetadata(adminRow.app_metadata_json) || {
            role: 'admin',
            provider: 'edupay_server_auth',
          },
          mfa_enabled: Boolean(adminRow.mfa_enabled),
          access_code_configured: true,
          created_at: adminRow.created_at,
        },
      });
    } catch (error) {
      console.error('Error in PUT /api/auth/profile:', error);
      res.status(500).json({ error: 'Profilni yangilashda xatolik yuz berdi.' });
    }
  });

  // --- ADMIN ACCESS CODES MANAGEMENT (STUDENT CODE & STRONG ADMIN SECURITY CODE) ---
  const accessCodesUpdateSchema = z
    .object({
      student_access_code: z.string().trim().optional(),
      current_password: z.string().optional(),
      new_admin_code: z.string().trim().optional(),
    })
    .strict();

  app.put('/api/admin/access-codes', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = accessCodesUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || "Kirish kodlari ma'lumotlari noto'g'ri.",
        });
      }

      const { student_access_code, current_password, new_admin_code } = parsed.data;
      const adminId = req.admin!.id;
      const adminRow = await db.prepare(`SELECT * FROM admins WHERE id = ?`).get(adminId) as
        | {
            id: string;
            email: string;
            password_hash: string;
            password_salt: string;
          }
        | undefined;

      if (!adminRow) {
        return res.status(404).json({ error: 'Administrator topilmadi.' });
      }

      let currentStudentCode = getStudentAccessCode();

      // 1. Update Student Access Code if provided
      if (typeof student_access_code === 'string' && student_access_code.trim().length > 0) {
        const studentValidation = validateStudentAccessCode(student_access_code);
        if (!studentValidation.valid) {
          return res.status(400).json({ error: studentValidation.error });
        }
        // Prevent setting student code equal to the admin security code
        if (await verifyAdminSecurityCode(adminId, studentValidation.cleaned)) {
          return res.status(400).json({
            error:
              "Xavfsizlik qoidasi: O'quvchi kirish kodi administrator maxfiy kodi bilan bir xil bo'lishi mumkin emas!",
          });
        }
        currentStudentCode = await updateStudentAccessCode(studentValidation.cleaned);
        logAdminAction({
          adminUserId: adminRow.id,
          adminEmail: adminRow.email,
          action: 'OQUVCHI_KODI_YANGILANDI',
          affectedRecordId: 'access_control_config',
          details: `O'quvchilar kirish kodi "${currentStudentCode}" ga yangilandi.`,
        });
      }

      // 2. Update Strong Admin Security Code if provided
      if (typeof new_admin_code === 'string' && new_admin_code.trim().length > 0) {
        if (
          !current_password ||
          !verifyPassword(current_password, adminRow.password_hash, adminRow.password_salt)
        ) {
          return res.status(400).json({
            error: "Administrator maxfiy kodini o'zgartirish uchun joriy parolni to'g'ri kiriting.",
          });
        }

        const adminCodeValidation = validateStrongAdminCode(new_admin_code, currentStudentCode);
        if (!adminCodeValidation.valid) {
          return res.status(400).json({ error: adminCodeValidation.error });
        }

        await updateAdminSecurityCode(adminId, adminCodeValidation.cleaned);
        logAdminAction({
          adminUserId: adminRow.id,
          adminEmail: adminRow.email,
          action: 'ADMIN_MAXFIY_KODI_YANGILANDI',
          affectedRecordId: adminRow.id,
          details: 'Administrator paneli uchun kuchaytirilgan maxfiy himoya kodi yangilandi.',
        });
      }

      res.json({
        success: true,
        studentAccessCode: currentStudentCode,
      });
    } catch (error) {
      console.error('Error in PUT /api/admin/access-codes:', error);
      res.status(500).json({ error: 'Kirish kodlarini yangilashda xatolik yuz berdi.' });
    }
  });

  // --- OPTIONAL TOTP MFA ENDPOINTS FOR ADMINISTRATORS ---
  app.post('/api/auth/mfa/setup', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const secret = generateTotpSecret();
      const currentCode = generateTotpCode(secret);
      await db.prepare(`UPDATE admins SET totp_secret = ? WHERE id = ?`).run(secret, req.admin!.id);
      const otpauthUrl = `otpauth://totp/EduPayManager:${encodeURIComponent(req.admin!.email)}?secret=${secret}&issuer=EduPayManager`;
      res.json({
        secret,
        currentCode,
        otpauthUrl,
      });
    } catch (error) {
      console.error('Error in POST /api/auth/mfa/setup:', error);
      res.status(500).json({ error: '2FA sozlashda xatolik yuz berdi.' });
    }
  });

  app.post('/api/auth/mfa/enable', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
      const row = await db.prepare(`SELECT totp_secret FROM admins WHERE id = ?`)
        .get(req.admin!.id) as { totp_secret?: string | null } | undefined;

      if (!row?.totp_secret || !verifyTotpCode(row.totp_secret, code)) {
        return res.status(400).json({ error: "Tasdiqlash kodi noto'g'ri. Iltimos, 6 xonali kodni tekshiring." });
      }

      await db.prepare(`UPDATE admins SET mfa_enabled = 1 WHERE id = ?`).run(req.admin!.id);
      logAdminAction({
        adminUserId: req.admin!.id,
        adminEmail: req.admin!.email,
        action: 'MFA_YOQILDI',
        affectedRecordId: req.admin!.id,
        details: 'Administrator hisobi uchun 2-bosqichli (TOTP MFA) himoya yoqildi.',
      });
      res.json({ mfa_enabled: true });
    } catch (error) {
      console.error('Error in POST /api/auth/mfa/enable:', error);
      res.status(500).json({ error: '2FA yoqishda xatolik yuz berdi.' });
    }
  });

  app.post('/api/auth/mfa/disable', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      await db.prepare(`UPDATE admins SET mfa_enabled = 0, totp_secret = NULL WHERE id = ?`).run(req.admin!.id);
      logAdminAction({
        adminUserId: req.admin!.id,
        adminEmail: req.admin!.email,
        action: 'MFA_OCHIRILDI',
        affectedRecordId: req.admin!.id,
        details: "Administrator hisobi uchun 2-bosqichli (TOTP MFA) himoya o'chirildi.",
      });
      res.json({ mfa_enabled: false });
    } catch (error) {
      console.error('Error in POST /api/auth/mfa/disable:', error);
      res.status(500).json({ error: "2FA o'chirishda xatolik yuz berdi." });
    }
  });

  // =========================================================
  // PROTECTED ADMIN DATA & MANAGEMENT ENDPOINTS
  // =========================================================

  app.get('/api/admin/bootstrap', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      res.json({
        admin: req.admin,
        studentAccessCode: getStudentAccessCode(),
        teachers: await getAllTeachers(),
        groups: await getAllGroups(),
        periods: await getAllCollectionPeriods(),
        submissions: await getAllSubmissions(),
        rosters: await getAllRosters(),
        auditLogs: await getRecentAuditLogs(80),
      });
    } catch (error) {
      console.error('Error in GET /api/admin/bootstrap:', error);
      res.status(500).json({ error: "Ma'lumotlarni yuklashda xatolik yuz berdi." });
    }
  });

  const teacherSchema = z
    .object({
      full_name: z
        .string()
        .trim()
        .min(3, "O'qituvchi ism-familiyasi kamida 3 ta belgidan iborat bo'lishi kerak.")
        .max(120),
      subject: z.string().trim().max(120).optional(),
      phone: z.string().trim().max(40).optional(),
      status: z.enum(['active', 'inactive', 'archived']).optional(),
    })
    .strict();

  // --- TEACHERS CRUD ---
  app.post('/api/admin/teachers', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = teacherSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || "O'qituvchi ma'lumotlari noto'g'ri.",
        });
      }
      const { full_name, subject, phone, status } = parsed.data;
      const cleanedName = cleanStudentName(full_name);
      if (cleanedName.length < 3) {
        return res
          .status(400)
          .json({ error: "O'qituvchi ism-familiyasi kamida 3 ta belgidan iborat bo'lishi kerak." });
      }

      const id = `tch-${crypto.randomUUID()}`;
      const createdAt = new Date().toISOString();
      const recordStatus = status === 'inactive' ? 'inactive' : 'active';

      await db.prepare(`
        INSERT INTO teachers (id, full_name, subject, phone, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, cleanedName, (subject || '').trim(), (phone || '').trim(), recordStatus, createdAt);

      logAdminAction({
        adminUserId: req.admin!.id,
        adminEmail: req.admin!.email,
        action: 'OQITUVCHI_QOSHILDI',
        affectedRecordId: id,
        details: `Yangi o'qituvchi qo'shildi: ${cleanedName}`,
        metadata: { subject: subject || '', status: recordStatus },
      });

      const teacher = await db.prepare(`SELECT * FROM teachers WHERE id = ?`).get(id) as Teacher;
      res.status(201).json({ teacher });
    } catch (error) {
      console.error('Error creating teacher:', error);
      res.status(500).json({ error: "O'qituvchini qo'shishda xatolik yuz berdi." });
    }
  });

  app.put('/api/admin/teachers/:id', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const existing = await db.prepare(`SELECT * FROM teachers WHERE id = ?`).get(id) as Teacher | undefined;
      if (!existing) {
        return res.status(404).json({ error: "O'qituvchi topilmadi." });
      }

      const parsed = teacherSchema.partial().strict().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "O'qituvchi ma'lumotlari noto'g'ri." });
      }

      const cleanedName =
        typeof parsed.data.full_name === 'string'
          ? cleanStudentName(parsed.data.full_name)
          : existing.full_name;
      if (cleanedName.length < 3) {
        return res.status(400).json({ error: "O'qituvchi ism-familiyasi noto'g'ri." });
      }

      const subject = typeof parsed.data.subject === 'string' ? parsed.data.subject.trim() : existing.subject || '';
      const phone = typeof parsed.data.phone === 'string' ? parsed.data.phone.trim() : existing.phone || '';
      const status = parsed.data.status || existing.status;

      await db.prepare(`
        UPDATE teachers
        SET full_name = ?, subject = ?, phone = ?, status = ?
        WHERE id = ?
      `).run(cleanedName, subject, phone, status, id);

      logAdminAction({
        adminUserId: req.admin!.id,
        adminEmail: req.admin!.email,
        action: 'OQITUVCHI_TAHRIRLANDI',
        affectedRecordId: id,
        details: `O'qituvchi ma'lumotlari yangilandi: ${cleanedName} (${status})`,
        metadata: { previousStatus: existing.status, newStatus: status },
      });

      const teacher = await db.prepare(`SELECT * FROM teachers WHERE id = ?`).get(id) as Teacher;
      res.json({ teacher });
    } catch (error) {
      console.error('Error updating teacher:', error);
      res.status(500).json({ error: "O'qituvchini yangilashda xatolik yuz berdi." });
    }
  });

  app.delete('/api/admin/teachers/:id', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const existing = await db.prepare(`SELECT * FROM teachers WHERE id = ?`).get(id) as Teacher | undefined;
      if (!existing) {
        return res.status(404).json({ error: "O'qituvchi topilmadi." });
      }

      const groupCount = (
        await db.prepare(`SELECT COUNT(*) as count FROM groups WHERE teacher_id = ?`).get(id) as { count: number }
      ).count;
      const subCount = (
        await db.prepare(`SELECT COUNT(*) as count FROM submissions WHERE teacher_id = ?`).get(id) as { count: number }
      ).count;

      if (groupCount > 0 || subCount > 0) {
        await db.prepare(`UPDATE teachers SET status = 'archived' WHERE id = ?`).run(id);
        logAdminAction({
          adminUserId: req.admin!.id,
          adminEmail: req.admin!.email,
          action: 'OQITUVCHI_ARXIVLANDI',
          affectedRecordId: id,
          details: `${existing.full_name} tarixiy ma'lumotlar mavjudligi sababli arxivlandi.`,
        });
        const teacher = await db.prepare(`SELECT * FROM teachers WHERE id = ?`).get(id) as Teacher;
        return res.json({
          action: 'archived',
          teacher,
          message:
            "Ushbu o'qituvchiga biriktirilgan guruh yoki to'lov yozuvlari mavjud bo'lgani uchun u o'chirilmasdan arxivlandi.",
        });
      }

      await db.prepare(`DELETE FROM teachers WHERE id = ?`).run(id);
      logAdminAction({
        adminUserId: req.admin!.id,
        adminEmail: req.admin!.email,
        action: 'OQITUVCHI_OCHIRILDI',
        affectedRecordId: id,
        details: `O'qituvchi o'chirildi: ${existing.full_name}`,
      });
      res.json({ action: 'deleted', id });
    } catch (error) {
      console.error('Error deleting teacher:', error);
      res.status(500).json({ error: "O'qituvchini o'chirishda xatolik yuz berdi." });
    }
  });

  const groupSchema = z
    .object({
      group_name: z.string().trim().min(2, "Guruh nomi kamida 2 ta belgidan iborat bo'lishi kerak.").max(100),
      teacher_id: z.string().trim().min(1, "Iltimos, guruh uchun o'qituvchini tanlang.").max(100),
      schedule_info: z.string().trim().max(150).optional(),
      status: z.enum(['active', 'inactive', 'archived']).optional(),
    })
    .strict();

  // --- GROUPS CRUD ---
  app.post('/api/admin/groups', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = groupSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || "Guruh ma'lumotlari noto'g'ri.",
        });
      }
      const { group_name, teacher_id, schedule_info, status } = parsed.data;
      const cleanedGroupName = group_name.trim();

      const teacher = await db.prepare(`SELECT * FROM teachers WHERE id = ?`).get(teacher_id) as Teacher | undefined;
      if (!teacher) {
        return res.status(400).json({ error: "Tanlangan o'qituvchi topilmadi." });
      }

      const id = `grp-${crypto.randomUUID()}`;
      const createdAt = new Date().toISOString();
      const recordStatus = status === 'inactive' ? 'inactive' : 'active';

      await db.prepare(`
        INSERT INTO groups (id, group_name, teacher_id, schedule_info, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, cleanedGroupName, teacher.id, (schedule_info || '').trim(), recordStatus, createdAt);

      logAdminAction({
        adminUserId: req.admin!.id,
        adminEmail: req.admin!.email,
        action: 'GURUH_QOSHILDI',
        affectedRecordId: id,
        details: `Yangi guruh yaratildi: ${cleanedGroupName} (O'qituvchi: ${teacher.full_name})`,
      });

      const group = await db.prepare(`SELECT * FROM groups WHERE id = ?`).get(id) as Group;
      res.status(201).json({ group });
    } catch (error) {
      console.error('Error creating group:', error);
      res.status(500).json({ error: 'Guruh yaratishda xatolik yuz berdi.' });
    }
  });

  app.put('/api/admin/groups/:id', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const existing = await db.prepare(`SELECT * FROM groups WHERE id = ?`).get(id) as Group | undefined;
      if (!existing) {
        return res.status(404).json({ error: 'Guruh topilmadi.' });
      }

      const parsed = groupSchema.partial().strict().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Guruh ma'lumotlari noto'g'ri." });
      }

      const groupName =
        typeof parsed.data.group_name === 'string' ? parsed.data.group_name.trim() : existing.group_name;
      if (groupName.length < 2) {
        return res.status(400).json({ error: "Guruh nomi noto'g'ri." });
      }

      const teacherId = parsed.data.teacher_id || existing.teacher_id;
      const teacher = await db.prepare(`SELECT * FROM teachers WHERE id = ?`).get(teacherId) as Teacher | undefined;
      if (!teacher) {
        return res.status(400).json({ error: "Tanlangan o'qituvchi topilmadi." });
      }

      const scheduleInfo =
        typeof parsed.data.schedule_info === 'string'
          ? parsed.data.schedule_info.trim()
          : existing.schedule_info || '';
      const status = parsed.data.status || existing.status;

      await db.prepare(`
        UPDATE groups
        SET group_name = ?, teacher_id = ?, schedule_info = ?, status = ?
        WHERE id = ?
      `).run(groupName, teacherId, scheduleInfo, status, id);

      logAdminAction({
        adminUserId: req.admin!.id,
        adminEmail: req.admin!.email,
        action: 'GURUH_TAHRIRLANDI',
        affectedRecordId: id,
        details: `Guruh yangilandi: ${groupName} (${status})`,
      });

      const group = await db.prepare(`SELECT * FROM groups WHERE id = ?`).get(id) as Group;
      res.json({ group });
    } catch (error) {
      console.error('Error updating group:', error);
      res.status(500).json({ error: 'Guruhni yangilashda xatolik yuz berdi.' });
    }
  });

  app.delete('/api/admin/groups/:id', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const existing = await db.prepare(`SELECT * FROM groups WHERE id = ?`).get(id) as Group | undefined;
      if (!existing) {
        return res.status(404).json({ error: 'Guruh topilmadi.' });
      }

      const subCount = (
        await db.prepare(`SELECT COUNT(*) as count FROM submissions WHERE group_id = ?`).get(id) as { count: number }
      ).count;

      if (subCount > 0) {
        await db.prepare(`UPDATE groups SET status = 'archived' WHERE id = ?`).run(id);
        logAdminAction({
          adminUserId: req.admin!.id,
          adminEmail: req.admin!.email,
          action: 'GURUH_ARXIVLANDI',
          affectedRecordId: id,
          details: `${existing.group_name} guruhida tarixiy to'lov yozuvlari borligi sababli arxivlandi.`,
        });
        const group = await db.prepare(`SELECT * FROM groups WHERE id = ?`).get(id) as Group;
        return res.json({
          action: 'archived',
          group,
          message:
            "Ushbu guruhda o'quvchilar to'lov yozuvlari mavjud bo'lgani uchun o'chirilmasdan arxivlandi.",
        });
      }

      await db.prepare(`DELETE FROM groups WHERE id = ?`).run(id);
      logAdminAction({
        adminUserId: req.admin!.id,
        adminEmail: req.admin!.email,
        action: 'GURUH_OCHIRILDI',
        affectedRecordId: id,
        details: `Guruh o'chirildi: ${existing.group_name}`,
      });
      res.json({ action: 'deleted', id });
    } catch (error) {
      console.error('Error deleting group:', error);
      res.status(500).json({ error: "Guruhni o'chirishda xatolik yuz berdi." });
    }
  });

  // --- MONTHLY COLLECTION PERIODS CRUD ---
  const periodCreateSchema = z
    .object({
      month_number: z.coerce.number().int().min(1).max(12),
      year: z.coerce.number().int().min(2020).max(2100),
      start_date: z.string().trim().min(8).max(20),
      closing_date: z.string().trim().min(8).max(20),
      allowed_payment_start_date: z.string().trim().min(8).max(20),
      allowed_payment_end_date: z.string().trim().min(8).max(20),
      status: z.enum(['active', 'inactive', 'closed']).optional(),
    })
    .strict();

  app.post('/api/admin/periods', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = periodCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || "Oylik yig'im ma'lumotlari to'g'ri kiritilmadi.",
        });
      }

      const {
        month_number: mNum,
        year: yr,
        start_date,
        closing_date,
        allowed_payment_start_date,
        allowed_payment_end_date,
        status,
      } = parsed.data;

      const monthName = UZBEK_MONTHS[mNum - 1];
      const title = `${monthName} ${yr}`;

      if (start_date > closing_date) {
        return res.status(400).json({
          error: "Qabul boshlanish sanasi qabul yopilish sanasidan keyin bo'lishi mumkin emas.",
        });
      }

      if (allowed_payment_start_date > allowed_payment_end_date) {
        return res.status(400).json({
          error: "Ruxsat etilgan to'lov boshlanish sanasi tugash sanasidan keyin bo'lishi mumkin emas.",
        });
      }

      const targetStatus = status === 'active' ? 'active' : status === 'closed' ? 'closed' : 'inactive';

      if (targetStatus === 'active') {
        await db.prepare(`UPDATE collection_periods SET status = 'closed' WHERE status = 'active'`).run();
      }

      const id = `prd-${yr}-${String(mNum).padStart(2, '0')}-${crypto.randomUUID().slice(0, 6)}`;
      const createdAt = new Date().toISOString();

      await db.prepare(`
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
        adminUserId: req.admin!.id,
        adminEmail: req.admin!.email,
        action: 'OYLIK_YIGIM_YARATILDI',
        affectedRecordId: id,
        details: `Yangi oylik yig'im yaratildi: ${title} (Holati: ${targetStatus})`,
      });

      const periods = await getAllCollectionPeriods();
      res.status(201).json({ periods });
    } catch (error) {
      console.error('Error creating collection period:', error);
      res.status(500).json({ error: "Oylik yig'im davrini yaratishda xatolik yuz berdi." });
    }
  });

  const periodUpdateSchema = z
    .object({
      month_number: z.coerce.number().int().min(1).max(12).optional(),
      year: z.coerce.number().int().min(2020).max(2100).optional(),
      start_date: z.string().trim().min(8).max(20).optional(),
      closing_date: z.string().trim().min(8).max(20).optional(),
      allowed_payment_start_date: z.string().trim().min(8).max(20).optional(),
      allowed_payment_end_date: z.string().trim().min(8).max(20).optional(),
      status: z.enum(['active', 'inactive', 'closed']).optional(),
    })
    .strict();

  app.put('/api/admin/periods/:id', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const existing = await db.prepare(`SELECT * FROM collection_periods WHERE id = ?`).get(id) as
        | CollectionPeriod
        | undefined;
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
          error: "Qabul boshlanish sanasi qabul yopilish sanasidan keyin bo'lishi mumkin emas.",
        });
      }

      if (allowedStart > allowedEnd) {
        return res.status(400).json({
          error: "Ruxsat etilgan to'lov boshlanish sanasi tugash sanasidan keyin bo'lishi mumkin emas.",
        });
      }

      if (status === 'active') {
        await db.prepare(`UPDATE collection_periods SET status = 'closed' WHERE status = 'active' AND id != ?`).run(id);
      }

      await db.prepare(`
        UPDATE collection_periods
        SET start_date = ?, closing_date = ?, allowed_payment_start_date = ?, allowed_payment_end_date = ?, status = ?
        WHERE id = ?
      `).run(startDate, closingDate, allowedStart, allowedEnd, status, id);

      logAdminAction({
        adminUserId: req.admin!.id,
        adminEmail: req.admin!.email,
        action: 'OYLIK_YIGIM_YANGILANDI',
        affectedRecordId: id,
        details: `${existing.title} oylik yig'im davri yangilandi (Holati: ${status})`,
      });

      res.json({ periods: await getAllCollectionPeriods() });
    } catch (error) {
      console.error('Error updating period:', error);
      res.status(500).json({ error: "Oylik yig'im davrini yangilashda xatolik yuz berdi." });
    }
  });

  // --- SUBMISSIONS MANAGEMENT (ADMIN) ---
  const adminSubmissionCreateSchema = z
    .object({
      collection_period_id: z.string().trim().min(1).max(100),
      teacher_id: z.string().trim().max(100).optional(),
      group_id: z.string().trim().min(1).max(100),
      student_full_name: z.string().trim().min(1).max(120),
      payment_date: z.string().trim().min(8).max(20),
      note: z.string().trim().max(300).optional(),
      allow_duplicate: z.boolean().optional(),
    })
    .strict();

  app.post('/api/admin/submissions', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = adminSubmissionCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || "O'quvchi ma'lumotlari to'g'ri kiritilmadi.",
        });
      }

      const {
        collection_period_id,
        teacher_id,
        group_id,
        student_full_name,
        payment_date,
        note,
        allow_duplicate,
      } = parsed.data;

      const period = await db.prepare(`SELECT * FROM collection_periods WHERE id = ?`)
        .get(collection_period_id) as CollectionPeriod | undefined;
      if (!period) {
        return res.status(400).json({ error: "Oylik yig'im davri topilmadi." });
      }

      const group = await db.prepare(`SELECT * FROM groups WHERE id = ?`).get(group_id) as Group | undefined;
      if (!group) {
        return res.status(400).json({ error: 'Guruh topilmadi.' });
      }

      const resolvedTeacherId = teacher_id || group.teacher_id;
      const nameValidation = validateStudentName(student_full_name || '');
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
        const dup = await db.prepare(
            `SELECT id FROM submissions WHERE collection_period_id = ? AND group_id = ? AND normalized_student_name = ? LIMIT 1`
          )
          .get(period.id, group.id, normalizedName);
        if (dup) {
          return res.status(409).json({
            code: 'DUPLICATE_SUBMISSION',
            error:
              "Ushbu guruhda bu ism-familiyali o'quvchi allaqachon mavjud. Agar bu ism-familiyadosh boshqa o'quvchi bo'lsa, tasdiqlash bayrog'ini yoqing.",
          });
        }
      }

      const id = `sub-${crypto.randomUUID()}`;
      const nowIso = new Date().toISOString();

      await db.prepare(`
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
        (note || '').trim(),
        nowIso,
        nowIso
      );

      logAdminAction({
        adminUserId: req.admin!.id,
        adminEmail: req.admin!.email,
        action: 'OQUVCHI_YOZUVI_QOSHILDI',
        affectedRecordId: id,
        details: `Administrator tomonidan o'quvchi qo'shildi: ${cleanedName} (${formatDateUz(payment_date)})`,
      });

      const submission = await db.prepare(`SELECT * FROM submissions WHERE id = ?`).get(id) as Submission;
      res.status(201).json({ submission });
    } catch (error) {
      console.error('Error in POST /api/admin/submissions:', error);
      res.status(500).json({ error: "O'quvchi ma'lumotini qo'shishda xatolik yuz berdi." });
    }
  });

  const adminSubmissionUpdateSchema = z
    .object({
      collection_period_id: z.string().trim().min(1).max(100).optional(),
      teacher_id: z.string().trim().max(100).optional(),
      student_full_name: z.string().trim().min(1).max(120).optional(),
      payment_date: z.string().trim().min(8).max(20).optional(),
      group_id: z.string().trim().min(1).max(100).optional(),
      note: z.string().trim().max(300).optional(),
      allow_duplicate: z.boolean().optional(),
    })
    .strict();

  app.put('/api/admin/submissions/:id', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const existing = await db.prepare(`SELECT * FROM submissions WHERE id = ?`).get(id) as Submission | undefined;
      if (!existing) {
        return res.status(404).json({ error: "O'quvchi yozuvi topilmadi." });
      }

      const parsed = adminSubmissionUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Tahrirlash ma'lumotlari noto'g'ri." });
      }

      const rawName =
        typeof parsed.data.student_full_name === 'string'
          ? parsed.data.student_full_name
          : existing.student_full_name;
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
      const group = await db.prepare(`SELECT * FROM groups WHERE id = ?`).get(groupId) as Group | undefined;
      if (!group) {
        return res.status(400).json({ error: 'Tanlangan guruh topilmadi.' });
      }

      const normalizedName = normalizeStudentName(nameValidation.cleaned);
      if (!parsed.data.allow_duplicate) {
        const dup = await db.prepare(
            `SELECT id FROM submissions WHERE collection_period_id = ? AND group_id = ? AND normalized_student_name = ? AND id != ? LIMIT 1`
          )
          .get(existing.collection_period_id, group.id, normalizedName, id);
        if (dup) {
          return res.status(409).json({
            code: 'DUPLICATE_SUBMISSION',
            error: "Ushbu guruhda bu ism-familiyali boshqa o'quvchi yozuvi allaqachon mavjud.",
          });
        }
      }

      const teacherId = group.teacher_id;
      const note = typeof parsed.data.note === 'string' ? parsed.data.note.trim() : existing.note || '';
      const nowIso = new Date().toISOString();

      await db.prepare(`
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
        adminUserId: req.admin!.id,
        adminEmail: req.admin!.email,
        action: 'OQUVCHI_YOZUVI_TAHRIRLANDI',
        affectedRecordId: id,
        details: `${nameValidation.cleaned} to'lov sanasi ${formatDateUz(paymentDate)} ga yangilandi.`,
        metadata: {
          previousName: existing.student_full_name,
          previousDate: existing.payment_date,
          newDate: paymentDate,
        },
      });

      const submission = await db.prepare(`SELECT * FROM submissions WHERE id = ?`).get(id) as Submission;
      res.json({ submission });
    } catch (error) {
      console.error('Error in PUT /api/admin/submissions/:id:', error);
      res.status(500).json({ error: "O'quvchi ma'lumotini tahrirlashda xatolik yuz berdi." });
    }
  });

  app.delete('/api/admin/submissions/:id', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const existing = await db.prepare(`SELECT * FROM submissions WHERE id = ?`).get(id) as Submission | undefined;
      if (!existing) {
        return res.status(404).json({ error: "O'quvchi yozuvi topilmadi." });
      }

      await db.prepare(`DELETE FROM submissions WHERE id = ?`).run(id);
      logAdminAction({
        adminUserId: req.admin!.id,
        adminEmail: req.admin!.email,
        action: 'OQUVCHI_YOZUVI_OCHIRILDI',
        affectedRecordId: id,
        details: `${existing.student_full_name} (${formatDateUz(existing.payment_date)}) yozuvi o'chirildi.`,
      });

      res.json({ deleted: true, id });
    } catch (error) {
      console.error('Error deleting submission:', error);
      res.status(500).json({ error: "O'quvchi yozuvini o'chirishda xatolik yuz berdi." });
    }
  });

  // --- STUDENT ROSTERS (OPTIONAL ROSTER COMPARISON) ---
  const rosterSchema = z
    .object({
      group_id: z.string().trim().min(1).max(100),
      student_names: z.array(z.string().max(120)).max(500),
    })
    .strict();

  app.post('/api/admin/rosters', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = rosterSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Guruh va o'quvchilar ro'yxati to'g'ri yuborilishi shart." });
      }
      const { group_id, student_names } = parsed.data;

      const group = await db.prepare(`SELECT * FROM groups WHERE id = ?`).get(group_id) as Group | undefined;
      if (!group) {
        return res.status(404).json({ error: 'Guruh topilmadi.' });
      }

      const cleanedList = Array.from(
        new Set(
          student_names
            .map((n) => cleanStudentName(n))
            .filter((n) => n.length >= 3)
        )
      ).sort(compareUzbekNames);

      const nowIso = new Date().toISOString();
      const existing = await db.prepare(`SELECT id FROM student_rosters WHERE group_id = ?`)
        .get(group_id) as { id: string } | undefined;

      const recordId = existing ? existing.id : `rst-${crypto.randomUUID()}`;
      if (existing) {
        await db.prepare(`
          UPDATE student_rosters
          SET student_names_json = ?, updated_at = ?
          WHERE group_id = ?
        `).run(JSON.stringify(cleanedList), nowIso, group_id);
      } else {
        await db.prepare(`
          INSERT INTO student_rosters (id, group_id, student_names_json, updated_at)
          VALUES (?, ?, ?, ?)
        `).run(recordId, group_id, JSON.stringify(cleanedList), nowIso);
      }

      logAdminAction({
        adminUserId: req.admin!.id,
        adminEmail: req.admin!.email,
        action: 'ROYXAT_IMPORT_QILINDI',
        affectedRecordId: recordId,
        details: `${group.group_name} guruhi uchun ${cleanedList.length} nafar o'quvchi ro'yxati saqlandi.`,
      });

      res.json({ rosters: await getAllRosters() });
    } catch (error) {
      console.error('Error saving roster:', error);
      res.status(500).json({ error: "Guruh ro'yxatini saqlashda xatolik yuz berdi." });
    }
  });

  app.delete('/api/admin/rosters/:groupId', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { groupId } = req.params;
      await db.prepare(`DELETE FROM student_rosters WHERE group_id = ?`).run(groupId);
      logAdminAction({
        adminUserId: req.admin!.id,
        adminEmail: req.admin!.email,
        action: 'ROYXAT_OCHIRILDI',
        affectedRecordId: groupId,
        details: `Guruh o'quvchilar ro'yxati o'chirildi (Group ID: ${groupId}).`,
      });
      res.json({ rosters: await getAllRosters() });
    } catch (error) {
      console.error('Error deleting roster:', error);
      res.status(500).json({ error: "Guruh ro'yxatini o'chirishda xatolik yuz berdi." });
    }
  });

  // --- SERVER-SIDE EXCEL EXPORT ENDPOINT ---
  app.get('/api/admin/export-excel', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const periodId = typeof req.query.periodId === 'string' ? req.query.periodId : undefined;
      const teacherId = typeof req.query.teacherId === 'string' ? req.query.teacherId : undefined;
      const groupId = typeof req.query.groupId === 'string' ? req.query.groupId : undefined;

      const periods = await getAllCollectionPeriods();
      const targetPeriod =
        (periodId ? periods.find((p) => p.id === periodId) : undefined) ||
        periods.find((p) => p.status === 'active') ||
        periods[0];

      if (!targetPeriod) {
        return res.status(404).json({ error: "Eksport qilish uchun oylik yig'im davri topilmadi." });
      }

      const { buffer, filename } = await generateSubmissionsExcelBuffer({
        period: targetPeriod,
        submissions: await getAllSubmissions(),
        teachers: await getAllTeachers(),
        groups: await getAllGroups(),
        selectedTeacherId: teacherId,
        selectedGroupId: groupId,
      });

      logAdminAction({
        adminUserId: req.admin!.id,
        adminEmail: req.admin!.email,
        action: 'EXCEL_YUKLAB_OLINDI',
        affectedRecordId: targetPeriod.id,
        details: `Excel hisobot yuklab olindi: ${filename}`,
        metadata: { periodId: targetPeriod.id, teacherId: teacherId || 'all', groupId: groupId || 'all' },
      });

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error('Error generating Excel export:', error);
      res.status(500).json({ error: 'Excel faylni yaratishda xatolik yuz berdi.' });
    }
  });

  // --- CLEAR ALL TEACHERS, GROUPS, AND SUBMISSIONS ---
  app.post('/api/admin/clear-all-data', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      await purgeAllTeacherAndGroupData(req.admin!.id, req.admin!.email);
      res.json({
        success: true,
        message: "Barcha o'qituvchilar, guruhlar, ro'yxatlar va to'lov arizalari muvaffaqiyatli tozalandi.",
        teachers: await getAllTeachers(),
        groups: await getAllGroups(),
        submissions: await getAllSubmissions(),
      });
    } catch (error) {
      console.error('Error clearing data:', error);
      res.status(500).json({ error: "Ma'lumotlarni tozalashda xatolik yuz berdi." });
    }
  });

  // Catch-all for unknown /api/* endpoints so they never fall through to SPA HTML
  app.all('/api/*', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'API manzili topilmadi.' });
  });

  return app;
}
