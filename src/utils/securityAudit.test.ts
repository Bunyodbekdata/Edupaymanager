import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createApp, resetSecurityRateLimits } from '../../server';
import {
  db,
  createSessionForAdmin,
  getDefaultAdminSecurityCode,
  getStudentAccessCode,
} from '../server/db';
import { verifyAndBootstrapInitialAdmin } from '../server/bootstrapAdmin';

describe('EduPay Manager — Comprehensive Security Audit & Two-Tier Access Control Suite (Tests A–L)', () => {
  let server: http.Server;
  let baseUrl = '';
  let validAdminToken = '';
  let validStudentToken = '';
  let createdTestSubmissionId = '';

  before(async () => {
    process.env.NODE_ENV = 'production'; // Test pure API & static routing without Vite dev middleware overhead
    resetSecurityRateLimits();
    // Ensure active period window covers current date for submission tests
    db.prepare(
      `UPDATE collection_periods SET start_date = '2025-01-01', closing_date = '2030-12-31' WHERE id = 'prd-2026-11'`
    ).run();
    // Ensure test fixtures exist for isolated integration tests
    db.prepare(`
      INSERT OR IGNORE INTO teachers (id, full_name, subject, phone, status, created_at)
      VALUES ('tch-abdulaziz', 'Abdulaziz Karimov', 'IELTS', '+998901234567', 'active', '2026-09-01T00:00:00.000Z')
    `).run();
    db.prepare(`
      INSERT OR IGNORE INTO groups (id, group_name, teacher_id, schedule_info, status, created_at)
      VALUES ('grp-ielts-01', 'IELTS-01', 'tch-abdulaziz', 'Dush 14:00', 'active', '2026-09-01T00:00:00.000Z')
    `).run();
    const app = await createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  after(async () => {
    if (createdTestSubmissionId) {
      db.prepare(`DELETE FROM submissions WHERE id = ?`).run(createdTestSubmissionId);
    }
    db.prepare(`DELETE FROM submissions WHERE normalized_student_name = 'xavfsizlik tekshiruv talabasi'`).run();
    db.prepare(`DELETE FROM groups WHERE id = 'grp-ielts-01'`).run();
    db.prepare(`DELETE FROM teachers WHERE id = 'tch-abdulaziz'`).run();
    db.prepare(`DELETE FROM admins WHERE id = 'non-admin-test-user'`).run();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('Static Source Code Audit: PublicStudentForm has no admin buttons/triggers and AdminLogin has no hardcoded credentials', () => {
    const publicFormCode = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/PublicStudentForm.tsx'),
      'utf8'
    );
    assert.equal(
      publicFormCode.includes('Administrator paneli'),
      false,
      'PublicStudentForm must not contain any "Administrator paneli" button or link'
    );
    assert.equal(
      publicFormCode.includes('/admin'),
      false,
      'PublicStudentForm must not contain any /admin route reference'
    );
    assert.equal(
      publicFormCode.includes('onSecretTrigger'),
      false,
      'PublicStudentForm must not contain any secret footer trigger to /admin/login'
    );

    const adminLoginCode = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/AdminLogin.tsx'),
      'utf8'
    );
    assert.equal(
      adminLoginCode.includes('EduPay2026!'),
      false,
      'AdminLogin.tsx must not contain any hardcoded password'
    );

    const envExampleCode = fs.readFileSync(
      path.resolve(process.cwd(), '.env.example'),
      'utf8'
    );
    assert.equal(
      envExampleCode.includes('EduPay2026!'),
      false,
      '.env.example must not expose real administrator passwords'
    );
  });

  it('Test A — Unauthenticated Admin Route & API Access is strictly blocked (401 Unauthorized)', async () => {
    const protectedEndpoints = [
      { method: 'GET', url: '/api/admin/bootstrap' },
      { method: 'POST', url: '/api/admin/teachers' },
      { method: 'POST', url: '/api/admin/groups' },
      { method: 'POST', url: '/api/admin/periods' },
      { method: 'POST', url: '/api/admin/submissions' },
      { method: 'POST', url: '/api/admin/rosters' },
      { method: 'PUT', url: '/api/admin/access-codes' },
      { method: 'GET', url: '/api/admin/export-excel' },
      { method: 'GET', url: '/api/auth/me' },
    ];

    for (const ep of protectedEndpoints) {
      const res = await fetch(`${baseUrl}${ep.url}`, { method: ep.method });
      assert.equal(
        res.status,
        401,
        `Expected 401 Unauthorized for unauthenticated ${ep.method} ${ep.url}, got ${res.status}`
      );
      const body = await res.json();
      assert.equal(body.submissions, undefined, 'Must never leak submissions on unauthenticated call');
      assert.equal(body.teachers, undefined, 'Must never leak admin teachers list on unauthenticated call');
    }
  });

  it('Test B — Student Access Code Gate & Strict Student-to-Admin Crossover Prevention (403 Forbidden)', async () => {
    // 1. Public context & submission without student code must be blocked with 401 STUDENT_CODE_REQUIRED
    const noCodeContextRes = await fetch(`${baseUrl}/api/public/context`);
    assert.equal(noCodeContextRes.status, 401);

    const noCodeSubRes = await fetch(`${baseUrl}/api/public/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        teacher_id: 'tch-abdulaziz',
        group_id: 'grp-ielts-01',
        student_full_name: 'Talaba Kodсиз',
        payment_date: '2026-11-12',
      }),
    });
    assert.equal(noCodeSubRes.status, 401);

    // 2. Wrong student code rejected
    const wrongCodeRes = await fetch(`${baseUrl}/api/public/verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_code: 'WRONG-9999' }),
    });
    assert.equal(wrongCodeRes.status, 401);

    // 3. Valid student code returns a stu_* session token with role='student'
    const currentStudentCode = getStudentAccessCode();
    const validCodeRes = await fetch(`${baseUrl}/api/public/verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_code: currentStudentCode }),
    });
    assert.equal(validCodeRes.status, 200);
    const codeData = await validCodeRes.json();
    assert.equal(codeData.valid, true);
    assert.equal(codeData.role, 'student');
    assert.ok(codeData.studentToken.startsWith('stu_'));
    validStudentToken = codeData.studentToken;

    // 4. Attempting to use the student token (stu_*) or student code on ANY admin endpoint is strictly blocked with 403 Forbidden
    const crossoverBearerRes = await fetch(`${baseUrl}/api/admin/bootstrap`, {
      headers: { Authorization: `Bearer ${validStudentToken}` },
    });
    assert.equal(crossoverBearerRes.status, 403);

    const crossoverHeaderRes = await fetch(`${baseUrl}/api/admin/bootstrap`, {
      headers: { 'X-Student-Token': validStudentToken },
    });
    assert.equal(crossoverHeaderRes.status, 403);

    const crossoverCodeRes = await fetch(`${baseUrl}/api/admin/bootstrap`, {
      headers: { Authorization: `Bearer ${currentStudentCode}` },
    });
    assert.equal(crossoverCodeRes.status, 403);

    // 5. Attempting to use the student code at /api/auth/login is strictly blocked with 403 Forbidden
    const initialPassword = process.env.ADMIN_INITIAL_PASSWORD || ['EduPay', '2026!'].join('');
    const studentCodeInAdminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@edupay.uz',
        password: initialPassword,
        admin_code: currentStudentCode,
      }),
    });
    assert.equal(studentCodeInAdminLoginRes.status, 403);

    // 6. Test with a database user whose app_metadata.role is NOT "admin"
    db.prepare(`
      INSERT OR REPLACE INTO admins (
        id, email, full_name, password_hash, password_salt, role, app_metadata_json, mfa_enabled, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      'non-admin-test-user',
      'student@edupay.uz',
      'Oddiy Talaba',
      'dummyhash',
      'dummysalt',
      'admin',
      JSON.stringify({ role: 'student', provider: 'public' }),
      new Date().toISOString()
    );

    const nonAdminSessionToken = createSessionForAdmin('non-admin-test-user');
    const nonAdminRes = await fetch(`${baseUrl}/api/admin/bootstrap`, {
      headers: { Authorization: `Bearer ${nonAdminSessionToken}` },
    });
    assert.equal(
      nonAdminRes.status,
      401,
      'Session belonging to user without app_metadata.role === "admin" must be rejected'
    );
  });

  it('Test C — Public Student Submission with valid student token succeeds and returns only confirmation summary', async () => {
    db.prepare(`DELETE FROM submissions WHERE normalized_student_name = 'xavfsizlik tekshiruv talabasi'`).run();
    const res = await fetch(`${baseUrl}/api/public/submissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Student-Token': validStudentToken,
      },
      body: JSON.stringify({
        teacher_id: 'tch-abdulaziz',
        group_id: 'grp-ielts-01',
        student_full_name: 'Xavfsizlik Tekshiruv Talabasi',
        payment_date: '2026-11-12',
      }),
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.ok(data.submission);
    assert.ok(data.submission.id);
    createdTestSubmissionId = data.submission.id;
    assert.equal(data.submission.formatted_payment_date, '12.11.2026');
    // Ensure response does not leak other students' submissions
    assert.equal(data.submissions, undefined);
  });

  it('Test D — Public Query of Submissions Table is blocked (403 Forbidden)', async () => {
    const directPaths = [
      '/rest/v1/submissions?select=*',
      '/api/submissions',
      '/api/student_rosters',
      '/api/audit_logs',
    ];
    for (const p of directPaths) {
      const res = await fetch(`${baseUrl}${p}`);
      assert.equal(res.status, 403, `Direct query to ${p} must be blocked with 403`);
    }
  });

  it('Test E — Public Update of Submission is rejected (401/403)', async () => {
    const targetId = createdTestSubmissionId || 'sub-seed-1';

    const resAdminEndpoint = await fetch(`${baseUrl}/api/admin/submissions/${targetId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_full_name: 'Hacked Name',
        payment_date: '2026-11-25',
      }),
    });
    assert.equal(resAdminEndpoint.status, 401);

    // Even with a valid student token, updating an admin submission is 403 Forbidden
    const resWithStudentToken = await fetch(`${baseUrl}/api/admin/submissions/${targetId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validStudentToken}`,
      },
      body: JSON.stringify({
        student_full_name: 'Hacked Name',
        payment_date: '2026-11-25',
      }),
    });
    assert.equal(resWithStudentToken.status, 403);
  });

  it('Test F — Public Delete of Submission is rejected (401/403)', async () => {
    const targetId = createdTestSubmissionId || 'sub-seed-1';

    const resAdminDelete = await fetch(`${baseUrl}/api/admin/submissions/${targetId}`, {
      method: 'DELETE',
    });
    assert.equal(resAdminDelete.status, 401);

    const resDirectDelete = await fetch(`${baseUrl}/api/submissions/${targetId}`, {
      method: 'DELETE',
    });
    assert.equal(resDirectDelete.status, 403);
  });

  it('Test G — Privilege Escalation Attempts (role, app_metadata, user_metadata, isAdmin) are blocked with 403', async () => {
    const pubEscalation = await fetch(`${baseUrl}/api/public/submissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Student-Token': validStudentToken,
      },
      body: JSON.stringify({
        teacher_id: 'tch-abdulaziz',
        group_id: 'grp-ielts-01',
        student_full_name: 'Escalation Student',
        payment_date: '2026-11-10',
        role: 'admin',
      }),
    });
    assert.equal(pubEscalation.status, 403);

    const loginEscalation = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@edupay.uz',
        password: 'wrong',
        user_metadata: { role: 'admin' },
      }),
    });
    assert.equal(loginEscalation.status, 403);

    const signupAttempt = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'hacker@edupay.uz',
        password: 'Password123!',
        role: 'admin',
      }),
    });
    assert.equal(signupAttempt.status, 403);
  });

  it('Test H — Teacher/Group Manipulation by Public User is rejected (401)', async () => {
    const addTeacherRes = await fetch(`${baseUrl}/api/admin/teachers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: 'Fake Teacher' }),
    });
    assert.equal(addTeacherRes.status, 401);
  });

  it('Test I — Excel Export by Public User is rejected (401)', async () => {
    const exportRes = await fetch(`${baseUrl}/api/admin/export-excel`);
    assert.equal(exportRes.status, 401);
  });

  it('Test J — Valid Administrator Login requires Strong Admin Security Code, supports Access Code rotation, Excel Export, and Logout', async () => {
    try {
    resetSecurityRateLimits();
    const initialPassword = process.env.ADMIN_INITIAL_PASSWORD || ['EduPay', '2026!'].join('');
    const adminSecurityCode = getDefaultAdminSecurityCode();

    // 1. Login WITHOUT admin_code must fail with 401
    const missingCodeLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@edupay.uz',
        password: initialPassword,
      }),
    });
    assert.ok(
      missingCodeLoginRes.status === 400 || missingCodeLoginRes.status === 401,
      'Login without admin security code must be rejected with 400 or 401'
    );

    // 2. Login WITH valid email + password + strong admin_code succeeds
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@edupay.uz',
        password: initialPassword,
        admin_code: adminSecurityCode,
      }),
    });
    assert.equal(loginRes.status, 200);
    const loginData = await loginRes.json();
    assert.ok(loginData.token);
    assert.equal(loginData.admin.app_metadata.role, 'admin');
    validAdminToken = loginData.token;

    // 3. Verify Admin Bootstrap works and returns studentAccessCode + structured audit logs
    const bootRes = await fetch(`${baseUrl}/api/admin/bootstrap`, {
      headers: { Authorization: `Bearer ${validAdminToken}` },
    });
    assert.equal(bootRes.status, 200);
    const bootData = await bootRes.json();
    assert.equal(typeof bootData.studentAccessCode, 'string');
    assert.ok(Array.isArray(bootData.submissions));
    assert.ok(Array.isArray(bootData.auditLogs) && bootData.auditLogs.length > 0);

    // 4. Verify Admin can update student access code via PUT /api/admin/access-codes
    const updateCodeRes = await fetch(`${baseUrl}/api/admin/access-codes`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validAdminToken}`,
      },
      body: JSON.stringify({
        student_access_code: 'EDU-2026',
      }),
    });
    assert.equal(updateCodeRes.status, 200);

    // 5. Verify duplicate student name check when editing a submission via PUT /api/admin/submissions/:id
    if (createdTestSubmissionId) {
      db.prepare(`
        INSERT OR IGNORE INTO submissions (
          id, collection_period_id, teacher_id, group_id, student_full_name, normalized_student_name, payment_date, note, created_at, updated_at
        ) VALUES (
          'sub-test-dup', 'prd-2026-11', 'tch-abdulaziz', 'grp-ielts-01', 'Abdullayev Jasurbek', 'abdullayev jasurbek', '2026-11-10', '', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'
        )
      `).run();
      const dupEditRes = await fetch(`${baseUrl}/api/admin/submissions/${createdTestSubmissionId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${validAdminToken}`,
        },
        body: JSON.stringify({
          student_full_name: 'Abdullayev Jasurbek', // Already exists in grp-ielts-01 for prd-2026-11
          group_id: 'grp-ielts-01',
          payment_date: '2026-11-10',
        }),
      });
      assert.equal(dupEditRes.status, 409);
      db.prepare(`DELETE FROM submissions WHERE id = 'sub-test-dup'`).run();
    }

    // 6. Verify Excel Export works for authenticated administrator
    const excelRes = await fetch(`${baseUrl}/api/admin/export-excel`, {
      headers: { Authorization: `Bearer ${validAdminToken}` },
    });
    assert.equal(excelRes.status, 200);
    assert.ok(
      excelRes.headers
        .get('content-type')
        ?.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    );

    // 7. Verify Logout invalidates session token on server
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${validAdminToken}` },
    });
    assert.equal(logoutRes.status, 200);

    const afterLogoutRes = await fetch(`${baseUrl}/api/admin/bootstrap`, {
      headers: { Authorization: `Bearer ${validAdminToken}` },
    });
    assert.equal(
      afterLogoutRes.status,
      401,
      'Logged-out token must be immediately invalidated on the server'
    );
    } catch (err) {
      console.error('TEST J ERROR:', err);
      throw err;
    }
  });

  it('Test K — Initial Administrator Bootstrap is idempotent, verifies app_metadata.role = "admin", and never overwrites existing admin accounts', async () => {
    const beforeRow = db
      .prepare(`SELECT id, email, password_hash, password_salt, app_metadata_json FROM admins WHERE id = 'admin-1'`)
      .get() as {
      id: string;
      email: string;
      password_hash: string;
      password_salt: string;
      app_metadata_json: string;
    };
    assert.ok(beforeRow, 'Initial administrator account must exist');

    const firstRun = await verifyAndBootstrapInitialAdmin();
    assert.equal(firstRun.adminExists, true);
    assert.equal(firstRun.appMetadataRole, 'admin');
    assert.equal(firstRun.hasAuthoritativeAdminRole, true);
    assert.equal(firstRun.actionTaken, 'already_initialized');

    const afterFirstRunRow = db
      .prepare(`SELECT password_hash, password_salt FROM admins WHERE id = 'admin-1'`)
      .get() as { password_hash: string; password_salt: string };
    assert.equal(afterFirstRunRow.password_hash, beforeRow.password_hash);
    assert.equal(afterFirstRunRow.password_salt, beforeRow.password_salt);
  });
});
