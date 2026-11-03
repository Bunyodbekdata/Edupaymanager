import React, { useState, useEffect, useMemo } from 'react';
import {
  Calendar,
  CheckCircle2,
  AlertTriangle,
  Search,
  User,
  Users,
  GraduationCap,
  ShieldCheck,
  ChevronDown,
} from 'lucide-react';
import { PublicAppContext } from '../types/edupay';
import {
  formatDateUz,
  validatePaymentDate,
  validateStudentName,
} from '../utils/edupayLogic';

interface SubmittedResult {
  id: string;
  student_full_name: string;
  teacher_name: string;
  group_name: string;
  payment_date: string;
  formatted_payment_date: string;
  period_title: string;
}

interface PublicStudentFormProps {
  onSecretTrigger?: () => void;
}

export const PublicStudentForm: React.FC<PublicStudentFormProps> = ({ onSecretTrigger }) => {
  const [context, setContext] = useState<PublicAppContext | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form state
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>('');
  const [teacherSearch, setTeacherSearch] = useState<string>('');
  const [teacherDropdownOpen, setTeacherDropdownOpen] = useState<boolean>(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [studentFullName, setStudentFullName] = useState<string>('');
  const [paymentDate, setPaymentDate] = useState<string>('');

  // Submission state
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [submittedData, setSubmittedData] = useState<SubmittedResult | null>(null);

  const fetchPublicContext = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/public/context');
      if (!res.ok) {
        throw new Error("Serverdan ma'lumotlarni yuklab bo'lmadi.");
      }
      const data: PublicAppContext = await res.json();
      setContext(data);
    } catch (err: any) {
      setLoadError(err.message || "Tarmoq xatoligi yuz berdi.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPublicContext();
  }, []);

  // Dynamically filter active teachers by search query
  const filteredTeachers = useMemo(() => {
    if (!context) return [];
    const q = teacherSearch.trim().toLowerCase();
    if (!q) return context.teachers;
    return context.teachers.filter(
      (t) =>
        t.full_name.toLowerCase().includes(q) ||
        (t.subject && t.subject.toLowerCase().includes(q))
    );
  }, [context, teacherSearch]);

  // Dynamically filter groups belonging ONLY to the selected teacher
  const availableGroups = useMemo(() => {
    if (!context || !selectedTeacherId) return [];
    return context.groups.filter((g) => g.teacher_id === selectedTeacherId);
  }, [context, selectedTeacherId]);

  const selectedTeacher = useMemo(
    () => context?.teachers.find((t) => t.id === selectedTeacherId) || null,
    [context, selectedTeacherId]
  );

  // Reset selected group whenever teacher changes
  const handleSelectTeacher = (teacherId: string) => {
    setSelectedTeacherId(teacherId);
    setSelectedGroupId('');
    setTeacherDropdownOpen(false);
    setFormError(null);
    setDuplicateWarning(null);
  };

  // Generate suggested dates within active period for 1-tap mobile convenience
  const quickDates = useMemo(() => {
    const period = context?.activePeriod;
    if (!period) return [];
    const min = period.allowed_payment_start_date;
    const max = period.allowed_payment_end_date;
    const yearMonth = min.slice(0, 7); // YYYY-MM
    const candidates = ['03', '05', '07', '10', '15', '20'].map(
      (day) => `${yearMonth}-${day}`
    );
    return candidates.filter((d) => d >= min && d <= max);
  }, [context]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    setFormError(null);
    setDuplicateWarning(null);

    if (!context?.activePeriod || context.activePeriod.status !== 'active') {
      setFormError("Hozirgi vaqtda faol oylik to'lov yig'imi mavjud emas.");
      return;
    }

    if (!selectedTeacherId) {
      setFormError("Iltimos, o'qituvchini tanlang.");
      return;
    }

    if (!selectedGroupId) {
      setFormError("Iltimos, guruhni tanlang.");
      return;
    }

    const groupBelongsToTeacher = availableGroups.some((g) => g.id === selectedGroupId);
    if (!groupBelongsToTeacher) {
      setFormError("Tanlangan guruh ushbu o'qituvchiga tegishli emas.");
      return;
    }

    const nameCheck = validateStudentName(studentFullName);
    if (!nameCheck.valid) {
      setFormError(nameCheck.error || "Iltimos, ism va familiyani to'g'ri kiriting.");
      return;
    }

    const dateCheck = validatePaymentDate(
      paymentDate,
      context.activePeriod.allowed_payment_start_date,
      context.activePeriod.allowed_payment_end_date
    );
    if (!dateCheck.valid) {
      setFormError(dateCheck.error || "Iltimos, to'lov sanasini to'g'ri tanlang.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/public/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teacher_id: selectedTeacherId,
          group_id: selectedGroupId,
          student_full_name: nameCheck.cleaned,
          payment_date: paymentDate,
        }),
      });

      const payload = await response.json();

      if (response.status === 409 && payload.code === 'DUPLICATE_SUBMISSION') {
        setDuplicateWarning(payload.error);
        setSubmitting(false);
        return;
      }

      if (!response.ok) {
        setFormError(payload.error || "Ma'lumotni yuborishda xatolik yuz berdi.");
        setSubmitting(false);
        return;
      }

      setSubmittedData(payload.submission);
    } catch (err) {
      setFormError("Server bilan bog'lanishda xatolik yuz berdi. Internet aloqasini tekshiring.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setSubmittedData(null);
    setStudentFullName('');
    setPaymentDate('');
    setSelectedGroupId('');
    setFormError(null);
    setDuplicateWarning(null);
  };

  const activePeriod = context?.activePeriod;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Bar following 3-zone contract */}
      <header className="w-full bg-white border-b border-slate-200 px-4 sm:px-8 py-3.5 flex items-center justify-between gap-4">
        <a
          href="/"
          className="text-base sm:text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 flex items-center gap-2.5"
        >
          <span className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center font-bold text-sm">
            EP
          </span>
          <span>EduPay Manager</span>
        </a>

        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="hidden sm:inline">O&apos;quv markazi to&apos;lov muddatlari tizimi</span>
          {activePeriod && (
            <>
              <span aria-hidden="true" className="hidden sm:inline">·</span>
              <span className="font-semibold text-slate-800 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-lg">
                {activePeriod.title}
              </span>
            </>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center px-4 py-8 sm:py-12">
        <div className="w-full max-w-lg">
          {loading ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-5">
              <div className="h-7 w-3/4 bg-slate-100 rounded animate-pulse" />
              <div className="h-4 w-2/3 bg-slate-100 rounded animate-pulse" />
              <div className="space-y-4 pt-2">
                <div className="h-12 bg-slate-100 rounded-xl animate-pulse" />
                <div className="h-12 bg-slate-100 rounded-xl animate-pulse" />
                <div className="h-12 bg-slate-100 rounded-xl animate-pulse" />
                <div className="h-12 bg-slate-100 rounded-xl animate-pulse" />
              </div>
            </div>
          ) : loadError ? (
            <div className="bg-white border border-red-200 rounded-2xl p-6 sm:p-8 text-center space-y-4">
              <div className="w-12 h-12 rounded-xl bg-red-50 text-red-600 flex items-center justify-center mx-auto">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h1 className="text-lg font-bold text-slate-900">Xatolik yuz berdi</h1>
              <p className="text-sm text-slate-600">{loadError}</p>
              <button
                type="button"
                onClick={fetchPublicContext}
                className="px-5 py-2.5 bg-slate-900 text-white text-sm font-medium rounded-xl hover:bg-slate-800 transition-colors"
              >
                Qayta yuklash
              </button>
            </div>
          ) : !activePeriod || activePeriod.status !== 'active' ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 text-center space-y-4">
              <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto">
                <Calendar className="w-6 h-6" />
              </div>
              <h1 className="text-xl font-bold text-slate-900">
                Oylik to&apos;lov muddatini belgilash
              </h1>
              <p className="text-sm text-slate-600 leading-relaxed">
                Hozirgi vaqtda oylik to&apos;lov muddatlarini yig&apos;ish davri yopilgan yoki hali faollashtirilmagan.
                Qo&apos;shimcha ma&apos;lumot uchun o&apos;quv markazi administratoriga murojaat qiling.
              </p>
            </div>
          ) : submittedData ? (
            /* SUCCESS SCREEN */
            <div
              data-testid="submission-success-card"
              className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6"
            >
              <div className="flex flex-col items-center text-center space-y-2.5">
                <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
                  Ma&apos;lumotlaringiz qabul qilindi!
                </h1>
                <p className="text-sm text-slate-600">
                  To&apos;lov muddati muvaffaqiyatli saqlandi. Rahmat!
                </p>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 sm:p-5 divide-y divide-slate-200 text-sm">
                <div className="py-2.5 first:pt-0 flex items-center justify-between gap-4">
                  <span className="text-slate-500">O&apos;quvchi:</span>
                  <span className="font-semibold text-slate-900 text-right">
                    {submittedData.student_full_name}
                  </span>
                </div>
                <div className="py-2.5 flex items-center justify-between gap-4">
                  <span className="text-slate-500">O&apos;qituvchi:</span>
                  <span className="font-medium text-slate-900 text-right">
                    {submittedData.teacher_name}
                  </span>
                </div>
                <div className="py-2.5 flex items-center justify-between gap-4">
                  <span className="text-slate-500">Guruh:</span>
                  <span className="font-medium text-slate-900 text-right">
                    {submittedData.group_name}
                  </span>
                </div>
                <div className="py-2.5 last:pb-0 flex items-center justify-between gap-4">
                  <span className="text-slate-500">To&apos;lov sanasi:</span>
                  <span className="font-mono font-semibold text-sky-700 tabular-nums text-right">
                    {submittedData.formatted_payment_date}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleReset}
                className="w-full py-3 px-5 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm rounded-xl transition-colors"
              >
                Yopish
              </button>
            </div>
          ) : (
            /* STUDENT SUBMISSION FORM */
            <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <span className="whitespace-nowrap font-medium text-slate-700">
                    Faol davr: {activePeriod.title}
                  </span>
                  <span className="font-mono tabular-nums whitespace-nowrap">
                    {formatDateUz(activePeriod.allowed_payment_start_date)} –{' '}
                    {formatDateUz(activePeriod.allowed_payment_end_date)}
                  </span>
                </div>
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                  Oylik to&apos;lov muddatini belgilash
                </h1>
                <p className="text-sm text-slate-600">
                  Iltimos, quyidagi ma&apos;lumotlarni to&apos;g&apos;ri kiriting.
                </p>
              </div>

              {formError && (
                <div
                  role="alert"
                  className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs sm:text-sm flex items-start gap-2.5"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                  <span>{formError}</span>
                </div>
              )}

              {duplicateWarning && (
                <div
                  role="alert"
                  className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs sm:text-sm space-y-1.5"
                >
                  <div className="flex items-center gap-2 font-semibold text-amber-800">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                    <span>Takroriy yozuv aniqlandi</span>
                  </div>
                  <p className="leading-relaxed text-amber-800">{duplicateWarning}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                {/* Field 1: O'qituvchini tanlang */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="student-teacher-select"
                    className="block text-sm font-semibold text-slate-800"
                  >
                    1. O&apos;qituvchini tanlang <span className="text-red-500">*</span>
                  </label>

                  {/* Searchable custom dropdown + native select for accessibility */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setTeacherDropdownOpen((prev) => !prev)}
                      aria-expanded={teacherDropdownOpen}
                      aria-label="O'qituvchini ro'yxatdan qidirish"
                      className="w-full px-3.5 py-3 text-left bg-white border border-slate-300 rounded-xl text-sm flex items-center justify-between gap-2 hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-600"
                    >
                      <span className="flex items-center gap-2.5 truncate">
                        <GraduationCap className="w-4 h-4 text-slate-400 shrink-0" />
                        {selectedTeacher ? (
                          <span className="font-medium text-slate-900">
                            {selectedTeacher.full_name}
                            {selectedTeacher.subject ? ` · ${selectedTeacher.subject}` : ''}
                          </span>
                        ) : (
                          <span className="text-slate-400">O&apos;qituvchini tanlang...</span>
                        )}
                      </span>
                      <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                    </button>

                    {teacherDropdownOpen && (
                      <div className="absolute z-20 mt-1.5 w-full bg-white border border-slate-200 rounded-xl shadow-lg p-2 space-y-2">
                        <div className="relative">
                          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={teacherSearch}
                            onChange={(e) => setTeacherSearch(e.target.value)}
                            placeholder="O'qituvchi ismini qidiring..."
                            aria-label="O'qituvchi ismini qidiring"
                            className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
                          />
                        </div>
                        <div className="max-h-48 overflow-y-auto divide-y divide-slate-100">
                          {filteredTeachers.length === 0 ? (
                            <div className="py-3 px-3 text-xs text-slate-500 text-center">
                              O&apos;qituvchi topilmadi
                            </div>
                          ) : (
                            filteredTeachers.map((t) => (
                              <button
                                key={t.id}
                                type="button"
                                onClick={() => handleSelectTeacher(t.id)}
                                className={`w-full text-left px-3 py-2.5 text-sm rounded-lg flex items-center justify-between transition-colors ${
                                  selectedTeacherId === t.id
                                    ? 'bg-sky-50 text-sky-900 font-semibold'
                                    : 'text-slate-700 hover:bg-slate-50'
                                }`}
                              >
                                <span>{t.full_name}</span>
                                {t.subject && (
                                  <span className="text-xs text-slate-400">{t.subject}</span>
                                )}
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Accessible native select synced with state */}
                  <select
                    id="student-teacher-select"
                    value={selectedTeacherId}
                    onChange={(e) => handleSelectTeacher(e.target.value)}
                    className="sr-only"
                    aria-label="O'qituvchini tanlang"
                  >
                    <option value="">O&apos;qituvchini tanlang</option>
                    {context.teachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.full_name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Field 2: Guruhni tanlang */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="student-group-select"
                    className="block text-sm font-semibold text-slate-800"
                  >
                    2. Guruhni tanlang <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Users className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <select
                      id="student-group-select"
                      value={selectedGroupId}
                      disabled={!selectedTeacherId}
                      onChange={(e) => {
                        setSelectedGroupId(e.target.value);
                        setFormError(null);
                        setDuplicateWarning(null);
                      }}
                      className="w-full pl-10 pr-4 py-3 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 disabled:bg-slate-100 disabled:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-600"
                    >
                      <option value="">
                        {!selectedTeacherId
                          ? "Avval o'qituvchini tanlang"
                          : availableGroups.length === 0
                          ? "Ushbu o'qituvchida faol guruhlar yo'q"
                          : 'Guruhni tanlang...'}
                      </option>
                      {availableGroups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.group_name}
                          {g.schedule_info ? ` (${g.schedule_info})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Field 3: Ism va familiya */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="student-fullname-input"
                    className="block text-sm font-semibold text-slate-800"
                  >
                    3. Ism va familiya <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="student-fullname-input"
                      type="text"
                      required
                      value={studentFullName}
                      onChange={(e) => {
                        setStudentFullName(e.target.value);
                        setFormError(null);
                        setDuplicateWarning(null);
                      }}
                      placeholder="Masalan: Ali Valiyev"
                      autoComplete="name"
                      className="w-full pl-10 pr-4 py-3 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-600"
                    />
                  </div>
                  <p className="text-xs text-slate-500">
                    Familiya va ismingizni to&apos;liq yozing (masalan: Valiyev Ali).
                  </p>
                </div>

                {/* Field 4: To'lov sanasi */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="student-payment-date"
                      className="block text-sm font-semibold text-slate-800"
                    >
                      4. To&apos;lov sanasi <span className="text-red-500">*</span>
                    </label>
                    {paymentDate && (
                      <span className="text-xs font-mono font-semibold text-sky-700 tabular-nums">
                        Tanlangan: {formatDateUz(paymentDate)}
                      </span>
                    )}
                  </div>

                  <div className="relative">
                    <Calendar className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="student-payment-date"
                      type="date"
                      required
                      min={activePeriod.allowed_payment_start_date}
                      max={activePeriod.allowed_payment_end_date}
                      value={paymentDate}
                      onChange={(e) => {
                        setPaymentDate(e.target.value);
                        setFormError(null);
                        setDuplicateWarning(null);
                      }}
                      className="w-full pl-10 pr-4 py-3 bg-white border border-slate-300 rounded-xl text-sm font-mono tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                    />
                  </div>

                  {/* Quick date selection buttons for mobile convenience */}
                  {quickDates.length > 0 && (
                    <div className="pt-1 space-y-1.5">
                      <span className="block text-xs text-slate-500">
                        Tezkor sanani tanlash (KK.OO.YYYY):
                      </span>
                      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                        {quickDates.map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => {
                              setPaymentDate(d);
                              setFormError(null);
                              setDuplicateWarning(null);
                            }}
                            className={`py-1.5 px-2 text-xs font-mono tabular-nums rounded-lg border transition-colors ${
                              paymentDate === d
                                ? 'bg-slate-900 text-white border-slate-900 font-semibold'
                                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            {formatDateUz(d).slice(0, 5)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full py-3.5 px-6 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white font-semibold text-sm rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {submitting ? (
                      <span>Yuborilmoqda...</span>
                    ) : (
                      <span>Ma&apos;lumotlarni yuborish</span>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </main>

      {/* Quiet Footer */}
      <footer className="py-4 px-4 sm:px-6 text-center text-xs text-slate-500 border-t border-slate-200 bg-white">
        <div className="max-w-lg mx-auto flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={onSecretTrigger}
            className="flex items-center gap-1.5 whitespace-nowrap text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span>Ma&apos;lumotlar xavfsiz himoyalangan</span>
          </button>
          <button
            type="button"
            onClick={onSecretTrigger}
            className="whitespace-nowrap text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
          >
            EduPay Manager © {new Date().getFullYear()}
          </button>
        </div>
      </footer>
    </div>
  );
};
