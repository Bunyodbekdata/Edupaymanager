import React, { useState, useMemo } from 'react';
import {
  FileSpreadsheet,
  Printer,
  BarChart3,
  Download,
  Calendar,
  CheckCircle2,
} from 'lucide-react';
import { CollectionPeriod, Group, Submission, Teacher } from '../types/edupay';
import {
  compareUzbekNames,
  computePaymentDateDistribution,
  formatDateUz,
  normalizeStudentName,
} from '../utils/edupayLogic';
import { generateSubmissionsExcelBuffer } from '../utils/excelExport';

interface ReportsAndExportViewProps {
  token?: string;
  periods: CollectionPeriod[];
  teachers: Teacher[];
  groups: Group[];
  submissions: Submission[];
  initialPeriodId?: string;
}

export const ReportsAndExportView: React.FC<ReportsAndExportViewProps> = ({
  token,
  periods,
  teachers,
  groups,
  submissions,
  initialPeriodId,
}) => {
  const defaultPeriod = useMemo(
    () =>
      (initialPeriodId ? periods.find((p) => p.id === initialPeriodId) : null) ||
      periods.find((p) => p.status === 'active') ||
      periods[0] ||
      null,
    [periods, initialPeriodId]
  );

  const [selectedPeriodId, setSelectedPeriodId] = useState<string>(defaultPeriod?.id || '');
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>('all');
  const [selectedGroupId, setSelectedGroupId] = useState<string>('all');
  const [exporting, setExporting] = useState<boolean>(false);
  const [exportSuccessMessage, setExportSuccessMessage] = useState<string | null>(null);

  const teacherMap = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers]);
  const groupMap = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);

  const currentPeriod = useMemo(
    () => periods.find((p) => p.id === selectedPeriodId) || defaultPeriod,
    [periods, selectedPeriodId, defaultPeriod]
  );

  const availableGroups = useMemo(() => {
    if (selectedTeacherId === 'all') return groups;
    return groups.filter((g) => g.teacher_id === selectedTeacherId);
  }, [groups, selectedTeacherId]);

  const filteredSubmissions = useMemo(() => {
    if (!currentPeriod) return [];
    return submissions
      .filter((s) => {
        if (s.collection_period_id !== currentPeriod.id) return false;
        if (selectedTeacherId !== 'all' && s.teacher_id !== selectedTeacherId) return false;
        if (selectedGroupId !== 'all' && s.group_id !== selectedGroupId) return false;
        return true;
      })
      .sort((a, b) => compareUzbekNames(a.student_full_name, b.student_full_name));
  }, [submissions, currentPeriod, selectedTeacherId, selectedGroupId]);

  const uniqueStudentsCount = useMemo(() => {
    const set = new Set(
      filteredSubmissions.map((s) => `${s.group_id}:${normalizeStudentName(s.student_full_name)}`)
    );
    return set.size;
  }, [filteredSubmissions]);

  const paymentDateDistribution = useMemo(
    () => computePaymentDateDistribution(filteredSubmissions),
    [filteredSubmissions]
  );

  const maxCountInDate = useMemo(
    () => Math.max(1, ...paymentDateDistribution.map((b) => b.count)),
    [paymentDateDistribution]
  );

  const handleDownloadExcel = async () => {
    if (!currentPeriod || exporting) return;
    setExporting(true);
    setExportSuccessMessage(null);
    try {
      const { buffer, filename, sheetNames } = await generateSubmissionsExcelBuffer({
        period: currentPeriod,
        submissions,
        teachers,
        groups,
        selectedTeacherId,
        selectedGroupId,
      });

      if (token) {
        try {
          const params = new URLSearchParams({
            period_id: currentPeriod.id,
            teacher_id: selectedTeacherId,
            group_id: selectedGroupId,
          });
          await fetch(`/api/admin/export-excel?${params.toString()}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
        } catch {
          // Offline / local fallback
        }
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

      setExportSuccessMessage(
        `Excel hisoboti yuklab olindi: ${filename} (Sahifalar: ${sheetNames.join(', ')})`
      );
    } finally {
      setExporting(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  // Group filtered submissions by group for clean print/office view
  const groupedForPrint = useMemo(() => {
    const map = new Map<string, Submission[]>();
    for (const sub of filteredSubmissions) {
      const arr = map.get(sub.group_id) || [];
      arr.push(sub);
      map.set(sub.group_id, arr);
    }
    return Array.from(map.entries())
      .map(([gId, subs]) => ({
        group: groupMap.get(gId),
        teacher: teacherMap.get(groupMap.get(gId)?.teacher_id || ''),
        submissions: subs.sort((a, b) =>
          compareUzbekNames(a.student_full_name, b.student_full_name)
        ),
      }))
      .sort((a, b) =>
        compareUzbekNames(a.group?.group_name || '', b.group?.group_name || '')
      );
  }, [filteredSubmissions, groupMap, teacherMap]);

  return (
    <div className="space-y-6">
      {/* Screen Header (Hidden when printing) */}
      <div className="no-print flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            Oylik hisobotlar, Excel eksport va chop etish
          </h1>
          <p className="text-sm text-slate-500">
            To&apos;lov sanalari taqsimoti, guruhlar bo&apos;yicha alohida Excel varaqlar va A4 chop etish shakli
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={handlePrint}
            className="px-4 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs sm:text-sm font-semibold rounded-xl flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Printer className="w-4 h-4 text-slate-600" />
            <span>Ro&apos;yxatni chop etish (A4)</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadExcel}
            disabled={exporting || !currentPeriod}
            className="px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-400 text-white text-xs sm:text-sm font-semibold rounded-xl flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>{exporting ? 'Tayyorlanmoqda...' : 'Excel (.xlsx) yuklab olish'}</span>
          </button>
        </div>
      </div>

      {exportSuccessMessage && (
        <div
          data-testid="excel-export-confirmation"
          className="no-print p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2.5 text-xs sm:text-sm text-emerald-900"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{exportSuccessMessage}</span>
        </div>
      )}

      {/* Filter Controls for Report & Export (Hidden when printing) */}
      <div className="no-print bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="space-y-1">
          <label htmlFor="report-period-select" className="block text-xs font-semibold text-slate-700">
            1. Oy va yilni tanlang
          </label>
          <select
            id="report-period-select"
            value={selectedPeriodId}
            onChange={(e) => setSelectedPeriodId(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-medium"
          >
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} ({p.status === 'active' ? 'Faol' : 'Arxiv'})
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="report-teacher-select" className="block text-xs font-semibold text-slate-700">
            2. O&apos;qituvchi bo&apos;yicha saralash
          </label>
          <select
            id="report-teacher-select"
            value={selectedTeacherId}
            onChange={(e) => {
              setSelectedTeacherId(e.target.value);
              setSelectedGroupId('all');
            }}
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
          >
            <option value="all">Barcha o&apos;qituvchilar</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.full_name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="report-group-select" className="block text-xs font-semibold text-slate-700">
            3. Guruh bo&apos;yicha saralash
          </label>
          <select
            id="report-group-select"
            value={selectedGroupId}
            onChange={(e) => setSelectedGroupId(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
          >
            <option value="all">Barcha guruhlar</option>
            {availableGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.group_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Summary KPI Strip (Hidden when printing) */}
      <div className="no-print grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs text-slate-500">Tanlangan davr yuborilgan ma&apos;lumotlar</div>
          <div className="mt-1 text-2xl font-mono font-bold text-slate-900 tabular-nums">
            {filteredSubmissions.length} ta
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Davr: {currentPeriod?.title || 'Belgilanmagan'}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs text-slate-500">Noyob o&apos;quvchilar soni</div>
          <div className="mt-1 text-2xl font-mono font-bold text-slate-900 tabular-nums">
            {uniqueStudentsCount} nafar
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Faol guruhlar kesimida: {groupedForPrint.length} ta guruh
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs text-slate-500">To&apos;lov sanalari soni</div>
          <div className="mt-1 text-2xl font-mono font-bold text-sky-700 tabular-nums">
            {paymentDateDistribution.length} kun
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Eng ko&apos;p tanlangan sana:{' '}
            {paymentDateDistribution.length > 0
              ? [...paymentDateDistribution].sort((a, b) => b.count - a.count)[0].formattedDate
              : '—'}
          </div>
        </div>
      </div>

      {/* Visual Payment Date Distribution Chart & Grouped Table (Hidden when printing) */}
      <div className="no-print grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Visual Bar Chart */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-sky-600" />
                <span>To&apos;lov sanalari bo&apos;yicha taqsimot diagrammasi</span>
              </h2>
              <p className="text-xs text-slate-500">
                Har bir sanada nechta o&apos;quvchi to&apos;lov qilishni rejalashtirgani
              </p>
            </div>
          </div>

          {paymentDateDistribution.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">
              Tanlangan filterlar bo&apos;yicha ma&apos;lumotlar mavjud emas.
            </div>
          ) : (
            <div className="space-y-3 pt-2">
              {paymentDateDistribution.map((bucket) => {
                const barWidthPercent = Math.max(
                  8,
                  Math.round((bucket.count / maxCountInDate) * 100)
                );
                return (
                  <div key={bucket.paymentDate} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono font-semibold text-slate-800 tabular-nums flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        {bucket.formattedDate}
                      </span>
                      <span className="font-mono text-slate-700 tabular-nums">
                        <strong>{bucket.count}</strong> ta o&apos;quvchi ({bucket.percentage}%)
                      </span>
                    </div>
                    <div className="w-full h-3 bg-slate-100 rounded-lg overflow-hidden">
                      <div
                        className="h-full bg-slate-900 rounded-lg transition-transform"
                        style={{ width: `${barWidthPercent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Grouped By Payment Date Table */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Sanalar kesimida o&apos;quvchilar jadvali
            </h2>
            <p className="text-xs text-slate-500">
              To&apos;lov sanasi va shu kunga yozilgan o&apos;quvchilar ro&apos;yxati
            </p>
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-2.5 px-3">To&apos;lov sanasi</th>
                  <th className="py-2.5 px-3 text-right">O&apos;quvchilar soni</th>
                  <th className="py-2.5 px-3">O&apos;quvchilar (Alifbo tartibida)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {paymentDateDistribution.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-8 text-center text-slate-500 text-xs">
                      Ma&apos;lumotlar mavjud emas.
                    </td>
                  </tr>
                ) : (
                  paymentDateDistribution.map((b) => (
                    <tr key={b.paymentDate} className="align-top">
                      <td className="py-2.5 px-3 font-mono font-semibold text-sky-700 tabular-nums whitespace-nowrap">
                        {b.formattedDate}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 tabular-nums">
                        {b.count}
                      </td>
                      <td className="py-2.5 px-3 text-xs text-slate-700 leading-relaxed">
                        {b.students.join(', ')}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* PRINT-FRIENDLY & GROUP-ORGANIZED REPORT SECTION */}
      <div className="print-container bg-white border border-slate-200 rounded-xl p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              EduPay Manager — O&apos;quvchilar to&apos;lov muddatlari ro&apos;yxati ({currentPeriod?.title})
            </h2>
            <p className="text-xs text-slate-500">
              Guruhlar va o&apos;qituvchilar bo&apos;yicha alifbo tartibida shakllantirilgan rasmiy jadval
            </p>
          </div>
          <div className="no-print">
            <button
              type="button"
              onClick={handleDownloadExcel}
              className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 flex items-center gap-1.5"
            >
              <Download className="w-4 h-4" />
              <span>Barcha guruhlarni Excel (.xlsx) formatda yuklash</span>
            </button>
          </div>
        </div>

        {groupedForPrint.length === 0 ? (
          <div className="py-10 text-center text-slate-500 text-sm">
            Tanlangan mezonlar bo&apos;yicha yozuvlar topilmadi.
          </div>
        ) : (
          <div className="space-y-8">
            {groupedForPrint.map(({ group, teacher, submissions: grpSubs }) => (
              <div key={group?.id || 'unknown'} className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-4 py-2.5 rounded-lg border border-slate-200">
                  <div className="text-sm font-bold text-slate-900">
                    Guruh: {group?.group_name || "Noma'lum"}
                  </div>
                  <div className="text-xs text-slate-600">
                    O&apos;qituvchi: <strong className="text-slate-900">{teacher?.full_name || '—'}</strong> ·
                    Jami o&apos;quvchilar:{' '}
                    <strong className="font-mono text-slate-900 tabular-nums">
                      {grpSubs.length}
                    </strong>{' '}
                    nafar
                  </div>
                </div>

                <table className="w-full text-left border-collapse text-sm border border-slate-200">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200 text-xs font-bold text-slate-800">
                      <th className="py-2 px-3 w-12 text-center border-r border-slate-200">№</th>
                      <th className="py-2 px-3 border-r border-slate-200">
                        O&apos;quvchi ismi va familiyasi
                      </th>
                      <th className="py-2 px-3 w-40 text-center">To&apos;lov sanasi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {grpSubs.map((sub, i) => (
                      <tr key={sub.id} className="even:bg-slate-50/60">
                        <td className="py-2 px-3 text-center font-mono text-xs text-slate-600 tabular-nums border-r border-slate-200">
                          {i + 1}
                        </td>
                        <td className="py-2 px-3 font-medium text-slate-900 border-r border-slate-200">
                          {sub.student_full_name}
                        </td>
                        <td className="py-2 px-3 text-center font-mono font-semibold text-slate-900 tabular-nums">
                          {formatDateUz(sub.payment_date)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
