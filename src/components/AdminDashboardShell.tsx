import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  LayoutDashboard,
  Users,
  GraduationCap,
  Layers,
  CalendarRange,
  FileBarChart2,
  Settings,
  LogOut,
  Menu,
  X,
  Send,
  ExternalLink,
  Calendar,
} from 'lucide-react';
import {
  AdminUser,
  DashboardBootstrapData,
} from '../types/edupay';
import { formatDateUz } from '../utils/edupayLogic';
import { DashboardOverview } from './DashboardOverview';
import { StudentsManagementView } from './StudentsManagementView';
import { TeachersManagementView } from './TeachersManagementView';
import { GroupsManagementView } from './GroupsManagementView';
import { MonthlyCollectionsView } from './MonthlyCollectionsView';
import { ReportsAndExportView } from './ReportsAndExportView';
import { SettingsView } from './SettingsView';
import { TelegramShareModal } from './TelegramShareModal';

export type AdminSectionId =
  | 'dashboard'
  | 'students'
  | 'teachers'
  | 'groups'
  | 'collections'
  | 'reports'
  | 'settings';

export const ADMIN_SECTION_PATHS: Record<AdminSectionId, string> = {
  dashboard: '/admin',
  students: '/admin/students',
  teachers: '/admin/teachers',
  groups: '/admin/groups',
  collections: '/admin/collections',
  reports: '/admin/reports',
  settings: '/admin/settings',
};

export function resolveAdminSectionFromPath(pathname: string): AdminSectionId {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  switch (normalized) {
    case '/admin/students':
      return 'students';
    case '/admin/teachers':
      return 'teachers';
    case '/admin/groups':
      return 'groups';
    case '/admin/collections':
      return 'collections';
    case '/admin/reports':
      return 'reports';
    case '/admin/settings':
      return 'settings';
    default:
      return 'dashboard';
  }
}

interface AdminDashboardShellProps {
  token: string;
  initialAdmin: AdminUser;
  activeSection: AdminSectionId;
  onNavigateSection: (section: AdminSectionId) => void;
  onLogout: () => void;
  onSwitchToPublicView: () => void;
}

export const AdminDashboardShell: React.FC<AdminDashboardShellProps> = ({
  token,
  initialAdmin,
  activeSection,
  onNavigateSection,
  onLogout,
  onSwitchToPublicView,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [telegramModalOpen, setTelegramModalOpen] = useState(false);
  const [reportTargetPeriodId, setReportTargetPeriodId] = useState<string | undefined>(undefined);

  const [data, setData] = useState<DashboardBootstrapData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBootstrapData = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/bootstrap', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.status === 401 || res.status === 403) {
        onLogout();
        return;
      }
      if (!res.ok) {
        throw new Error("Ma'lumotlarni yuklab bo'lmadi.");
      }
      const payload: DashboardBootstrapData = await res.json();
      setData(payload);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Tarmoq xatoligi yuz berdi.');
    } finally {
      setLoading(false);
    }
  }, [token, onLogout]);

  useEffect(() => {
    fetchBootstrapData();
  }, [fetchBootstrapData]);

  const activePeriod = useMemo(
    () => data?.periods.find((p) => p.status === 'active') || null,
    [data]
  );

  const todayFormatted = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return formatDateUz(`${y}-${m}-${d}`);
  }, []);

  const navItems: Array<{ id: AdminSectionId; label: string; icon: React.ComponentType<any> }> = [
    { id: 'dashboard', label: 'Bosh sahifa', icon: LayoutDashboard },
    { id: 'students', label: "O'quvchilar", icon: Users },
    { id: 'teachers', label: "O'qituvchilar", icon: GraduationCap },
    { id: 'groups', label: 'Guruhlar', icon: Layers },
    { id: 'collections', label: "Oylik yig'imlar", icon: CalendarRange },
    { id: 'reports', label: 'Oylik hisobotlar', icon: FileBarChart2 },
    { id: 'settings', label: 'Sozlamalar', icon: Settings },
  ];

  const handleSelectNav = (id: AdminSectionId) => {
    onNavigateSection(id);
    setMobileMenuOpen(false);
  };

  const handleOpenReportsForPeriod = (periodId: string) => {
    setReportTargetPeriodId(periodId);
    onNavigateSection('reports');
  };

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="no-print hidden lg:flex lg:flex-col lg:sticky lg:top-0 lg:h-screen w-64 bg-slate-900 text-slate-100 shrink-0 border-r border-slate-800">
        <div className="px-6 py-5 border-b border-slate-800 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-sky-500 text-white font-bold text-sm flex items-center justify-center shrink-0">
            EP
          </div>
          <div>
            <div className="text-base font-bold tracking-tight text-white">EduPay Manager</div>
            <div className="text-xs text-slate-400">Boshqaruv tizimi</div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectNav(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-sky-600 text-white font-semibold'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-800 space-y-1.5">
          <button
            type="button"
            onClick={() => setTelegramModalOpen(true)}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-sky-300 hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <Send className="w-4 h-4 shrink-0" />
            <span>Telegramga ulashish</span>
          </button>

          <button
            type="button"
            onClick={onSwitchToPublicView}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-medium text-slate-300 hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <ExternalLink className="w-4 h-4 shrink-0" />
            <span>O&apos;quvchi formasi (Ommaviy)</span>
          </button>

          <button
            type="button"
            onClick={onLogout}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-red-400 hover:bg-red-950/50 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span>Tizimdan chiqish</span>
          </button>
        </div>
      </aside>

      {/* Mobile Drawer Navigation */}
      {mobileMenuOpen && (
        <div className="no-print fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/50"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-10 w-72 max-w-full bg-slate-900 text-white flex flex-col h-full">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-sky-500 text-white font-bold text-xs flex items-center justify-center">
                  EP
                </div>
                <span className="font-bold text-base">EduPay Manager</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Menyuni yopish"
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <nav className="flex-1 p-3 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectNav(item.id)}
                    className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-sky-600 text-white font-semibold'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>

            <div className="p-3 border-t border-slate-800 space-y-1.5">
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  setTelegramModalOpen(true);
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-sky-300 hover:bg-slate-800"
              >
                <Send className="w-4 h-4 shrink-0" />
                <span>Telegramga ulashish</span>
              </button>

              <button
                type="button"
                onClick={onSwitchToPublicView}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-medium text-slate-300 hover:bg-slate-800"
              >
                <ExternalLink className="w-4 h-4 shrink-0" />
                <span>O&apos;quvchi sahifasi</span>
              </button>

              <button
                type="button"
                onClick={onLogout}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-red-400 hover:bg-red-950/50"
              >
                <LogOut className="w-4 h-4 shrink-0" />
                <span>Tizimdan chiqish</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Dashboard Header */}
        <header className="no-print bg-white border-b border-slate-200 px-4 sm:px-8 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Menyuni ochish"
              className="lg:hidden p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 text-xs sm:text-sm text-slate-600">
              <span className="font-bold text-slate-900 lg:hidden">EduPay Manager</span>
              <span className="hidden lg:inline font-medium text-slate-500">
                Faol yig&apos;im oyi:
              </span>
              <span className="font-semibold text-slate-900">
                {activePeriod ? activePeriod.title : "Faol oy yo'q"}
              </span>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <span className="hidden sm:inline-flex items-center gap-1 font-mono text-xs text-slate-500 tabular-nums">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span>Bugun: {todayFormatted}</span>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <div className="text-xs font-semibold text-slate-900">
                {data?.admin.full_name || initialAdmin.full_name}
              </div>
              <div className="text-xs text-slate-500 font-mono">
                {data?.admin.email || initialAdmin.email}
              </div>
            </div>

            <button
              type="button"
              onClick={onSwitchToPublicView}
              className="px-3 py-1.5 border border-slate-200 hover:bg-slate-50 rounded-lg text-xs font-medium text-slate-700 whitespace-nowrap shrink-0 cursor-pointer"
            >
              O&apos;quvchi formasi
            </button>
          </div>
        </header>

        {/* Viewport Body */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {loading ? (
            <div className="space-y-4">
              <div className="h-8 w-64 bg-slate-200 rounded animate-pulse" />
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div className="h-28 bg-white border border-slate-200 rounded-xl animate-pulse" />
                <div className="h-28 bg-white border border-slate-200 rounded-xl animate-pulse" />
                <div className="h-28 bg-white border border-slate-200 rounded-xl animate-pulse" />
                <div className="h-28 bg-white border border-slate-200 rounded-xl animate-pulse" />
              </div>
              <div className="h-96 bg-white border border-slate-200 rounded-xl animate-pulse" />
            </div>
          ) : error || !data ? (
            <div className="bg-white border border-red-200 rounded-xl p-6 text-center space-y-3">
              <p className="text-sm text-red-700">{error || "Ma'lumotlar topilmadi."}</p>
              <button
                type="button"
                onClick={fetchBootstrapData}
                className="px-4 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg"
              >
                Qayta urinish
              </button>
            </div>
          ) : (
            <>
              {activeSection === 'dashboard' && (
                <DashboardOverview
                  token={token}
                  teachers={data.teachers}
                  groups={data.groups}
                  periods={data.periods}
                  submissions={data.submissions}
                  onRefresh={fetchBootstrapData}
                  onOpenTelegramModal={() => setTelegramModalOpen(true)}
                  onNavigateToSection={(sec) => onNavigateSection(sec as AdminSectionId)}
                />
              )}

              {activeSection === 'students' && (
                <StudentsManagementView
                  token={token}
                  teachers={data.teachers}
                  groups={data.groups}
                  periods={data.periods}
                  submissions={data.submissions}
                  rosters={data.rosters}
                  onRefresh={fetchBootstrapData}
                />
              )}

              {activeSection === 'teachers' && (
                <TeachersManagementView
                  token={token}
                  teachers={data.teachers}
                  groups={data.groups}
                  submissions={data.submissions}
                  onRefresh={fetchBootstrapData}
                />
              )}

              {activeSection === 'groups' && (
                <GroupsManagementView
                  token={token}
                  teachers={data.teachers}
                  groups={data.groups}
                  submissions={data.submissions}
                  periods={data.periods}
                  onRefresh={fetchBootstrapData}
                />
              )}

              {activeSection === 'collections' && (
                <MonthlyCollectionsView
                  token={token}
                  periods={data.periods}
                  submissions={data.submissions}
                  teachers={data.teachers}
                  groups={data.groups}
                  onRefresh={fetchBootstrapData}
                  onOpenReportsForPeriod={handleOpenReportsForPeriod}
                />
              )}

              {activeSection === 'reports' && (
                <ReportsAndExportView
                  token={token}
                  periods={data.periods}
                  teachers={data.teachers}
                  groups={data.groups}
                  submissions={data.submissions}
                  initialPeriodId={reportTargetPeriodId}
                />
              )}

              {activeSection === 'settings' && (
                <SettingsView
                  token={token}
                  admin={data.admin}
                  studentAccessCode={data.studentAccessCode}
                  auditLogs={data.auditLogs}
                  onRefresh={fetchBootstrapData}
                />
              )}
            </>
          )}
        </main>
      </div>

      <TelegramShareModal
        isOpen={telegramModalOpen}
        onClose={() => setTelegramModalOpen(false)}
        activePeriod={activePeriod}
        studentAccessCode={data?.studentAccessCode}
      />
    </div>
  );
};
