import React, { useState, useMemo } from 'react';
import {
  Plus,
  Search,
  Edit2,
  Trash2,
  Power,
  Eye,
  X,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { CollectionPeriod, Group, Submission, Teacher } from '../types/edupay';
import { compareUzbekNames, formatDateUz } from '../utils/edupayLogic';

interface GroupsManagementViewProps {
  token: string;
  teachers: Teacher[];
  groups: Group[];
  submissions: Submission[];
  periods: CollectionPeriod[];
  onRefresh: () => Promise<void>;
}

export const GroupsManagementView: React.FC<GroupsManagementViewProps> = ({
  token,
  teachers,
  groups,
  submissions,
  periods,
  onRefresh,
}) => {
  const [search, setSearch] = useState('');
  const [teacherFilter, setTeacherFilter] = useState('all');

  // Add/Edit Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [groupName, setGroupName] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [scheduleInfo, setScheduleInfo] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // View Group Students Modal
  const [inspectingGroup, setInspectingGroup] = useState<Group | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<Group | null>(null);
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);

  const teacherMap = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers]);
  const activePeriod = useMemo(
    () => periods.find((p) => p.status === 'active') || periods[0] || null,
    [periods]
  );

  const submissionCountByGroup = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of submissions) {
      if (!activePeriod || s.collection_period_id === activePeriod.id) {
        map.set(s.group_id, (map.get(s.group_id) || 0) + 1);
      }
    }
    return map;
  }, [submissions, activePeriod]);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups
      .filter((g) => {
        if (teacherFilter !== 'all' && g.teacher_id !== teacherFilter) return false;
        if (!q) return true;
        const tName = teacherMap.get(g.teacher_id)?.full_name.toLowerCase() || '';
        return (
          g.group_name.toLowerCase().includes(q) ||
          tName.includes(q) ||
          (g.schedule_info && g.schedule_info.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => compareUzbekNames(a.group_name, b.group_name));
  }, [groups, search, teacherFilter, teacherMap]);

  const openAddModal = () => {
    setEditingGroup(null);
    setGroupName('');
    setTeacherId(teachers.find((t) => t.status === 'active')?.id || teachers[0]?.id || '');
    setScheduleInfo('');
    setStatus('active');
    setModalError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (g: Group) => {
    setEditingGroup(g);
    setGroupName(g.group_name);
    setTeacherId(g.teacher_id);
    setScheduleInfo(g.schedule_info || '');
    setStatus(g.status === 'inactive' ? 'inactive' : 'active');
    setModalError(null);
    setIsModalOpen(true);
  };

  const handleSaveGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setModalError(null);

    if (groupName.trim().length < 2) {
      setModalError("Guruh nomi kamida 2 ta belgidan iborat bo'lishi kerak.");
      return;
    }
    if (!teacherId) {
      setModalError("Iltimos, guruh uchun o'qituvchini tanlang.");
      return;
    }

    setSaving(true);
    try {
      const url = editingGroup ? `/api/admin/groups/${editingGroup.id}` : '/api/admin/groups';
      const method = editingGroup ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          group_name: groupName.trim(),
          teacher_id: teacherId,
          schedule_info: scheduleInfo.trim(),
          status,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setModalError(data.error || 'Guruhni saqlashda xatolik yuz berdi.');
        setSaving(false);
        return;
      }

      setIsModalOpen(false);
      setFeedbackBanner(
        editingGroup
          ? `Guruh "${groupName.trim()}" muvaffaqiyatli yangilandi.`
          : `Yangi guruh "${groupName.trim()}" muvaffaqiyatli yaratildi.`
      );
      await onRefresh();
    } catch {
      setModalError("Server bilan bog'lanishda xatolik yuz berdi.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleGroupStatus = async (g: Group) => {
    const nextStatus = g.status === 'active' ? 'inactive' : 'active';
    try {
      await fetch(`/api/admin/groups/${g.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: nextStatus }),
      });
      setFeedbackBanner(
        `"${g.group_name}" guruhi "${nextStatus === 'active' ? 'Faol' : 'Nofaol'}" holatga o'tkazildi.`
      );
      await onRefresh();
    } catch {
      // ignore
    }
  };

  const handleConfirmDeleteGroup = async () => {
    if (!deletingGroup) return;
    try {
      const res = await fetch(`/api/admin/groups/${deletingGroup.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setDeletingGroup(null);
      if (data.action === 'archived') {
        setFeedbackBanner(data.message);
      } else {
        setFeedbackBanner(`Guruh "${deletingGroup.group_name}" o'chirildi.`);
      }
      await onRefresh();
    } catch {
      setDeletingGroup(null);
    }
  };

  const inspectedStudents = useMemo(() => {
    if (!inspectingGroup) return [];
    return submissions
      .filter(
        (s) =>
          s.group_id === inspectingGroup.id &&
          (!activePeriod || s.collection_period_id === activePeriod.id)
      )
      .sort((a, b) => compareUzbekNames(a.student_full_name, b.student_full_name));
  }, [inspectingGroup, submissions, activePeriod]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Guruhlar boshqaruvi</h1>
          <p className="text-sm text-slate-500">
            Har bir o&apos;quv guruhini tegishli o&apos;qituvchiga biriktirish va guruh ro&apos;yxatini ko&apos;rish
          </p>
        </div>

        <button
          type="button"
          onClick={openAddModal}
          className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold rounded-xl flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Yangi guruh yaratish</span>
        </button>
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

      {/* Search & Teacher Filter */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Guruh nomi yoki o'qituvchi bo'yicha qidirish..."
            aria-label="Guruhlarni qidirish"
            className="w-full pl-10 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
          />
        </div>

        <select
          value={teacherFilter}
          onChange={(e) => setTeacherFilter(e.target.value)}
          aria-label="O'qituvchi bo'yicha saralash"
          className="px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:border-sky-600"
        >
          <option value="all">Barcha o&apos;qituvchilar</option>
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.full_name}
            </option>
          ))}
        </select>
      </div>

      {/* Groups Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4 w-12">№</th>
                <th className="py-3 px-4">Guruh nomi</th>
                <th className="py-3 px-4">Biriktirilgan o&apos;qituvchi</th>
                <th className="py-3 px-4">Dars vaqti</th>
                <th className="py-3 px-4 text-right">
                  Yuborgan o&apos;quvchilar ({activePeriod?.title || 'Joriy oy'})
                </th>
                <th className="py-3 px-4">Holati</th>
                <th className="py-3 px-4">Yaratilgan sana</th>
                <th className="py-3 px-4 text-right">Amallar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {filteredGroups.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-500">
                    Qidiruv bo&apos;yicha guruhlar topilmadi.
                  </td>
                </tr>
              ) : (
                filteredGroups.map((group, idx) => {
                  const teacherName =
                    teacherMap.get(group.teacher_id)?.full_name || "Noma'lum o'qituvchi";
                  const subCount = submissionCountByGroup.get(group.id) || 0;
                  return (
                    <tr key={group.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4 font-mono text-xs text-slate-500 tabular-nums">
                        {idx + 1}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        {group.group_name}
                      </td>
                      <td className="py-3 px-4 text-slate-700">{teacherName}</td>
                      <td className="py-3 px-4 text-xs text-slate-500">
                        {group.schedule_info || 'Belgilanmagan'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                        {subCount} nafar
                      </td>
                      <td className="py-3 px-4 text-xs">
                        {group.status === 'active' ? (
                          <span className="font-semibold text-emerald-700">Faol</span>
                        ) : group.status === 'archived' ? (
                          <span className="font-medium text-amber-700">Arxivlangan</span>
                        ) : (
                          <span className="font-medium text-slate-500">Nofaol</span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-500 tabular-nums">
                        {formatDateUz(group.created_at.slice(0, 10))}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setInspectingGroup(group)}
                            title="Guruh o'quvchilarini ko'rish"
                            aria-label={`${group.group_name} o'quvchilarini ko'rish`}
                            className="p-1.5 text-slate-500 hover:text-sky-700 hover:bg-sky-50 rounded-lg transition-colors"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleGroupStatus(group)}
                            title={group.status === 'active' ? 'Nofaol qilish' : 'Faollashtirish'}
                            aria-label={`${group.group_name} holatini o'zgartirish`}
                            className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                          >
                            <Power className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(group)}
                            aria-label={`${group.group_name} guruhini tahrirlash`}
                            className="p-1.5 text-slate-500 hover:text-sky-700 hover:bg-sky-50 rounded-lg transition-colors"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingGroup(group)}
                            aria-label={`${group.group_name} guruhini o'chirish`}
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
      </div>

      {/* Add / Edit Group Modal */}
      {isModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 space-y-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">
                {editingGroup ? 'Guruhni tahrirlash' : 'Yangi guruh yaratish'}
              </h2>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                aria-label="Oynani yopish"
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {modalError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleSaveGroup} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="group-name-input" className="block text-sm font-semibold text-slate-800">
                  Guruh nomi <span className="text-red-500">*</span>
                </label>
                <input
                  id="group-name-input"
                  type="text"
                  required
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Masalan: IELTS-01 yoki General English A1"
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-600"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="group-teacher-select" className="block text-sm font-semibold text-slate-800">
                  Biriktirilgan o&apos;qituvchi <span className="text-red-500">*</span>
                </label>
                <select
                  id="group-teacher-select"
                  required
                  value={teacherId}
                  onChange={(e) => setTeacherId(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-600"
                >
                  <option value="">O&apos;qituvchini tanlang...</option>
                  {teachers
                    .filter((t) => t.status !== 'archived')
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.full_name}
                      </option>
                    ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="group-schedule-input" className="block text-sm font-semibold text-slate-800">
                  Dars kunlari va vaqti
                </label>
                <input
                  id="group-schedule-input"
                  type="text"
                  value={scheduleInfo}
                  onChange={(e) => setScheduleInfo(e.target.value)}
                  placeholder="Masalan: Dush-Chor-Jum 14:00"
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-600"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="group-status-select" className="block text-sm font-semibold text-slate-800">
                  Holati
                </label>
                <select
                  id="group-status-select"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as 'active' | 'inactive')}
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-600"
                >
                  <option value="active">Faol</option>
                  <option value="inactive">Nofaol</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-semibold cursor-pointer"
                >
                  {saving ? 'Saqlanmoqda...' : 'Saqlash'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Inspect Group Students Modal */}
      {inspectingGroup && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  {inspectingGroup.group_name} — O&apos;quvchilar ro&apos;yxati
                </h3>
                <p className="text-xs text-slate-500">
                  O&apos;qituvchi: {teacherMap.get(inspectingGroup.teacher_id)?.full_name} ·{' '}
                  {activePeriod?.title || ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectingGroup(null)}
                aria-label="Oynani yopish"
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <th className="py-2.5 px-3 w-10">№</th>
                    <th className="py-2.5 px-3">O&apos;quvchi F.I.Sh.</th>
                    <th className="py-2.5 px-3 text-right">To&apos;lov sanasi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {inspectedStudents.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-8 text-center text-slate-500 text-xs">
                        Ushbu guruhda joriy oy uchun yuborilgan ma&apos;lumotlar yo&apos;q.
                      </td>
                    </tr>
                  ) : (
                    inspectedStudents.map((s, i) => (
                      <tr key={s.id}>
                        <td className="py-2.5 px-3 font-mono text-xs text-slate-500 tabular-nums">
                          {i + 1}
                        </td>
                        <td className="py-2.5 px-3 font-medium text-slate-900">
                          {s.student_full_name}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-sky-700 font-semibold tabular-nums">
                          {formatDateUz(s.payment_date)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setInspectingGroup(null)}
                className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-xl hover:bg-slate-800"
              >
                Yopish
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Group Confirmation Modal */}
      {deletingGroup && (
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
                  Guruhni o&apos;chirishni tasdiqlaysizmi?
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                  Siz <strong>{deletingGroup.group_name}</strong> guruhini o&apos;chirmoqchisiz. Agar ushbu guruhda
                  avvalgi yoki joriy oylik to&apos;lov yozuvlari mavjud bo&apos;lsa, guruh o&apos;chirilmasdan arxivlanadi.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeletingGroup(null)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Bekor qilish
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteGroup}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-semibold cursor-pointer"
              >
                Tasdiqlash
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
