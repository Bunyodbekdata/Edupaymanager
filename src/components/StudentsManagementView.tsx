import React, { useState, useMemo } from 'react';
import {
  Search,
  Plus,
  Edit2,
  Trash2,
  Eye,
  Upload,
  ArrowUpDown,
  X,
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Users,
} from 'lucide-react';
import {
  CollectionPeriod,
  Group,
  StudentRoster,
  Submission,
  Teacher,
} from '../types/edupay';
import {
  compareRosterWithSubmissions,
  compareUzbekNames,
  formatDateTimeUz,
  formatDateUz,
} from '../utils/edupayLogic';
import { parseRosterExcelFile } from '../utils/excelExport';

interface StudentsManagementViewProps {
  token: string;
  teachers: Teacher[];
  groups: Group[];
  periods: CollectionPeriod[];
  submissions: Submission[];
  rosters: StudentRoster[];
  onRefresh: () => Promise<void>;
}

export const StudentsManagementView: React.FC<StudentsManagementViewProps> = ({
  token,
  teachers,
  groups,
  periods,
  submissions,
  rosters,
  onRefresh,
}) => {
  const activePeriod = useMemo(
    () => periods.find((p) => p.status === 'active') || periods[0] || null,
    [periods]
  );

  // Filters & sorting
  const [search, setSearch] = useState('');
  const [periodFilter, setPeriodFilter] = useState<string>(activePeriod?.id || 'all');
  const [teacherFilter, setTeacherFilter] = useState<string>('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('');
  const [sortBy, setSortBy] = useState<'name_asc' | 'name_desc' | 'date_asc' | 'date_desc'>('name_asc');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;

  // Sub-view tab: 'submissions' | 'roster'
  const [subTab, setSubTab] = useState<'submissions' | 'roster'>('submissions');

  // Add / Edit / Detail / Delete Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingSubmission, setEditingSubmission] = useState<Submission | null>(null);
  const [detailSubmission, setDetailSubmission] = useState<Submission | null>(null);
  const [deletingSubmission, setDeletingSubmission] = useState<Submission | null>(null);

  // Form fields for Add/Edit
  const [formPeriodId, setFormPeriodId] = useState(activePeriod?.id || '');
  const [formTeacherId, setFormTeacherId] = useState('');
  const [formGroupId, setFormGroupId] = useState('');
  const [formStudentName, setFormStudentName] = useState('');
  const [formPaymentDate, setFormPaymentDate] = useState('');
  const [formNote, setFormNote] = useState('');
  const [formAllowDuplicate, setFormAllowDuplicate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);

  // Roster comparison state
  const [selectedRosterGroupId, setSelectedRosterGroupId] = useState<string>(
    groups[0]?.id || ''
  );
  const [rosterTextInput, setRosterTextInput] = useState<string>('');
  const [isRosterModalOpen, setIsRosterModalOpen] = useState(false);
  const [rosterSaving, setRosterSaving] = useState(false);

  const teacherMap = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers]);
  const groupMap = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const periodMap = useMemo(() => new Map(periods.map((p) => [p.id, p])), [periods]);

  const availableGroupsForFilter = useMemo(() => {
    if (teacherFilter === 'all') return groups;
    return groups.filter((g) => g.teacher_id === teacherFilter);
  }, [groups, teacherFilter]);

  const filteredAndSortedSubmissions = useMemo(() => {
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

    return list.sort((a, b) => {
      if (sortBy === 'name_asc') return compareUzbekNames(a.student_full_name, b.student_full_name);
      if (sortBy === 'name_desc') return compareUzbekNames(b.student_full_name, a.student_full_name);
      if (sortBy === 'date_asc') {
        const cmp = a.payment_date.localeCompare(b.payment_date);
        return cmp !== 0 ? cmp : compareUzbekNames(a.student_full_name, b.student_full_name);
      }
      const cmp = b.payment_date.localeCompare(a.payment_date);
      return cmp !== 0 ? cmp : compareUzbekNames(a.student_full_name, b.student_full_name);
    });
  }, [
    submissions,
    search,
    periodFilter,
    teacherFilter,
    groupFilter,
    dateFilter,
    sortBy,
    groupMap,
    teacherMap,
  ]);

  const totalPages = Math.max(1, Math.ceil(filteredAndSortedSubmissions.length / pageSize));
  const paginatedSubmissions = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredAndSortedSubmissions.slice(start, start + pageSize);
  }, [filteredAndSortedSubmissions, currentPage]);

  const openAddSubmissionModal = () => {
    const defaultTeacher = teachers.find((t) => t.status === 'active') || teachers[0];
    const defaultGroup = groups.find((g) => g.teacher_id === defaultTeacher?.id) || groups[0];
    setEditingSubmission(null);
    setFormPeriodId(activePeriod?.id || periods[0]?.id || '');
    setFormTeacherId(defaultTeacher?.id || '');
    setFormGroupId(defaultGroup?.id || '');
    setFormStudentName('');
    setFormPaymentDate(activePeriod?.allowed_payment_start_date || '2026-11-05');
    setFormNote('');
    setFormAllowDuplicate(false);
    setModalError(null);
    setIsAddModalOpen(true);
  };

  const openEditSubmissionModal = (sub: Submission) => {
    setEditingSubmission(sub);
    setFormPeriodId(sub.collection_period_id);
    setFormTeacherId(sub.teacher_id);
    setFormGroupId(sub.group_id);
    setFormStudentName(sub.student_full_name);
    setFormPaymentDate(sub.payment_date);
    setFormNote(sub.note || '');
    setFormAllowDuplicate(false);
    setModalError(null);
    setIsAddModalOpen(true);
  };

  const handleSaveSubmission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setModalError(null);
    setSaving(true);

    try {
      const url = editingSubmission
        ? `/api/admin/submissions/${editingSubmission.id}`
        : '/api/admin/submissions';
      const method = editingSubmission ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          collection_period_id: formPeriodId,
          teacher_id: formTeacherId,
          group_id: formGroupId,
          student_full_name: formStudentName,
          payment_date: formPaymentDate,
          note: formNote,
          allow_duplicate: formAllowDuplicate,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setModalError(data.error || "Saqlashda xatolik yuz berdi.");
        setSaving(false);
        return;
      }

      setIsAddModalOpen(false);
      setFeedbackBanner(
        editingSubmission
          ? `O'quvchi "${formStudentName}" ma'lumotlari muvaffaqiyatli yangilandi.`
          : `Yangi o'quvchi yozuvi "${formStudentName}" qo'shildi.`
      );
      await onRefresh();
    } catch {
      setModalError("Server bilan bog'lanishda xatolik yuz berdi.");
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingSubmission) return;
    try {
      await fetch(`/api/admin/submissions/${deletingSubmission.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      setFeedbackBanner(`"${deletingSubmission.student_full_name}" yozuvi o'chirildi.`);
      setDeletingSubmission(null);
      await onRefresh();
    } catch {
      setDeletingSubmission(null);
    }
  };

  // Roster comparison calculation for selected group
  const activeRosterForGroup = useMemo(
    () => rosters.find((r) => r.group_id === selectedRosterGroupId) || null,
    [rosters, selectedRosterGroupId]
  );

  const rosterComparison = useMemo(() => {
    if (!activeRosterForGroup) return null;
    const targetPeriodId = periodFilter === 'all' ? activePeriod?.id : periodFilter;
    const groupSubs = submissions
      .filter(
        (s) =>
          s.group_id === selectedRosterGroupId &&
          (!targetPeriodId || s.collection_period_id === targetPeriodId)
      )
      .map((s) => s.student_full_name);

    return compareRosterWithSubmissions(activeRosterForGroup.student_names, groupSubs);
  }, [activeRosterForGroup, submissions, selectedRosterGroupId, periodFilter, activePeriod]);

  const openRosterImportModal = () => {
    const existingNames = activeRosterForGroup?.student_names || [];
    setRosterTextInput(existingNames.join('\n'));
    setIsRosterModalOpen(true);
  };

  const handleExcelFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      if (file.name.endsWith('.csv') || file.name.endsWith('.txt')) {
        const text = await file.text();
        const lines = text
          .split(/\r?\n/)
          .map((l) => l.split(/[,;\t]/)[0]?.trim())
          .filter(Boolean);
        setRosterTextInput(lines.join('\n'));
      } else {
        const buf = await file.arrayBuffer();
        const names = await parseRosterExcelFile(buf);
        if (names.length > 0) {
          setRosterTextInput(names.join('\n'));
        }
      }
    } catch {
      // ignore parse error
    }
  };

  const handleSaveRoster = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rosterSaving || !selectedRosterGroupId) return;
    setRosterSaving(true);
    try {
      const names = rosterTextInput
        .split(/\r?\n/)
        .map((n) => n.trim())
        .filter((n) => n.length >= 3);

      const res = await fetch('/api/admin/rosters', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          group_id: selectedRosterGroupId,
          student_names: names,
        }),
      });

      if (res.ok) {
        setIsRosterModalOpen(false);
        setFeedbackBanner("Guruh o'quvchilar ro'yxati muvaffaqiyatli saqlandi.");
        await onRefresh();
      }
    } finally {
      setRosterSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            O&apos;quvchilar va yuborilgan ma&apos;lumotlar
          </h1>
          <p className="text-sm text-slate-500">
            Alifbo tartibida saralangan barcha to&apos;lov muddatlari va guruh ro&apos;yxati solishtiruvi
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-xl">
            <button
              type="button"
              onClick={() => setSubTab('submissions')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                subTab === 'submissions'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Yuborilgan yozuvlar ({filteredAndSortedSubmissions.length})
            </button>
            <button
              type="button"
              onClick={() => setSubTab('roster')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                subTab === 'roster'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Guruh ro&apos;yxati solishtiruvi
            </button>
          </div>

          <button
            type="button"
            onClick={openAddSubmissionModal}
            className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-sm font-semibold rounded-xl flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>O&apos;quvchi qo&apos;shish</span>
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
            aria-label="Xabarni yopish"
            className="text-emerald-700 hover:text-emerald-900"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {subTab === 'submissions' ? (
        <>
          {/* Filter Bar */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <div className="relative lg:col-span-2">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="O'quvchi F.I.Sh. bo'yicha qidirish..."
                aria-label="O'quvchi ismini qidirish"
                className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
              />
            </div>

            <select
              value={periodFilter}
              onChange={(e) => {
                setPeriodFilter(e.target.value);
                setCurrentPage(1);
              }}
              aria-label="Oy bo'yicha filter"
              className="px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-700"
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
                setCurrentPage(1);
              }}
              aria-label="O'qituvchi bo'yicha filter"
              className="px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-700"
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
                setCurrentPage(1);
              }}
              aria-label="Guruh bo'yicha filter"
              className="px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-700"
            >
              <option value="all">Barcha guruhlar</option>
              {availableGroupsForFilter.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.group_name}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-2">
              <input
                type="date"
                value={dateFilter}
                onChange={(e) => {
                  setDateFilter(e.target.value);
                  setCurrentPage(1);
                }}
                aria-label="To'lov sanasi bo'yicha filter"
                className="w-full px-2.5 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-700"
              />
              {dateFilter && (
                <button
                  type="button"
                  onClick={() => setDateFilter('')}
                  aria-label="Sana filterini tozalash"
                  className="p-2 text-slate-400 hover:text-slate-700"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Sort Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
            <div>
              Jami topilgan yozuvlar:{' '}
              <strong className="font-mono text-slate-900 tabular-nums">
                {filteredAndSortedSubmissions.length}
              </strong>{' '}
              ta (Alifbo tartibida avtomatik saralangan)
            </div>
            <div className="flex items-center gap-2">
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
              <span>Saralash:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                aria-label="Saralash tartibi"
                className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-800"
              >
                <option value="name_asc">Ism bo&apos;yicha (A → Z)</option>
                <option value="name_desc">Ism bo&apos;yicha (Z → A)</option>
                <option value="date_asc">To&apos;lov sanasi (erta → kech)</option>
                <option value="date_desc">To&apos;lov sanasi (kech → erta)</option>
              </select>
            </div>
          </div>

          {/* Submissions Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4 w-12">№</th>
                    <th className="py-3 px-4">O&apos;quvchi</th>
                    <th className="py-3 px-4">O&apos;qituvchi</th>
                    <th className="py-3 px-4">Guruh</th>
                    <th className="py-3 px-4">To&apos;lov sanasi</th>
                    <th className="py-3 px-4">Yig&apos;im oyi</th>
                    <th className="py-3 px-4">Yuborilgan vaqt</th>
                    <th className="py-3 px-4 text-right">Amallar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm">
                  {paginatedSubmissions.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-slate-500">
                        Tanlangan filterlar bo&apos;yicha o&apos;quvchi yozuvlari topilmadi.
                      </td>
                    </tr>
                  ) : (
                    paginatedSubmissions.map((sub, idx) => {
                      const rowNum = (currentPage - 1) * pageSize + idx + 1;
                      const teacherName =
                        teacherMap.get(sub.teacher_id)?.full_name || "Noma'lum";
                      const groupName = groupMap.get(sub.group_id)?.group_name || "Noma'lum";
                      const periodTitle =
                        periodMap.get(sub.collection_period_id)?.title || "Noma'lum";

                      return (
                        <tr key={sub.id} className="hover:bg-slate-50 transition-colors">
                          <td className="py-3 px-4 font-mono text-xs text-slate-500 tabular-nums">
                            {rowNum}
                          </td>
                          <td className="py-3 px-4 font-semibold text-slate-900">
                            {sub.student_full_name}
                          </td>
                          <td className="py-3 px-4 text-slate-700">{teacherName}</td>
                          <td className="py-3 px-4 text-slate-700 font-medium">{groupName}</td>
                          <td className="py-3 px-4 font-mono font-semibold text-sky-700 tabular-nums">
                            {formatDateUz(sub.payment_date)}
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-600">{periodTitle}</td>
                          <td className="py-3 px-4 font-mono text-xs text-slate-500 tabular-nums">
                            {formatDateTimeUz(sub.created_at)}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setDetailSubmission(sub)}
                                aria-label={`${sub.student_full_name} batafsil ma'lumoti`}
                                className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditSubmissionModal(sub)}
                                aria-label={`${sub.student_full_name} to'lov sanasini tahrirlash`}
                                className="p-1.5 text-slate-500 hover:text-sky-700 hover:bg-sky-50 rounded-lg"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeletingSubmission(sub)}
                                aria-label={`${sub.student_full_name} yozuvini o'chirish`}
                                className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
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
            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-600">
                <span>
                  Sahifa <strong className="font-mono">{currentPage}</strong> /{' '}
                  <strong className="font-mono">{totalPages}</strong>
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-100 font-medium"
                  >
                    Oldingi
                  </button>
                  <button
                    type="button"
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-100 font-medium"
                  >
                    Keyingi
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        /* ROSTER COMPARISON TAB */
        <div className="space-y-5">
          <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <label htmlFor="roster-group-select" className="text-sm font-semibold text-slate-800">
                Guruhni tanlang:
              </label>
              <select
                id="roster-group-select"
                value={selectedRosterGroupId}
                onChange={(e) => setSelectedRosterGroupId(e.target.value)}
                className="px-3.5 py-2 border border-slate-300 rounded-xl text-sm bg-white font-medium text-slate-900"
              >
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.group_name} ({teacherMap.get(g.teacher_id)?.full_name})
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={openRosterImportModal}
              className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-sm font-semibold rounded-xl flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              <span>Excel yoki ro&apos;yxatdan import qilish</span>
            </button>
          </div>

          {!activeRosterForGroup ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-3">
              <div className="w-12 h-12 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center mx-auto">
                <Users className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-slate-900">
                Ushbu guruh uchun o&apos;quvchilar ro&apos;yxati hali kiritilmagan
              </h3>
              <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto">
                Kimlar ma&apos;lumot yuborganini va kimlar hali yubormaganini aniqlash uchun avval guruhning
                mavjud o&apos;quvchilar ro&apos;yxatini Excel (.xlsx / .csv) fayldan yoki matn ko&apos;rinishida yuklang.
              </p>
              <button
                type="button"
                onClick={openRosterImportModal}
                className="px-4 py-2 bg-slate-900 text-white text-xs sm:text-sm font-semibold rounded-xl hover:bg-slate-800"
              >
                Guruh ro&apos;yxatini kiritish
              </button>
            </div>
          ) : (
            rosterComparison && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Ma'lumot yuborganlar */}
                <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div>
                      <h3 className="text-base font-bold text-emerald-800">
                        Ma&apos;lumot yuborganlar
                      </h3>
                      <p className="text-xs text-slate-500">
                        Ro&apos;yxatdagi {activeRosterForGroup.student_names.length} o&apos;quvchidan{' '}
                        {rosterComparison.submitted.length} nafari yuborgan (
                        {rosterComparison.completionPercent}%)
                      </p>
                    </div>
                    <span className="font-mono text-lg font-bold text-emerald-700 tabular-nums">
                      {rosterComparison.submitted.length}
                    </span>
                  </div>

                  {rosterComparison.submitted.length === 0 ? (
                    <p className="text-xs text-slate-500 py-4 text-center">
                      Hozircha hech kim ma&apos;lumot yubormagan.
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-100 text-sm">
                      {rosterComparison.submitted.map((name, i) => (
                        <li key={name} className="py-2 flex items-center justify-between">
                          <span className="text-slate-900 font-medium">
                            <span className="font-mono text-xs text-slate-400 mr-2 tabular-nums">
                              {i + 1}.
                            </span>
                            {name}
                          </span>
                          <span className="text-xs text-emerald-700 font-medium">Yuborgan</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Hali ma'lumot yubormaganlar */}
                <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div>
                      <h3 className="text-base font-bold text-amber-800">
                        Hali ma&apos;lumot yubormaganlar
                      </h3>
                      <p className="text-xs text-slate-500">
                        To&apos;lov muddatini hali belgilamagan o&apos;quvchilar
                      </p>
                    </div>
                    <span className="font-mono text-lg font-bold text-amber-700 tabular-nums">
                      {rosterComparison.notSubmitted.length}
                    </span>
                  </div>

                  {rosterComparison.notSubmitted.length === 0 ? (
                    <p className="text-xs text-emerald-700 py-4 text-center font-medium">
                      Barcha o&apos;quvchilar to&apos;lov muddatini yuborgan!
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-100 text-sm">
                      {rosterComparison.notSubmitted.map((name, i) => (
                        <li key={name} className="py-2 flex items-center justify-between">
                          <span className="text-slate-900 font-medium">
                            <span className="font-mono text-xs text-slate-400 mr-2 tabular-nums">
                              {i + 1}.
                            </span>
                            {name}
                          </span>
                          <span className="text-xs text-amber-700 font-medium">Kutilmoqda</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )
          )}
        </div>
      )}

      {/* Add / Edit Student Submission Modal */}
      {isAddModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">
                {editingSubmission
                  ? "O'quvchi ma'lumotini tahrirlash"
                  : "Yangi o'quvchi yozuvini qo'shish"}
              </h2>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                aria-label="Oynani yopish"
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {modalError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleSaveSubmission} className="space-y-3.5">
              {!editingSubmission && (
                <div className="space-y-1">
                  <label htmlFor="sub-period" className="block text-xs font-semibold text-slate-700">
                    Oylik yig&apos;im davri
                  </label>
                  <select
                    id="sub-period"
                    value={formPeriodId}
                    onChange={(e) => setFormPeriodId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm bg-white"
                  >
                    {periods.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="space-y-1">
                <label htmlFor="sub-group" className="block text-xs font-semibold text-slate-700">
                  Guruh va o&apos;qituvchi
                </label>
                <select
                  id="sub-group"
                  value={formGroupId}
                  onChange={(e) => {
                    const gId = e.target.value;
                    setFormGroupId(gId);
                    const gObj = groupMap.get(gId);
                    if (gObj) setFormTeacherId(gObj.teacher_id);
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm bg-white"
                >
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.group_name} — {teacherMap.get(g.teacher_id)?.full_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="sub-name" className="block text-xs font-semibold text-slate-700">
                  O&apos;quvchi ism va familiyasi
                </label>
                <input
                  id="sub-name"
                  type="text"
                  required
                  value={formStudentName}
                  onChange={(e) => setFormStudentName(e.target.value)}
                  placeholder="Masalan: Valiyev Ali"
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-sm"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="sub-date" className="block text-xs font-semibold text-slate-700">
                  To&apos;lov sanasi ({formatDateUz(formPaymentDate)})
                </label>
                <input
                  id="sub-date"
                  type="date"
                  required
                  value={formPaymentDate}
                  onChange={(e) => setFormPaymentDate(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-sm font-mono"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="sub-note" className="block text-xs font-semibold text-slate-700">
                  Administrator izohi (ixtiyoriy)
                </label>
                <input
                  id="sub-note"
                  type="text"
                  value={formNote}
                  onChange={(e) => setFormNote(e.target.value)}
                  placeholder="Masalan: Ism-familiyadosh 2-o'quvchi"
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-sm"
                />
              </div>

              {!editingSubmission && (
                <label className="flex items-center gap-2 text-xs text-slate-600 pt-1">
                  <input
                    type="checkbox"
                    checked={formAllowDuplicate}
                    onChange={(e) => setFormAllowDuplicate(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>Guruhda ism-familiyasi bir xil boshqa o&apos;quvchi bo&apos;lsa ruxsat berish</span>
                </label>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-sm font-medium text-slate-700"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-semibold cursor-pointer"
                >
                  {saving ? 'Saqlanmoqda...' : 'Saqlash'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detailed Student Record Modal */}
      {detailSubmission && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">
                O&apos;quvchi yozuvi tafsilotlari
              </h3>
              <button
                type="button"
                onClick={() => setDetailSubmission(null)}
                aria-label="Yopish"
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 divide-y divide-slate-200 text-sm">
              <div className="py-2 flex justify-between gap-4">
                <span className="text-slate-500">F.I.Sh.:</span>
                <span className="font-semibold text-slate-900">
                  {detailSubmission.student_full_name}
                </span>
              </div>
              <div className="py-2 flex justify-between gap-4">
                <span className="text-slate-500">O&apos;qituvchi:</span>
                <span className="font-medium text-slate-900">
                  {teacherMap.get(detailSubmission.teacher_id)?.full_name}
                </span>
              </div>
              <div className="py-2 flex justify-between gap-4">
                <span className="text-slate-500">Guruh:</span>
                <span className="font-medium text-slate-900">
                  {groupMap.get(detailSubmission.group_id)?.group_name}
                </span>
              </div>
              <div className="py-2 flex justify-between gap-4">
                <span className="text-slate-500">To&apos;lov sanasi:</span>
                <span className="font-mono font-semibold text-sky-700 tabular-nums">
                  {formatDateUz(detailSubmission.payment_date)}
                </span>
              </div>
              <div className="py-2 flex justify-between gap-4">
                <span className="text-slate-500">Oylik yig&apos;im:</span>
                <span className="text-slate-800">
                  {periodMap.get(detailSubmission.collection_period_id)?.title}
                </span>
              </div>
              <div className="py-2 flex justify-between gap-4">
                <span className="text-slate-500">Yuborilgan vaqt:</span>
                <span className="font-mono text-xs text-slate-600 tabular-nums">
                  {formatDateTimeUz(detailSubmission.created_at)}
                </span>
              </div>
              {detailSubmission.note && (
                <div className="py-2 flex justify-between gap-4">
                  <span className="text-slate-500">Izoh:</span>
                  <span className="text-slate-800">{detailSubmission.note}</span>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  const sub = detailSubmission;
                  setDetailSubmission(null);
                  openEditSubmissionModal(sub);
                }}
                className="px-4 py-2 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Tahrirlash
              </button>
              <button
                type="button"
                onClick={() => setDetailSubmission(null)}
                className="px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-semibold"
              >
                Yopish
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingSubmission && (
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
                  <strong>{deletingSubmission.student_full_name}</strong> ({formatDateUz(deletingSubmission.payment_date)}) to&apos;lov muddati yozuvi butunlay o&apos;chiriladi.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setDeletingSubmission(null)}
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

      {/* Roster Import Modal */}
      {isRosterModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Guruh o&apos;quvchilar ro&apos;yxatini import qilish
                </h3>
                <p className="text-xs text-slate-500">
                  Guruh: {groupMap.get(selectedRosterGroupId)?.group_name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsRosterModalOpen(false)}
                aria-label="Yopish"
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 text-xs text-slate-700">
                <FileSpreadsheet className="w-5 h-5 text-emerald-600 shrink-0" />
                <span>Excel (.xlsx, .csv) fayldan o&apos;quvchilar ismlarini yuklash:</span>
              </div>
              <label className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 hover:bg-slate-100 cursor-pointer shrink-0">
                <span>Fayl tanlash</span>
                <input
                  type="file"
                  accept=".xlsx,.csv,.txt"
                  onChange={handleExcelFileUpload}
                  className="sr-only"
                />
              </label>
            </div>

            <form onSubmit={handleSaveRoster} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="roster-textarea" className="block text-xs font-semibold text-slate-700">
                  Har bir qatorga bitta o&apos;quvchi F.I.Sh. kiriting:
                </label>
                <textarea
                  id="roster-textarea"
                  rows={8}
                  value={rosterTextInput}
                  onChange={(e) => setRosterTextInput(e.target.value)}
                  placeholder={'Abdullayev Aziz\nKarimov Akmal\nValiyev Ali'}
                  className="w-full p-3 border border-slate-300 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-600"
                />
              </div>

              <div className="flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsRosterModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-sm font-medium text-slate-700"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  disabled={rosterSaving}
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-semibold cursor-pointer"
                >
                  {rosterSaving ? 'Saqlanmoqda...' : "Ro'yxatni saqlash"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
