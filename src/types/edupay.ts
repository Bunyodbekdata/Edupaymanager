export type RecordStatus = 'active' | 'inactive' | 'archived';
export type PeriodStatus = 'active' | 'closed' | 'inactive';

export interface AdminAppMetadata {
  role: 'admin';
  provider: 'edupay_server_auth' | 'supabase_auth';
}

export interface AdminUser {
  id: string;
  email: string;
  full_name: string;
  role: 'admin';
  app_metadata: AdminAppMetadata;
  mfa_enabled?: boolean;
  created_at: string;
}

export interface Teacher {
  id: string;
  full_name: string;
  subject?: string;
  phone?: string;
  status: RecordStatus;
  created_at: string;
}

export interface Group {
  id: string;
  group_name: string;
  teacher_id: string;
  schedule_info?: string;
  status: RecordStatus;
  created_at: string;
}

export interface CollectionPeriod {
  id: string;
  month_name: string;
  month_number: number; // 1-12
  year: number;
  title: string; // e.g. "Noyabr 2026"
  start_date: string; // YYYY-MM-DD (submission opening date)
  closing_date: string; // YYYY-MM-DD (submission closing date)
  allowed_payment_start_date: string; // YYYY-MM-DD
  allowed_payment_end_date: string; // YYYY-MM-DD
  status: PeriodStatus;
  created_at: string;
}

export interface Submission {
  id: string;
  collection_period_id: string;
  teacher_id: string;
  group_id: string;
  student_full_name: string;
  normalized_student_name: string;
  payment_date: string; // YYYY-MM-DD
  note?: string;
  created_at: string;
  updated_at: string;
}

export interface SubmissionEnriched extends Submission {
  teacher_name: string;
  group_name: string;
  period_title: string;
}

export interface StudentRoster {
  id: string;
  group_id: string;
  student_names: string[];
  updated_at: string;
}

export interface AuditLog {
  id: string;
  admin_user_id: string;
  admin_email: string;
  action: string;
  affected_record_id: string | null;
  details: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface PublicAppContext {
  activePeriod: {
    id: string;
    title: string;
    month_name: string;
    month_number: number;
    year: number;
    start_date: string;
    closing_date: string;
    allowed_payment_start_date: string;
    allowed_payment_end_date: string;
    status: PeriodStatus;
  } | null;
  teachers: Array<{
    id: string;
    full_name: string;
    subject?: string;
  }>;
  groups: Array<{
    id: string;
    group_name: string;
    teacher_id: string;
    schedule_info?: string;
  }>;
}

export interface DashboardBootstrapData {
  admin: AdminUser;
  teachers: Teacher[];
  groups: Group[];
  periods: CollectionPeriod[];
  submissions: Submission[];
  rosters: StudentRoster[];
  auditLogs: AuditLog[];
}
