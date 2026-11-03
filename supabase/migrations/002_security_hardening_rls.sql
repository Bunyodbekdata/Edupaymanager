-- =================================================================================
-- EDUPAY MANAGER — COMPREHENSIVE SUPABASE / POSTGRESQL RLS SECURITY UPGRADE
-- Migration: 002_security_hardening_rls.sql
--
-- Security Architecture:
-- 1. Authoritative Admin Role Check:
--    Uses ONLY server-controlled JWT claim: (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
--    NEVER trusts client-editable user_metadata or client-passed role fields.
-- 2. Strict Least-Privilege Table & Column Grants:
--    Revokes default public/anon/authenticated privileges and grants only exact required columns.
-- 3. Public Student Submissions via Server-Side Edge Function / API:
--    Public anonymous users (anon) CANNOT directly SELECT, INSERT, UPDATE, or DELETE on submissions.
--    All student submissions pass through the validated server-side Edge Function / API endpoint.
-- =================================================================================

-- Helper function: authoritative server-side check for verified administrator role
CREATE OR REPLACE FUNCTION public.is_verified_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    FALSE
  );
$$;

-- Upgrade audit_logs table with structured forensic columns if not already present
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS admin_user_id TEXT NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS affected_record_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb;

-- =================================================================================
-- 1. ENABLE & FORCE ROW LEVEL SECURITY ON ALL TABLES
-- =================================================================================
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admins FORCE ROW LEVEL SECURITY;

ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teachers FORCE ROW LEVEL SECURITY;

ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups FORCE ROW LEVEL SECURITY;

ALTER TABLE public.collection_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_periods FORCE ROW LEVEL SECURITY;

ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.student_rosters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_rosters FORCE ROW LEVEL SECURITY;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;

-- =================================================================================
-- 2. REVOKE DEFAULT PERMISSIONS & ENFORCE LEAST-PRIVILEGE COLUMN GRANTS
-- =================================================================================
REVOKE ALL ON public.admins FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.teachers FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.groups FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.collection_periods FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.submissions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.student_rosters FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.audit_logs FROM PUBLIC, anon, authenticated;

-- Public (anon) can ONLY read non-sensitive columns of active teachers, groups, and active period
GRANT SELECT (id, full_name, subject, status) ON public.teachers TO anon;
GRANT SELECT (id, group_name, teacher_id, schedule_info, status) ON public.groups TO anon;
GRANT SELECT (
  id, month_name, month_number, year, title,
  start_date, closing_date, allowed_payment_start_date, allowed_payment_end_date, status
) ON public.collection_periods TO anon;

-- Public (anon) has ZERO direct access to submissions, student_rosters, audit_logs, or admins.
-- Submissions are inserted exclusively via the server-side API / Edge Function using service_role.

-- Authenticated users receive table grants gated strictly by RLS policies checking is_verified_admin()
GRANT SELECT, INSERT, UPDATE, DELETE ON public.teachers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.groups TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.collection_periods TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.submissions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_rosters TO authenticated;
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT SELECT (id, email, full_name, role, created_at) ON public.admins TO authenticated;

-- =================================================================================
-- 3. DROP LEGACY POLICIES BEFORE CREATING STRICT EXPLICIT POLICIES
-- =================================================================================
DROP POLICY IF EXISTS "Public read active teachers" ON public.teachers;
DROP POLICY IF EXISTS "Admin full access teachers" ON public.teachers;
DROP POLICY IF EXISTS "Public read active groups" ON public.groups;
DROP POLICY IF EXISTS "Admin full access groups" ON public.groups;
DROP POLICY IF EXISTS "Public read active collection periods" ON public.collection_periods;
DROP POLICY IF EXISTS "Admin full access collection periods" ON public.collection_periods;
DROP POLICY IF EXISTS "Public insert submissions for active period" ON public.submissions;
DROP POLICY IF EXISTS "Admin full access submissions" ON public.submissions;
DROP POLICY IF EXISTS "Admin full access rosters" ON public.student_rosters;
DROP POLICY IF EXISTS "Admin full access audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Admin full access admins" ON public.admins;

-- =================================================================================
-- 4. TABLE: teachers
-- =================================================================================
-- Public can read ONLY active teachers
CREATE POLICY "teachers_public_select_active"
  ON public.teachers
  FOR SELECT
  TO anon
  USING (status = 'active');

-- Verified Admins can SELECT all teachers
CREATE POLICY "teachers_admin_select"
  ON public.teachers
  FOR SELECT
  TO authenticated
  USING (public.is_verified_admin());

-- Verified Admins can INSERT teachers
CREATE POLICY "teachers_admin_insert"
  ON public.teachers
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_verified_admin());

-- Verified Admins can UPDATE teachers
CREATE POLICY "teachers_admin_update"
  ON public.teachers
  FOR UPDATE
  TO authenticated
  USING (public.is_verified_admin())
  WITH CHECK (public.is_verified_admin());

-- Verified Admins can DELETE teachers
CREATE POLICY "teachers_admin_delete"
  ON public.teachers
  FOR DELETE
  TO authenticated
  USING (public.is_verified_admin());

-- =================================================================================
-- 5. TABLE: groups
-- =================================================================================
-- Public can read ONLY active groups belonging to active teachers
CREATE POLICY "groups_public_select_active"
  ON public.groups
  FOR SELECT
  TO anon
  USING (
    status = 'active'
    AND EXISTS (
      SELECT 1 FROM public.teachers t
      WHERE t.id = groups.teacher_id AND t.status = 'active'
    )
  );

-- Verified Admins can SELECT all groups
CREATE POLICY "groups_admin_select"
  ON public.groups
  FOR SELECT
  TO authenticated
  USING (public.is_verified_admin());

-- Verified Admins can INSERT groups
CREATE POLICY "groups_admin_insert"
  ON public.groups
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_verified_admin());

-- Verified Admins can UPDATE groups
CREATE POLICY "groups_admin_update"
  ON public.groups
  FOR UPDATE
  TO authenticated
  USING (public.is_verified_admin())
  WITH CHECK (public.is_verified_admin());

-- Verified Admins can DELETE groups
CREATE POLICY "groups_admin_delete"
  ON public.groups
  FOR DELETE
  TO authenticated
  USING (public.is_verified_admin());

-- =================================================================================
-- 6. TABLE: collection_periods
-- =================================================================================
-- Public can read ONLY the currently active collection period
CREATE POLICY "periods_public_select_active"
  ON public.collection_periods
  FOR SELECT
  TO anon
  USING (status = 'active');

-- Verified Admins can SELECT all collection periods
CREATE POLICY "periods_admin_select"
  ON public.collection_periods
  FOR SELECT
  TO authenticated
  USING (public.is_verified_admin());

-- Verified Admins can INSERT collection periods
CREATE POLICY "periods_admin_insert"
  ON public.collection_periods
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_verified_admin());

-- Verified Admins can UPDATE collection periods
CREATE POLICY "periods_admin_update"
  ON public.collection_periods
  FOR UPDATE
  TO authenticated
  USING (public.is_verified_admin())
  WITH CHECK (public.is_verified_admin());

-- Verified Admins can DELETE collection periods
CREATE POLICY "periods_admin_delete"
  ON public.collection_periods
  FOR DELETE
  TO authenticated
  USING (public.is_verified_admin());

-- =================================================================================
-- 7. TABLE: submissions (CONFIDENTIAL STUDENT PAYMENT RECORDS)
-- =================================================================================
-- Public (anon) has NO direct SELECT, INSERT, UPDATE, or DELETE policies on submissions.
-- All public submissions are processed through the server-side endpoint / Edge Function.

-- Verified Admins can SELECT all submissions
CREATE POLICY "submissions_admin_select"
  ON public.submissions
  FOR SELECT
  TO authenticated
  USING (public.is_verified_admin());

-- Verified Admins can INSERT submissions
CREATE POLICY "submissions_admin_insert"
  ON public.submissions
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_verified_admin());

-- Verified Admins can UPDATE submissions
CREATE POLICY "submissions_admin_update"
  ON public.submissions
  FOR UPDATE
  TO authenticated
  USING (public.is_verified_admin())
  WITH CHECK (public.is_verified_admin());

-- Verified Admins can DELETE submissions
CREATE POLICY "submissions_admin_delete"
  ON public.submissions
  FOR DELETE
  TO authenticated
  USING (public.is_verified_admin());

-- =================================================================================
-- 8. TABLE: student_rosters (CONFIDENTIAL GROUP ROSTERS)
-- =================================================================================
CREATE POLICY "rosters_admin_select"
  ON public.student_rosters
  FOR SELECT
  TO authenticated
  USING (public.is_verified_admin());

CREATE POLICY "rosters_admin_insert"
  ON public.student_rosters
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_verified_admin());

CREATE POLICY "rosters_admin_update"
  ON public.student_rosters
  FOR UPDATE
  TO authenticated
  USING (public.is_verified_admin())
  WITH CHECK (public.is_verified_admin());

CREATE POLICY "rosters_admin_delete"
  ON public.student_rosters
  FOR DELETE
  TO authenticated
  USING (public.is_verified_admin());

-- =================================================================================
-- 9. TABLE: audit_logs (IMMUTABLE ADMIN AUDIT LOGS)
-- =================================================================================
CREATE POLICY "audit_logs_admin_select"
  ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING (public.is_verified_admin());

CREATE POLICY "audit_logs_admin_insert"
  ON public.audit_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_verified_admin());

-- Note: No UPDATE or DELETE policy on audit_logs so audit trail cannot be tampered with.

-- =================================================================================
-- 10. TABLE: admins
-- =================================================================================
CREATE POLICY "admins_admin_select"
  ON public.admins
  FOR SELECT
  TO authenticated
  USING (public.is_verified_admin());
