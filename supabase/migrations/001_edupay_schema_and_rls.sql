-- ============================================================================
-- EDUPAY MANAGER — SUPABASE / POSTGRESQL DATABASE SCHEMA & RLS POLICIES
-- ============================================================================

-- 1. ADMINS TABLE
CREATE TABLE IF NOT EXISTS public.admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'super_admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. TEACHERS TABLE
CREATE TABLE IF NOT EXISTS public.teachers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  subject TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. GROUPS TABLE
CREATE TABLE IF NOT EXISTS public.groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_name TEXT NOT NULL,
  teacher_id UUID NOT NULL REFERENCES public.teachers(id) ON DELETE RESTRICT,
  schedule_info TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. COLLECTION PERIODS TABLE
CREATE TABLE IF NOT EXISTS public.collection_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month_name TEXT NOT NULL,
  month_number SMALLINT NOT NULL CHECK (month_number BETWEEN 1 AND 12),
  year SMALLINT NOT NULL CHECK (year BETWEEN 2020 AND 2100),
  title TEXT NOT NULL,
  start_date DATE NOT NULL,
  closing_date DATE NOT NULL,
  allowed_payment_start_date DATE NOT NULL,
  allowed_payment_end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('active', 'closed', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. SUBMISSIONS TABLE
CREATE TABLE IF NOT EXISTS public.submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_period_id UUID NOT NULL REFERENCES public.collection_periods(id) ON DELETE RESTRICT,
  teacher_id UUID NOT NULL REFERENCES public.teachers(id) ON DELETE RESTRICT,
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE RESTRICT,
  student_full_name TEXT NOT NULL,
  normalized_student_name TEXT NOT NULL,
  payment_date DATE NOT NULL,
  note TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. STUDENT ROSTERS TABLE
CREATE TABLE IF NOT EXISTS public.student_rosters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL UNIQUE REFERENCES public.groups(id) ON DELETE CASCADE,
  student_names JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. AUDIT LOGS TABLE
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_email TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_groups_teacher_id ON public.groups(teacher_id);
CREATE INDEX IF NOT EXISTS idx_submissions_period_id ON public.submissions(collection_period_id);
CREATE INDEX IF NOT EXISTS idx_submissions_teacher_id ON public.submissions(teacher_id);
CREATE INDEX IF NOT EXISTS idx_submissions_group_id ON public.submissions(group_id);
CREATE INDEX IF NOT EXISTS idx_submissions_duplicate_lookup
  ON public.submissions(collection_period_id, group_id, normalized_student_name);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_rosters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Helper function to check if current user is an authenticated administrator
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admins
    WHERE auth_user_id = auth.uid()
  );
$$;

-- Public read policies for active teachers, groups, and active collection period ONLY
CREATE POLICY "Public can view active teachers"
  ON public.teachers FOR SELECT
  USING (status = 'active' OR public.is_admin());

CREATE POLICY "Public can view active groups"
  ON public.groups FOR SELECT
  USING (status = 'active' OR public.is_admin());

CREATE POLICY "Public can view active collection periods"
  ON public.collection_periods FOR SELECT
  USING (status = 'active' OR public.is_admin());

-- Public submission policy: students can ONLY insert when collection period is active,
-- and can NEVER SELECT/UPDATE/DELETE from public.submissions!
CREATE POLICY "Public can insert submission for active period"
  ON public.submissions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.collection_periods cp
      WHERE cp.id = collection_period_id
        AND cp.status = 'active'
        AND payment_date BETWEEN cp.allowed_payment_start_date AND cp.allowed_payment_end_date
    )
    AND EXISTS (
      SELECT 1 FROM public.groups g
      WHERE g.id = group_id
        AND g.teacher_id = submissions.teacher_id
        AND g.status = 'active'
    )
  );

-- Admin full access policies
CREATE POLICY "Admins have full access to admins"
  ON public.admins FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins have full access to teachers"
  ON public.teachers FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins have full access to groups"
  ON public.groups FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins have full access to collection_periods"
  ON public.collection_periods FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins have full access to submissions"
  ON public.submissions FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins have full access to student_rosters"
  ON public.student_rosters FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins have full access to audit_logs"
  ON public.audit_logs FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
