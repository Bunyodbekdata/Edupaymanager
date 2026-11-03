/**
 * SECURE, IDEMPOTENT SERVER-SIDE ADMINISTRATOR INITIALIZATION & VERIFICATION SCRIPT
 *
 * Usage:
 *   npx tsx scripts/create-admin.ts
 *
 * Environment Variables Used (Server-Only):
 *   - ADMIN_INITIAL_EMAIL
 *   - ADMIN_INITIAL_PASSWORD
 *   - SUPABASE_SERVICE_ROLE_KEY (with SUPABASE_URL / VITE_SUPABASE_URL)
 *
 * Security & Idempotency Guarantees:
 *   - Never exposes SUPABASE_SERVICE_ROLE_KEY or passwords in logs or browser responses.
 *   - Does NOT overwrite existing administrator accounts or passwords.
 *   - Ensures authoritative `app_metadata.role = "admin"` is set.
 *   - Preserves all existing database records.
 */

import * as dotenv from 'dotenv';
import { verifyAndBootstrapInitialAdmin } from '../src/server/bootstrapAdmin';

dotenv.config();

async function runBootstrapVerification() {
  const result = await verifyAndBootstrapInitialAdmin();

  console.log('=== EDUPAY MANAGER: ADMIN BOOTSTRAP VERIFICATION ===');
  console.log(`Admin Exists:                ${result.adminExists}`);
  console.log(`Admin ID:                    ${result.adminId}`);
  console.log(`Admin Email:                 ${result.adminEmail}`);
  console.log(`app_metadata.role:           "${result.appMetadataRole}"`);
  console.log(`Authoritative Role Verified: ${result.hasAuthoritativeAdminRole}`);
  console.log(`Bootstrap Action:            ${result.actionTaken}`);
  console.log(`Supabase Auth Sync Status:   ${result.supabaseAuthStatus}`);
  console.log('====================================================');
}

runBootstrapVerification().catch((err) => {
  console.error('Admin bootstrap verification error:', err instanceof Error ? err.message : 'Unknown error');
  process.exit(1);
});
