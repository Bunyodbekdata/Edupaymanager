import React, { useState, useMemo } from 'react';
import {
  Plus,
  Calendar,
  Play,
  Lock,
  RotateCcw,
  Edit2,
  X,
  AlertTriangle,
  CheckCircle2,
  Eye,
} from 'lucide-react';
import { CollectionPeriod, Group, Submission, Teacher } from '../types/edupay';
import {
  UZBEK_MONTHS,
  compareUzbekNames,
  formatDateUz,
} from '../utils/edupayLogic';

interface MonthlyCollectionsViewProps {
  token: string;
  periods: CollectionPeriod[];
  submissions: Submission[];
  teachers: Teacher[];
  groups: Group[];
  onRefresh: () => Promise<void>;
  onOpenReportsForPeriod: (periodId: string) => void;
}

export const MonthlyCollectionsView: React.FC<MonthlyCollectionsViewProps> = ({
  token,
  periods,
  submissions,
  teachers,
  groups,
  onRefresh,
  onOpenReportsForPeriod,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState<CollectionPeriod | null>(null);
  const [inspectingPeriod, setInspectingPeriod] = useState<CollectionPeriod | null>(null);

  const [monthNumber, setMonthNumber] = useState<number>(12);
  const [year, setYear] = useState<number>(2026);
  const [startDate, setStartDate] = useState<string>('2026-12-01');
  const [closingDate, setClosingDate] = useState<string>('2026-12-20');
  const [allowedStartDate, setAllowedStartDate] = useState<string>('2026-12-01');
  const [allowedEndDate, setAllowedEndDate] = useState<string>('2026-12-31');
  const [status, setStatus] = useState<'active' | 'closed' | 'inactive'>('active');

  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);

  const teacherMap = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers]);
  const groupMap = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);

  const submissionCountByPeriod = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of submissions) {
      map.set(s.collection_period_id, (map.get(s.collection_period_id) || 0) + 1);
    }
    return map;
  }, [submissions]);

  const handleMonthYearChange = (newMonth: number, newYear: number) => {
    setMonthNumber(newMonth);
    setYear(newYear);
    const mm = String(newMonth).padStart(2, '0');
    const lastDay = new Date(newYear, newMonth, 0).getDate();
    setStartDate(`${newYear}-${mm}-01`);
    setClosingDate(`${newYear}-${mm}-20`);
    setAllowedStartDate(`${newYear}-${mm}-01`);
    setAllowedEndDate(`${newYear}-${mm}-${String(lastDay).padStart(2, '0')}`);
  };

  const openCreateModal = () => {
    setEditingPeriod(null);
    handleMonthYearChange(12, 2026);
    setStatus('active');
    setModalError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (p: CollectionPeriod) => {
    setEditingPeriod(p);
    setMonthNumber(p.month_number);
    setYear(p.year);
    setStartDate(p.start_date);
    setClosingDate(p.closing_date);
    setAllowedStartDate(p.allowed_payment_start_date);
    setAllowedEndDate(p.allowed_payment_end_date);
    setStatus(p.status);
    setModalError(null);
    setIsModalOpen(true);
  };

  const handleSavePeriod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setModalError(null);

    if (allowedStartDate > allowedEndDate) {
      setModalError(
        "Ruxsat etilgan to'lov boshlanish sanasi tugash sanasidan keyin bo'lishi mumkin emas."
      );
      return;
    }

    setSaving(true);
    try {
      const url = editingPeriod
        ? `/api/admin/periods/${editingPeriod.id}`
        : '/api/admin/periods';
      const method = editingPeriod ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          month_number: monthNumber,
          year,
          start_date: startDate,
          closing_date: closingDate,
          allowed_payment_start_date: allowedStartDate,
          allowed_payment_end_date: allowedEndDate,
          status,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setModalError(data.error || "Saqlashda xatolik yuz berdi.");
        setSaving(false);
        return;
      }

      setIsModalOpen(false);
      setFeedbackBanner(
        editingPeriod
          ? `${editingPeriod.title} oylik yig'im davri yangilandi.`
          : `Yangi "${UZBEK_MONTHS[monthNumber - 1]} ${year}" oylik yig'im davri yaratildi.`
      );
      await onRefresh();
    } catch {
      setModalError("Server bilan bog'lanishda xatolik yuz berdi.");
    } finally {
      setSaving(false);
    }
  };

  const handleQuickStatusChange = async (
    p: CollectionPeriod,
    nextStatus: 'active' | 'closed' | 'inactive'
  ) => {
    try {
      const res = await fetch(`/api/admin/periods/${p.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: nextStatus }),
      });

      if (res.ok) {
        const label =
          nextStatus === 'active'
            ? 'Faol (ochiq)'
            : nextStatus === 'closed'
            ? 'Yopilgan'
            : 'Nofaol';
        setFeedbackBanner(`${p.title} yig'im davri holati "${label}" ga o'zgartirildi.`);
        await onRefresh();
      }
    } catch {
      // ignore
    }
  };

  const inspectedPeriodSubmissions = useMemo(() => {
    if (!inspectingPeriod) return [];
    return submissions
      .filter((s) => s.collection_period_id === inspectingPeriod.id)
      .sort((a, b) => compareUzbekNames(a.student_full_name, b.student_full_name));
  }, [inspectingPeriod, submissions]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Oylik yig&apos;imlar</h1>
          <p className="text-sm text-slate-500">
            Oylik to&apos;lov muddatlarini yig&apos;ish davrlarini ochish, yopish va arxiv yozuvlarini boshqarish
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold rounded-xl flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Yangi oylik yig&apos;im yaratish</span>
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

      {/* Collection Periods List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {periods.map((period) => {
          const count = submissionCountByPeriod.get(period.id) || 0;
          const isActive = period.status === 'active';
          const isClosed = period.status === 'closed';

          return (
            <div
              key={period.id}
              className={`bg-white border rounded-2xl p-6 space-y-4 ${
                isActive ? 'border-slate-900' : 'border-slate-200'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs">
                    {isActive ? (
                      <span className="font-semibold text-emerald-700">
                        Holati: Faol (Qabul ochiq)
                      </span>
                    ) : isClosed ? (
                      <span className="font-medium text-amber-700">
                        Holati: Yopilgan (Arxivda)
                      </span>
                    ) : (
                      <span className="font-medium text-slate-500">Holati: Nofaol</span>
                    )}
                  </div>
                  <h2 className="text-xl font-bold text-slate-900">{period.title}</h2>
                </div>

                <div className="text-right">
                  <div className="text-2xl font-mono font-bold text-slate-900 tabular-nums">
                    {count}
                  </div>
                  <div className="text-xs text-slate-500">ta yozuv</div>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Yig&apos;im ochiq muddati:</span>
                  <span className="font-mono font-medium text-slate-800 tabular-nums">
                    {formatDateUz(period.start_date)} – {formatDateUz(period.closing_date)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Ruxsat etilgan to&apos;lov sanalari:</span>
                  <span className="font-mono font-semibold text-sky-700 tabular-nums">
                    {formatDateUz(period.allowed_payment_start_date)} –{' '}
                    {formatDateUz(period.allowed_payment_end_date)}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {isActive ? (
                    <button
                      type="button"
                      onClick={() => handleQuickStatusChange(period, 'closed')}
                      className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>Yig&apos;imni yopish</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleQuickStatusChange(period, 'active')}
                      className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      {isClosed ? (
                        <>
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Qayta ochish (Faollashtirish)</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5" />
                          <span>Faollashtirish</span>
                        </>
                      )}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => openEditModal(period)}
                    className="px-3 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-xl flex items-center gap-1.5"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    <span>Sanalarni tahrirlash</span>
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setInspectingPeriod(period)}
                    className="px-3 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-xl flex items-center gap-1.5"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Yozuvlar ({count})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenReportsForPeriod(period.id)}
                    className="px-3 py-2 bg-sky-50 hover:bg-sky-100 text-sky-800 text-xs font-semibold rounded-xl"
                  >
                    Hisobot va Excel
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Create / Edit Collection Period Modal */}
      {isModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">
                {editingPeriod
                  ? `${editingPeriod.title} sozlamalari`
                  : "Yangi oylik yig'im davri yaratish"}
              </h2>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                aria-label="Yopish"
                className="p-1 text-slate-400 hover:text-slate-700"
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

            <form onSubmit={handleSavePeriod} className="space-y-4">
              {!editingPeriod && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label htmlFor="period-month" className="block text-xs font-semibold text-slate-700">
                      Oy
                    </label>
                    <select
                      id="period-month"
                      value={monthNumber}
                      onChange={(e) => handleMonthYearChange(Number(e.target.value), year)}
                      className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm bg-white"
                    >
                      {UZBEK_MONTHS.map((m, idx) => (
                        <option key={m} value={idx + 1}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="period-year" className="block text-xs font-semibold text-slate-700">
                      Yil
                    </label>
                    <input
                      id="period-year"
                      type="number"
                      min={2024}
                      max={2035}
                      value={year}
                      onChange={(e) => handleMonthYearChange(monthNumber, Number(e.target.value))}
                      className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm font-mono"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label htmlFor="period-start" className="block text-xs font-semibold text-slate-700">
                    Qabul boshlanishi
                  </label>
                  <input
                    id="period-start"
                    type="date"
                    required
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="period-close" className="block text-xs font-semibold text-slate-700">
                    Qabul yopilishi
                  </label>
                  <input
                    id="period-close"
                    type="date"
                    required
                    value={closingDate}
                    onChange={(e) => setClosingDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label htmlFor="allowed-start" className="block text-xs font-semibold text-slate-700">
                    To&apos;lov min. sanasi
                  </label>
                  <input
                    id="allowed-start"
                    type="date"
                    required
                    value={allowedStartDate}
                    onChange={(e) => setAllowedStartDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="allowed-end" className="block text-xs font-semibold text-slate-700">
                    To&apos;lov maks. sanasi
                  </label>
                  <input
                    id="allowed-end"
                    type="date"
                    required
                    value={allowedEndDate}
                    onChange={(e) => setAllowedEndDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="period-status" className="block text-xs font-semibold text-slate-700">
                  Holati
                </label>
                <select
                  id="period-status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as any)}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm bg-white"
                >
                  <option value="active">Faol (O&apos;quvchilar uchun ochiq)</option>
                  <option value="closed">Yopilgan (Qabul tugagan)</option>
                  <option value="inactive">Nofaol (Qoralama)</option>
                </select>
              </div>

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
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

      {/* Inspect Archived / Monthly Records Modal */}
      {inspectingPeriod && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  {inspectingPeriod.title} — Yig&apos;ilgan ma&apos;lumotlar arxivi
                </h3>
                <p className="text-xs text-slate-500">
                  Jami: {inspectedPeriodSubmissions.length} nafar o&apos;quvchi (Alifbo tartibida)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectingPeriod(null)}
                aria-label="Yopish"
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="max-h-96 overflow-y-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <th className="py-2.5 px-3 w-10">№</th>
                    <th className="py-2.5 px-3">O&apos;quvchi</th>
                    <th className="py-2.5 px-3">O&apos;qituvchi</th>
                    <th className="py-2.5 px-3">Guruh</th>
                    <th className="py-2.5 px-3 text-right">To&apos;lov sanasi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {inspectedPeriodSubmissions.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500 text-xs">
                        Ushbu oy uchun ma&apos;lumotlar yo&apos;q.
                      </td>
                    </tr>
                  ) : (
                    inspectedPeriodSubmissions.map((s, idx) => (
                      <tr key={s.id}>
                        <td className="py-2 px-3 font-mono text-xs text-slate-500 tabular-nums">
                          {idx + 1}
                        </td>
                        <td className="py-2 px-3 font-semibold text-slate-900">
                          <div className="flex flex-col">
                            <span>{s.student_full_name}</span>
                            {s.note && (
                              <span
                                className="inline-flex items-center gap-1 text-[11px] font-normal text-amber-800 bg-amber-50 border border-amber-200/80 rounded px-1.5 py-0.5 mt-0.5 w-fit max-w-xs truncate"
                                title={s.note}
                              >
                                <span className="font-semibold text-amber-900">Izoh:</span>
                                <span className="truncate">{s.note}</span>
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2 px-3 text-slate-600">
                          {teacherMap.get(s.teacher_id)?.full_name}
                        </td>
                        <td className="py-2 px-3 text-slate-700">
                          {groupMap.get(s.group_id)?.group_name}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-semibold text-sky-700 tabular-nums">
                          {formatDateUz(s.payment_date)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  const pid = inspectingPeriod.id;
                  setInspectingPeriod(null);
                  onOpenReportsForPeriod(pid);
                }}
                className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs sm:text-sm font-semibold rounded-xl"
              >
                Excel yuklab olish / Chop etish
              </button>
              <button
                type="button"
                onClick={() => setInspectingPeriod(null)}
                className="px-4 py-2 bg-slate-900 text-white text-xs sm:text-sm font-medium rounded-xl"
              >
                Yopish
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
