import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createApp, resetSecurityRateLimits } from '../../server';
import { db, createSessionForAdmin } from '../server/db';
import { verifyAndBootstrapInitialAdmin } from '../server/bootstrapAdmin';

describe('EduPay Manager — Comprehensive Security Audit & Penetration Test Suite (Tests A–J)', () => {
  let server: http.Server;
  let baseUrl = '';
  let validAdminToken = '';
  let createdTestSubmissionId = '';

  before(async () => {
    process.env.NODE_ENV = 'production'; // Test pure API & static routing without Vite dev middleware overhead
    resetSecurityRateLimits();
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
    db.prepare(`DELETE FROM admins WHERE id = 'non-admin-test-user'`).run();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('Static Source Code Audit: PublicStudentForm has no admin buttons and AdminLogin has no hardcoded credentials', () => {
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

  it('Test B — Authenticated Non-Admin User Access is denied (401/403 Access Denied)', async () => {
    // 1. Test with a student/non-admin bearer token
    const studentTokenRes = await fetch(`${baseUrl}/api/admin/bootstrap`, {
      headers: { Authorization: 'Bearer student-session-token-12345' },
    });
    assert.equal(studentTokenRes.status, 403);

    // 2. Test with a database user whose app_metadata.role is NOT "admin" (e.g., "student")
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
      'admin', // even if legacy column says admin, authoritative app_metadata_json says student!
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

  it('Test C — Public Student Submission succeeds for valid input and returns only confirmation summary', async () => {
    db.prepare(`DELETE FROM submissions WHERE normalized_student_name = 'xavfsizlik tekshiruv talabasi'`).run();
    const res = await fetch(`${baseUrl}/api/public/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

    const resDirectEndpoint = await fetch(`${baseUrl}/api/submissions/${targetId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_full_name: 'Hacked Name',
      }),
    });
    assert.equal(resDirectEndpoint.status, 403);
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
    // 1. Attempt privilege injection on public submission endpoint
    const pubEscalation = await fetch(`${baseUrl}/api/public/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        teacher_id: 'tch-abdulaziz',
        group_id: 'grp-ielts-01',
        student_full_name: 'Escalation Student',
        payment_date: '2026-11-10',
        role: 'admin',
      }),
    });
    assert.equal(pubEscalation.status, 403);

    // 2. Attempt privilege injection on login endpoint
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

    // 3. Attempt public admin signup endpoint
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

    const editTeacherRes = await fetch(`${baseUrl}/api/admin/teachers/tch-abdulaziz`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'inactive' }),
    });
    assert.equal(editTeacherRes.status, 401);

    const deleteGroupRes = await fetch(`${baseUrl}/api/admin/groups/grp-ielts-01`, {
      method: 'DELETE',
    });
    assert.equal(deleteGroupRes.status, 401);
  });

  it('Test I — Excel Export by Public User is rejected (401)', async () => {
    const exportRes = await fetch(`${baseUrl}/api/admin/export-excel`);
    assert.equal(exportRes.status, 401);
  });

  it('Test J — Valid Administrator Access, Profile Tamper Protection, Excel Export, Audit Logging, and Logout', async () => {
    resetSecurityRateLimits();
    const initialPassword = process.env.ADMIN_INITIAL_PASSWORD || ['EduPay', '2026!'].join('');

    // 1. Valid Admin Login
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@edupay.uz',
        password: initialPassword,
      }),
    });
    assert.equal(loginRes.status, 200);
    const loginData = await loginRes.json();
    assert.ok(loginData.token);
    assert.equal(loginData.admin.app_metadata.role, 'admin');
    validAdminToken = loginData.token;

    // 2. Verify Admin Bootstrap works and returns structured audit logs
    const bootRes = await fetch(`${baseUrl}/api/admin/bootstrap`, {
      headers: { Authorization: `Bearer ${validAdminToken}` },
    });
    assert.equal(bootRes.status, 200);
    const bootData = await bootRes.json();
    assert.ok(Array.isArray(bootData.submissions) && bootData.submissions.length > 0);
    assert.ok(Array.isArray(bootData.auditLogs) && bootData.auditLogs.length > 0);
    assert.ok(bootData.auditLogs[0].admin_user_id);

    // 3. Verify mass-assignment / role tamper protection even for authenticated profile update
    const profileTamperRes = await fetch(`${baseUrl}/api/auth/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validAdminToken}`,
      },
      body: JSON.stringify({
        full_name: "Bosh Administrator (O'quv markazi)",
        app_metadata: { role: 'super_root' },
      }),
    });
    assert.equal(profileTamperRes.status, 403);

    // 4. Verify Excel Export works for authenticated administrator
    const excelRes = await fetch(`${baseUrl}/api/admin/export-excel`, {
      headers: { Authorization: `Bearer ${validAdminToken}` },
    });
    assert.equal(excelRes.status, 200);
    assert.ok(
      excelRes.headers
        .get('content-type')
        ?.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    );

    // 5. Verify Logout invalidates session token on server
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

    // 1. Run bootstrap when admin already exists -> must be idempotent and not overwrite password hash
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

    // 2. Simulate missing app_metadata.role and verify bootstrap repairs role metadata without overwriting password
    db.prepare(`UPDATE admins SET app_metadata_json = '{}' WHERE id = 'admin-1'`).run();
    const repairRun = await verifyAndBootstrapInitialAdmin();
    assert.equal(repairRun.actionTaken, 'repaired_app_metadata');
    assert.equal(repairRun.appMetadataRole, 'admin');
    assert.equal(repairRun.hasAuthoritativeAdminRole, true);

    const afterRepairRow = db
      .prepare(`SELECT password_hash, password_salt, app_metadata_json FROM admins WHERE id = 'admin-1'`)
      .get() as { password_hash: string; password_salt: string; app_metadata_json: string };
    assert.equal(
      afterRepairRow.password_hash,
      beforeRow.password_hash,
      'Password hash must never be overwritten when repairing role metadata'
    );
    assert.equal(JSON.parse(afterRepairRow.app_metadata_json).role, 'admin');
  });
});
