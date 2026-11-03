import React, { useState, useMemo } from 'react';
import {
  Plus,
  Search,
  Edit2,
  Trash2,
  Power,
  X,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { Group, Submission, Teacher } from '../types/edupay';
import { compareUzbekNames, formatDateUz } from '../utils/edupayLogic';

interface TeachersManagementViewProps {
  token: string;
  teachers: Teacher[];
  groups: Group[];
  submissions: Submission[];
  onRefresh: () => Promise<void>;
}

export const TeachersManagementView: React.FC<TeachersManagementViewProps> = ({
  token,
  teachers,
  groups,
  submissions,
  onRefresh,
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'archived'>('all');

  // Add/Edit Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState<Teacher | null>(null);
  const [fullName, setFullName] = useState('');
  const [subject, setSubject] = useState('');
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Delete confirmation state
  const [deletingTeacher, setDeletingTeacher] = useState<Teacher | null>(null);
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);

  const groupCountByTeacher = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of groups) {
      map.set(g.teacher_id, (map.get(g.teacher_id) || 0) + 1);
    }
    return map;
  }, [groups]);

  const submissionCountByTeacher = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of submissions) {
      map.set(s.teacher_id, (map.get(s.teacher_id) || 0) + 1);
    }
    return map;
  }, [submissions]);

  const filteredTeachers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return teachers
      .filter((t) => {
        if (statusFilter !== 'all' && t.status !== statusFilter) return false;
        if (!q) return true;
        return (
          t.full_name.toLowerCase().includes(q) ||
          (t.subject && t.subject.toLowerCase().includes(q)) ||
          (t.phone && t.phone.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => compareUzbekNames(a.full_name, b.full_name));
  }, [teachers, search, statusFilter]);

  const openAddModal = () => {
    setEditingTeacher(null);
    setFullName('');
    setSubject('');
    setPhone('');
    setStatus('active');
    setModalError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (t: Teacher) => {
    setEditingTeacher(t);
    setFullName(t.full_name);
    setSubject(t.subject || '');
    setPhone(t.phone || '');
    setStatus(t.status === 'inactive' ? 'inactive' : 'active');
    setModalError(null);
    setIsModalOpen(true);
  };

  const handleSaveTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setModalError(null);

    if (fullName.trim().length < 3) {
      setModalError("O'qituvchi ism-familiyasi kamida 3 ta belgidan iborat bo'lishi kerak.");
      return;
    }

    setSaving(true);
    try {
      const url = editingTeacher
        ? `/api/admin/teachers/${editingTeacher.id}`
        : '/api/admin/teachers';
      const method = editingTeacher ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          full_name: fullName.trim(),
          subject: subject.trim(),
          phone: phone.trim(),
          status,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setModalError(data.error || 'Saqlashda xatolik yuz berdi.');
        setSaving(false);
        return;
      }

      setIsModalOpen(false);
      setFeedbackBanner(
        editingTeacher
          ? `O'qituvchi "${fullName.trim()}" ma'lumotlari muvaffaqiyatli yangilandi.`
          : `Yangi o'qituvchi "${fullName.trim()}" muvaffaqiyatli qo'shildi.`
      );
      await onRefresh();
    } catch {
      setModalError("Server bilan bog'lanishda xatolik yuz berdi.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (t: Teacher) => {
    const nextStatus = t.status === 'active' ? 'inactive' : 'active';
    try {
      await fetch(`/api/admin/teachers/${t.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: nextStatus }),
      });
      setFeedbackBanner(
        `${t.full_name} holati "${nextStatus === 'active' ? 'Faol' : 'Nofaol'}" holatga o'zgartirildi.`
      );
      await onRefresh();
    } catch {
      // handled silently
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingTeacher) return;
    try {
      const res = await fetch(`/api/admin/teachers/${deletingTeacher.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setDeletingTeacher(null);
      if (data.action === 'archived') {
        setFeedbackBanner(data.message);
      } else {
        setFeedbackBanner(`O'qituvchi "${deletingTeacher.full_name}" o'chirildi.`);
      }
      await onRefresh();
    } catch {
      setDeletingTeacher(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            O&apos;qituvchilar boshqaruvi
          </h1>
          <p className="text-sm text-slate-500">
            O&apos;quv markazi o&apos;qituvchilarini qo&apos;shish, tahrirlash va guruhlarga biriktirish
          </p>
        </div>

        <button
          type="button"
          onClick={openAddModal}
          className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold rounded-xl flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Yangi o&apos;qituvchi qo&apos;shish</span>
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

      {/* Search & Filter Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="O'qituvchi ismi, yo'nalishi yoki telefon raqami bo'yicha qidirish..."
            aria-label="O'qituvchilarni qidirish"
            className="w-full pl-10 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg shrink-0">
          {(
            [
              { id: 'all', label: 'Barchasi' },
              { id: 'active', label: 'Faol' },
              { id: 'inactive', label: 'Nofaol' },
              { id: 'archived', label: 'Arxivlangan' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                statusFilter === tab.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Teachers Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4 w-12">№</th>
                <th className="py-3 px-4">O&apos;qituvchi F.I.Sh.</th>
                <th className="py-3 px-4">Yo&apos;nalish / Fan</th>
                <th className="py-3 px-4 text-right">Guruhlar soni</th>
                <th className="py-3 px-4 text-right">Yuborilgan arizalar</th>
                <th className="py-3 px-4">Holati</th>
                <th className="py-3 px-4">Qo&apos;shilgan sana</th>
                <th className="py-3 px-4 text-right">Amallar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {filteredTeachers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-500">
                    Qidiruv bo&apos;yicha o&apos;qituvchilar topilmadi.
                  </td>
                </tr>
              ) : (
                filteredTeachers.map((teacher, idx) => {
                  const grpCount = groupCountByTeacher.get(teacher.id) || 0;
                  const subCount = submissionCountByTeacher.get(teacher.id) || 0;
                  return (
                    <tr key={teacher.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4 font-mono text-xs text-slate-500 tabular-nums">
                        {idx + 1}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{teacher.full_name}</div>
                        {teacher.phone && (
                          <div className="text-xs text-slate-500 font-mono tabular-nums">
                            {teacher.phone}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {teacher.subject || 'Umumiy kurs'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                        {grpCount} ta
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-slate-700 tabular-nums">
                        {subCount} ta
                      </td>
                      <td className="py-3 px-4 text-xs">
                        {teacher.status === 'active' ? (
                          <span className="font-semibold text-emerald-700">Faol</span>
                        ) : teacher.status === 'archived' ? (
                          <span className="font-medium text-amber-700">Arxivlangan</span>
                        ) : (
                          <span className="font-medium text-slate-500">Nofaol</span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-500 tabular-nums">
                        {formatDateUz(teacher.created_at.slice(0, 10))}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleToggleStatus(teacher)}
                            title={
                              teacher.status === 'active'
                                ? 'Nofaol qilish'
                                : 'Faollashtirish'
                            }
                            aria-label={`${teacher.full_name} holatini o'zgartirish`}
                            className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                          >
                            <Power className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(teacher)}
                            aria-label={`${teacher.full_name} ma'lumotlarini tahrirlash`}
                            className="p-1.5 text-slate-500 hover:text-sky-700 hover:bg-sky-50 rounded-lg transition-colors"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingTeacher(teacher)}
                            aria-label={`${teacher.full_name}ni o'chirish`}
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

      {/* Add / Edit Teacher Modal */}
      {isModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 space-y-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">
                {editingTeacher ? "O'qituvchini tahrirlash" : "Yangi o'qituvchi qo'shish"}
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

            <form onSubmit={handleSaveTeacher} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="teacher-fullname" className="block text-sm font-semibold text-slate-800">
                  Ism va familiya <span className="text-red-500">*</span>
                </label>
                <input
                  id="teacher-fullname"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Masalan: Abdulaziz Karimov"
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-600"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="teacher-subject" className="block text-sm font-semibold text-slate-800">
                  Fan / Yo&apos;nalish
                </label>
                <input
                  id="teacher-subject"
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Masalan: IELTS & General English"
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-600"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="teacher-phone" className="block text-sm font-semibold text-slate-800">
                  Telefon raqami
                </label>
                <input
                  id="teacher-phone"
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+998 90 123 45 67"
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-600"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="teacher-status" className="block text-sm font-semibold text-slate-800">
                  Holati
                </label>
                <select
                  id="teacher-status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as 'active' | 'inactive')}
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-600"
                >
                  <option value="active">Faol (o&apos;quvchilarga ko&apos;rinadi)</option>
                  <option value="inactive">Nofaol (o&apos;quvchilarga ko&apos;rinmaydi)</option>
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

      {/* Delete Confirmation Modal */}
      {deletingTeacher && (
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
                  O&apos;qituvchini o&apos;chirishni tasdiqlaysizmi?
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                  Siz <strong>{deletingTeacher.full_name}</strong> yozuvini o&apos;chirmoqchisiz. Agar ushbu
                  o&apos;qituvchiga biriktirilgan guruhlar yoki tarixiy to&apos;lov yozuvlari mavjud bo&apos;lsa,
                  ma&apos;lumotlar yaxlitligini saqlash uchun u avtomatik arxivlanadi.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeletingTeacher(null)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Bekor qilish
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
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
