import React, { useState, useMemo } from 'react';
import {
  Search,
  Send,
  FileSpreadsheet,
  Calendar,
  Edit2,
  Trash2,
  ArrowUpDown,
  X,
  AlertTriangle,
  CheckCircle2,
  Users,
  GraduationCap,
  FileCheck2,
  Layers,
} from 'lucide-react';
import {
  CollectionPeriod,
  Group,
  Submission,
  Teacher,
} from '../types/edupay';
import {
  compareUzbekNames,
  formatDateTimeUz,
  formatDateUz,
} from '../utils/edupayLogic';
import { generateSubmissionsExcelBuffer } from '../utils/excelExport';

interface DashboardOverviewProps {
  token: string;
  teachers: Teacher[];
  groups: Group[];
  periods: CollectionPeriod[];
  submissions: Submission[];
  onRefresh: () => Promise<void>;
  onOpenTelegramModal: () => void;
  onNavigateToSection: (section: string) => void;
}

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({
  token,
  teachers,
  groups,
  periods,
  submissions,
  onRefresh,
  onOpenTelegramModal,
  onNavigateToSection,
}) => {
  const activePeriod = useMemo(
    () => periods.find((p) => p.status === 'active') || periods[0] || null,
    [periods]
  );

  // Table Filters & Pagination
  const [search, setSearch] = useState('');
  const [periodFilter, setPeriodFilter] = useState<string>(activePeriod?.id || 'all');
  const [teacherFilter, setTeacherFilter] = useState<string>('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('');
  const [sortAsc, setSortAsc] = useState<boolean>(true);
  const [page, setPage] = useState<number>(1);
  const pageSize = 10;

  // Edit & Delete Modals
  const [editingSub, setEditingSub] = useState<Submission | null>(null);
  const [editName, setEditName] = useState('');
  const [editGroupId, setEditGroupId] = useState('');
  const [editDate, setEditDate] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [deletingSub, setDeletingSub] = useState<Submission | null>(null);
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);

  const teacherMap = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers]);
  const groupMap = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);

  // Real database statistics
  const totalSubmissionsCount = submissions.length;
  const totalTeachersCount = useMemo(
    () => teachers.filter((t) => t.status !== 'archived').length,
    [teachers]
  );
  const totalActiveGroupsCount = useMemo(
    () => groups.filter((g) => g.status === 'active').length,
    [groups]
  );
  const currentMonthSubmissionsCount = useMemo(() => {
    if (!activePeriod) return 0;
    return submissions.filter((s) => s.collection_period_id === activePeriod.id).length;
  }, [submissions, activePeriod]);

  const availableGroups = useMemo(() => {
    if (teacherFilter === 'all') return groups;
    return groups.filter((g) => g.teacher_id === teacherFilter);
  }, [groups, teacherFilter]);

  const filteredSubmissions = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = submissions.filter((s) => {
      if (periodFilter !== 'all' && s.collection_period_id !== periodFilter) return false;
      if (teacherFilter !== 'all' && s.teacher_id !== teacherFilter) return false;
      if (groupFilter !== 'all' && s.group_id !== groupFilter) return false;
      if (dateFilter && s.payment_date !== dateFilter) return false;
      if (!q) return true;
      const gName = groupMap.get(s.group_id)?.group_name.toLowerCase() || '';
      const tName = teacherMap.get(s.teacher_id)?.full_name.toLowerCase() || '';
      return (
        s.student_full_name.toLowerCase().includes(q) ||
        gName.includes(q) ||
        tName.includes(q)
      );
    });

    return list.sort((a, b) =>
      sortAsc
        ? compareUzbekNames(a.student_full_name, b.student_full_name)
        : compareUzbekNames(b.student_full_name, a.student_full_name)
    );
  }, [
    submissions,
    search,
    periodFilter,
    teacherFilter,
    groupFilter,
    dateFilter,
    sortAsc,
    groupMap,
    teacherMap,
  ]);

  const totalPages = Math.max(1, Math.ceil(filteredSubmissions.length / pageSize));
  const paginatedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredSubmissions.slice(start, start + pageSize);
  }, [filteredSubmissions, page]);

  const handleOpenEdit = (sub: Submission) => {
    setEditingSub(sub);
    setEditName(sub.student_full_name);
    setEditGroupId(sub.group_id);
    setEditDate(sub.payment_date);
    setEditError(null);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSub || savingEdit) return;
    setSavingEdit(true);
    setEditError(null);

    try {
      const res = await fetch(`/api/admin/submissions/${editingSub.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          student_full_name: editName,
          group_id: editGroupId,
          payment_date: editDate,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEditError(data.error || 'Saqlashda xatolik yuz berdi.');
        setSavingEdit(false);
        return;
      }

      setEditingSub(null);
      setFeedbackBanner(
        `"${editName}" uchun to'lov sanasi ${formatDateUz(editDate)} ga yangilandi.`
      );
      await onRefresh();
    } catch {
      setEditError("Server bilan bog'lanishda xatolik yuz berdi.");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingSub) return;
    try {
      await fetch(`/api/admin/submissions/${deletingSub.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      setFeedbackBanner(`"${deletingSub.student_full_name}" yozuvi o'chirildi.`);
      setDeletingSub(null);
      await onRefresh();
    } catch {
      setDeletingSub(null);
    }
  };

  const handleQuickExcelExport = async () => {
    const targetPeriod =
      (periodFilter !== 'all' ? periods.find((p) => p.id === periodFilter) : null) ||
      activePeriod ||
      periods[0];
    if (!targetPeriod) return;

    const { buffer, filename } = await generateSubmissionsExcelBuffer({
      period: targetPeriod,
      submissions,
      teachers,
      groups,
      selectedTeacherId: teacherFilter,
      selectedGroupId: groupFilter,
    });

    // Notify server endpoint to record EXCEL_YUKLAB_OLINDI audit log
    try {
      const params = new URLSearchParams({
        period_id: targetPeriod.id,
        teacher_id: teacherFilter,
        group_id: groupFilter,
      });
      await fetch(`/api/admin/export-excel?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // Offline / local fallback
    }

    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setFeedbackBanner(`Excel fayl yuklab olindi: ${filename}`);
  };

  return (
    <div className="space-y-6">
      {/* Top Action Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Boshqaruv paneli</h1>
          <p className="text-sm text-slate-500">
            O&apos;quvchilarning oylik to&apos;lov muddatlari yig&apos;imi va tezkor ko&apos;rsatkichlar
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={() => onNavigateToSection('collections')}
            className="px-3.5 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs sm:text-sm font-semibold rounded-xl flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Calendar className="w-4 h-4 text-slate-600" />
            <span>Oylik yig&apos;imlar ({activePeriod?.title || 'Sozlash'})</span>
          </button>

          <button
            type="button"
            onClick={handleQuickExcelExport}
            className="px-3.5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs sm:text-sm font-semibold rounded-xl flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Excel (.xlsx) yuklab olish</span>
          </button>

          <button
            type="button"
            onClick={onOpenTelegramModal}
            className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-sm font-semibold rounded-xl flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Send className="w-4 h-4" />
            <span>Telegramga ulashish</span>
          </button>
        </div>
      </div>

      {feedbackBanner && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between gap-3 text-xs sm:text-sm text-emerald-900">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{feedbackBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedbackBanner(null)}
            aria-label="Yopish"
            className="text-emerald-700 hover:text-emerald-900"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 4 Required Statistics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500">
              Jami yuborilgan ma&apos;lumotlar
            </div>
            <div className="text-2xl font-mono font-bold text-slate-900 tabular-nums">
              {totalSubmissionsCount}
            </div>
            <div className="text-xs text-slate-500">Barcha oylar bo&apos;yicha</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
            <FileCheck2 className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500">Jami o&apos;qituvchilar</div>
            <div className="text-2xl font-mono font-bold text-slate-900 tabular-nums">
              {totalTeachersCount}
            </div>
            <div className="text-xs text-slate-500">
              Faol: {teachers.filter((t) => t.status === 'active').length} nafar
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-700 flex items-center justify-center shrink-0">
            <GraduationCap className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500">Jami faol guruhlar</div>
            <div className="text-2xl font-mono font-bold text-slate-900 tabular-nums">
              {totalActiveGroupsCount}
            </div>
            <div className="text-xs text-slate-500">Jami guruhlar: {groups.length} ta</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center shrink-0">
            <Layers className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500">
              Ushbu oyda ma&apos;lumot yuborgan o&apos;quvchilar
            </div>
            <div className="text-2xl font-mono font-bold text-emerald-700 tabular-nums">
              {currentMonthSubmissionsCount}
            </div>
            <div className="text-xs text-slate-500">
              Faol oy: {activePeriod?.title || 'Yoqilmagan'}
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
            <Users className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Recent Submissions Table Card */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-200 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Kelib tushgan to&apos;lov muddatlari jadvali
              </h2>
              <p className="text-xs text-slate-500">
                O&apos;quvchilar ismlari alifbo tartibida saralangan ({filteredSubmissions.length} ta yozuv)
              </p>
            </div>

            <button
              type="button"
              onClick={() => setSortAsc((prev) => !prev)}
              className="px-3 py-1.5 border border-slate-200 hover:bg-slate-50 rounded-lg text-xs font-medium text-slate-700 flex items-center gap-1.5 self-start sm:self-auto"
            >
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
              <span>Alifbo: {sortAsc ? 'A → Z' : 'Z → A'}</span>
            </button>
          </div>

          {/* Search & Filters */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="O'quvchi ismini qidiring..."
                aria-label="Jadvaldan o'quvchi qidirish"
                className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
              />
            </div>

            <select
              value={periodFilter}
              onChange={(e) => {
                setPeriodFilter(e.target.value);
                setPage(1);
              }}
              aria-label="Yig'im oyi bo'yicha filter"
              className="px-3 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-700"
            >
              <option value="all">Barcha oylar</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} {p.status === 'active' ? '(Faol)' : ''}
                </option>
              ))}
            </select>

            <select
              value={teacherFilter}
              onChange={(e) => {
                setTeacherFilter(e.target.value);
                setGroupFilter('all');
                setPage(1);
              }}
              aria-label="O'qituvchi bo'yicha filter"
              className="px-3 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-700"
            >
              <option value="all">Barcha o&apos;qituvchilar</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.full_name}
                </option>
              ))}
            </select>

            <select
              value={groupFilter}
              onChange={(e) => {
                setGroupFilter(e.target.value);
                setPage(1);
              }}
              aria-label="Guruh bo'yicha filter"
              className="px-3 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-700"
            >
              <option value="all">Barcha guruhlar</option>
              {availableGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.group_name}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={dateFilter}
                onChange={(e) => {
                  setDateFilter(e.target.value);
                  setPage(1);
                }}
                aria-label="To'lov sanasi bo'yicha filter"
                className="w-full px-2.5 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-700"
              />
              {dateFilter && (
                <button
                  type="button"
                  onClick={() => setDateFilter('')}
                  aria-label="Sana filterini tozalash"
                  className="p-1.5 text-slate-400 hover:text-slate-700"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Table with exact required columns: № | O'quvchi | O'qituvchi | Guruh | To'lov sanasi | Yuborilgan vaqt | Amallar */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4 w-12">№</th>
                <th className="py-3 px-4">O&apos;quvchi</th>
                <th className="py-3 px-4">O&apos;qituvchi</th>
                <th className="py-3 px-4">Guruh</th>
                <th className="py-3 px-4">To&apos;lov sanasi</th>
                <th className="py-3 px-4">Yuborilgan vaqt</th>
                <th className="py-3 px-4 text-right">Amallar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {paginatedRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-500">
                    Qidiruv va filter shartlariga mos yozuvlar topilmadi.
                  </td>
                </tr>
              ) : (
                paginatedRows.map((sub, idx) => {
                  const rowIndex = (page - 1) * pageSize + idx + 1;
                  return (
                    <tr key={sub.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4 font-mono text-xs text-slate-500 tabular-nums">
                        {rowIndex}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        {sub.student_full_name}
                      </td>
                      <td className="py-3 px-4 text-slate-700">
                        {teacherMap.get(sub.teacher_id)?.full_name || '—'}
                      </td>
                      <td className="py-3 px-4 text-slate-800 font-medium">
                        {groupMap.get(sub.group_id)?.group_name || '—'}
                      </td>
                      <td className="py-3 px-4 font-mono font-semibold text-sky-700 tabular-nums">
                        {formatDateUz(sub.payment_date)}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-500 tabular-nums">
                        {formatDateTimeUz(sub.created_at)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(sub)}
                            aria-label={`${sub.student_full_name} yozuvini tahrirlash`}
                            className="p-1.5 text-slate-500 hover:text-sky-700 hover:bg-sky-50 rounded-lg transition-colors"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingSub(sub)}
                            aria-label={`${sub.student_full_name} yozuvini o'chirish`}
                            className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-600">
          <span>
            Sahifa <strong className="font-mono">{page}</strong> /{' '}
            <strong className="font-mono">{totalPages}</strong> (Jami {filteredSubmissions.length} ta)
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-100 font-medium"
            >
              Oldingi
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-100 font-medium"
            >
              Keyingi
            </button>
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      {editingSub && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">
                O&apos;quvchi ma&apos;lumotini tahrirlash
              </h3>
              <button
                type="button"
                onClick={() => setEditingSub(null)}
                aria-label="Yopish"
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {editError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{editError}</span>
              </div>
            )}

            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div className="space-y-1">
                <label htmlFor="dash-edit-name" className="block text-xs font-semibold text-slate-700">
                  O&apos;quvchi F.I.Sh.
                </label>
                <input
                  id="dash-edit-name"
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="dash-edit-group" className="block text-xs font-semibold text-slate-700">
                  Guruh
                </label>
                <select
                  id="dash-edit-group"
                  value={editGroupId}
                  onChange={(e) => setEditGroupId(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm bg-white"
                >
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.group_name} ({teacherMap.get(g.teacher_id)?.full_name})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="dash-edit-date" className="block text-xs font-semibold text-slate-700">
                  To&apos;lov sanasi ({formatDateUz(editDate)})
                </label>
                <input
                  id="dash-edit-date"
                  type="date"
                  required
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm font-mono"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingSub(null)}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-sm font-medium text-slate-700"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-semibold cursor-pointer"
                >
                  {savingEdit ? 'Saqlanmoqda...' : 'Saqlash'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deletingSub && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-xl">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-slate-900">
                  Yozuvni o&apos;chirishni tasdiqlaysizmi?
                </h3>
                <p className="text-xs sm:text-sm text-slate-600">
                  <strong>{deletingSub.student_full_name}</strong> ({formatDateUz(deletingSub.payment_date)}) to&apos;lov muddati yozuvi ma&apos;lumotlar bazasidan o&apos;chiriladi.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setDeletingSub(null)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-sm font-medium text-slate-700"
              >
                Bekor qilish
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-semibold cursor-pointer"
              >
                O&apos;chirish
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
