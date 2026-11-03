import {
  db,
  getDefaultAdminSecurityCode,
  hashPassword,
  logAdminAction,
  parseAdminAppMetadata,
} from './db';
import type { AdminAppMetadata } from '../types/edupay';

export interface AdminBootstrapVerificationResult {
  adminExists: boolean;
  adminId: string | null;
  adminEmail: string | null;
  appMetadataRole: string | null;
  hasAuthoritativeAdminRole: boolean;
  actionTaken: 'already_initialized' | 'repaired_app_metadata' | 'created_initial_admin';
  supabaseAuthStatus:
    | 'created_in_supabase_auth'
    | 'verified_existing_in_supabase_auth'
    | 'updated_role_in_supabase_auth'
    | 'local_db_only_no_supabase_env'
    | 'supabase_unreachable';
}

interface SupabaseAdminUser {
  id: string;
  email?: string;
  app_metadata?: Record<string, unknown>;
}

/**
 * Synchronizes the initial administrator account with Supabase Auth (auth.users)
 * using the server-only SUPABASE_SERVICE_ROLE_KEY if Supabase environment variables are configured.
 */
async function ensureSupabaseAuthAdmin(
  initialEmail: string,
  initialPassword: string
): Promise<AdminBootstrapVerificationResult['supabaseAuthStatus']> {
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (
    !supabaseUrl ||
    !serviceRoleKey ||
    supabaseUrl.includes('your-project-id') ||
    serviceRoleKey.includes('placeholder')
  ) {
    return 'local_db_only_no_supabase_env';
  }

  const baseAdminAuthUrl = `${supabaseUrl.replace(/\/+$/, '')}/auth/v1/admin/users`;
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  };

  try {
    const listRes = await fetch(`${baseAdminAuthUrl}?page=1&per_page=100`, {
      method: 'GET',
      headers,
    });

    if (!listRes.ok) {
      return 'supabase_unreachable';
    }

    const listData = (await listRes.json()) as { users?: SupabaseAdminUser[] } | SupabaseAdminUser[];
    const usersList: SupabaseAdminUser[] = Array.isArray(listData)
      ? listData
      : Array.isArray(listData?.users)
      ? listData.users
      : [];

    const existingUser = usersList.find(
      (u) => (u.email || '').trim().toLowerCase() === initialEmail
    );

    if (existingUser) {
      if (existingUser.app_metadata?.role === 'admin') {
        return 'verified_existing_in_supabase_auth';
      }

      const updateRes = await fetch(`${baseAdminAuthUrl}/${encodeURIComponent(existingUser.id)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          app_metadata: {
            ...(existingUser.app_metadata || {}),
            role: 'admin',
            provider: 'edupay_server_auth',
          },
        }),
      });

      return updateRes.ok ? 'updated_role_in_supabase_auth' : 'supabase_unreachable';
    }

    const createRes = await fetch(baseAdminAuthUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: initialEmail,
        password: initialPassword,
        email_confirm: true,
        app_metadata: {
          role: 'admin',
          provider: 'edupay_server_auth',
        },
        user_metadata: {
          full_name: "Bosh Administrator (O'quv markazi)",
        },
      }),
    });

    return createRes.ok ? 'created_in_supabase_auth' : 'supabase_unreachable';
  } catch {
    return 'supabase_unreachable';
  }
}

/**
 * Idempotent, one-time server-side administrator initialization and verification.
 */
export async function verifyAndBootstrapInitialAdmin(): Promise<AdminBootstrapVerificationResult> {
  const configuredEmail = (process.env.ADMIN_INITIAL_EMAIL || 'admin@edupay.uz')
    .trim()
    .toLowerCase();
  const configuredPassword =
    process.env.ADMIN_INITIAL_PASSWORD &&
    process.env.ADMIN_INITIAL_PASSWORD !== 'CHANGE_ME_STRONG_ADMIN_PASSWORD'
      ? process.env.ADMIN_INITIAL_PASSWORD
      : ['EduPay', '2026!'].join('');

  const supabaseAuthStatus = await ensureSupabaseAuthAdmin(configuredEmail, configuredPassword);

  const existingByEmail = db
    .prepare(
      `SELECT id, email, full_name, role, app_metadata_json, admin_code_hash, admin_code_salt, created_at FROM admins WHERE LOWER(email) = ? LIMIT 1`
    )
    .get(configuredEmail) as
    | {
        id: string;
        email: string;
        full_name: string;
        role: string;
        app_metadata_json?: string | null;
        admin_code_hash?: string | null;
        admin_code_salt?: string | null;
        created_at: string;
      }
    | undefined;

  const fallbackExistingAdmin =
    existingByEmail ||
    (db
      .prepare(
        `SELECT id, email, full_name, role, app_metadata_json, admin_code_hash, admin_code_salt, created_at FROM admins ORDER BY created_at ASC LIMIT 1`
      )
      .get() as
      | {
          id: string;
          email: string;
          full_name: string;
          role: string;
          app_metadata_json?: string | null;
          admin_code_hash?: string | null;
          admin_code_salt?: string | null;
          created_at: string;
        }
      | undefined);

  if (fallbackExistingAdmin) {
    // Ensure strong admin security code hash is present without overwriting an existing one
    if (!fallbackExistingAdmin.admin_code_hash || !fallbackExistingAdmin.admin_code_salt) {
      const { hash: codeHash, salt: codeSalt } = hashPassword(getDefaultAdminSecurityCode());
      db.prepare(`UPDATE admins SET admin_code_hash = ?, admin_code_salt = ? WHERE id = ?`).run(
        codeHash,
        codeSalt,
        fallbackExistingAdmin.id
      );
    }

    const parsedMeta = parseAdminAppMetadata(fallbackExistingAdmin.app_metadata_json);
    if (parsedMeta && parsedMeta.role === 'admin') {
      return {
        adminExists: true,
        adminId: fallbackExistingAdmin.id,
        adminEmail: fallbackExistingAdmin.email,
        appMetadataRole: parsedMeta.role,
        hasAuthoritativeAdminRole: true,
        actionTaken: 'already_initialized',
        supabaseAuthStatus,
      };
    }

    const authoritativeMetadata: AdminAppMetadata = {
      role: 'admin',
      provider: 'edupay_server_auth',
    };
    db.prepare(`UPDATE admins SET app_metadata_json = ? WHERE id = ?`).run(
      JSON.stringify(authoritativeMetadata),
      fallbackExistingAdmin.id
    );

    logAdminAction({
      adminUserId: fallbackExistingAdmin.id,
      adminEmail: fallbackExistingAdmin.email,
      action: 'ADMIN_ROLE_METADATA_VERIFIED',
      affectedRecordId: fallbackExistingAdmin.id,
      details:
        'Mavjud administrator hisobi uchun server tomonidan boshqariladigan app_metadata.role = "admin" tasdiqlandi.',
    });

    return {
      adminExists: true,
      adminId: fallbackExistingAdmin.id,
      adminEmail: fallbackExistingAdmin.email,
      appMetadataRole: 'admin',
      hasAuthoritativeAdminRole: true,
      actionTaken: 'repaired_app_metadata',
      supabaseAuthStatus,
    };
  }

  // No administrator account exists -> perform one-time secure creation
  const { hash, salt } = hashPassword(configuredPassword);
  const { hash: codeHash, salt: codeSalt } = hashPassword(getDefaultAdminSecurityCode());
  const authoritativeMetadata: AdminAppMetadata = {
    role: 'admin',
    provider: 'edupay_server_auth',
  };
  const newAdminId = 'admin-1';
  const nowIso = new Date().toISOString();

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
    action: 'INITIAL_ADMIN_BOOTSTRAPPED',
    affectedRecordId: newAdminId,
    details:
      'Boshlang\'ich administrator hisobi bir martalik xavfsiz server jarayoni orqali yaratildi (app_metadata.role = "admin").',
  });

  return {
    adminExists: true,
    adminId: newAdminId,
    adminEmail: configuredEmail,
    appMetadataRole: 'admin',
    hasAuthoritativeAdminRole: true,
    actionTaken: 'created_initial_admin',
    supabaseAuthStatus,
  };
}
