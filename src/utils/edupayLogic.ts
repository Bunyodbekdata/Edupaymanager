/**
 * Pure domain logic for EduPay Manager:
 * - Uzbek name cleaning, normalization, validation, and alphabetical sorting
 * - Payment date validation and DD.MM.YYYY formatting
 * - Roster vs. submissions comparison
 * - Payment date distribution aggregation
 */

export const UZBEK_MONTHS = [
  'Yanvar',
  'Fevral',
  'Mart',
  'Aprel',
  'May',
  'Iyun',
  'Iyul',
  'Avgust',
  'Sentabr',
  'Oktabr',
  'Noyabr',
  'Dekabr',
] as const;

/**
 * Standardizes all common apostrophe and modifier letter variants used in Uzbek Latin text
 * (e.g. ‘, ’, `, ʻ, ʼ, ´, ˊ) into standard ASCII apostrophe (').
 */
export function standardizeUzbekApostrophes(input: string): string {
  return input.replace(/[\u2018\u2019\u02BB\u02BC\u0060\u00B4\u02CA\u2032]/g, "'");
}

/**
 * Cleans a student's full name by trimming leading/trailing whitespace,
 * collapsing multiple spaces into a single space, and standardizing apostrophes.
 */
export function cleanStudentName(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  return standardizeUzbekApostrophes(raw)
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Creates a normalized canonical key for duplicate detection and roster matching.
 */
export function normalizeStudentName(raw: string): string {
  return cleanStudentName(raw).toLowerCase();
}

/**
 * Validates that a student name is a reasonable full name (Ism va familiya) in Uzbek/Latin script.
 */
export function validateStudentName(raw: string): {
  valid: boolean;
  error?: string;
  cleaned: string;
} {
  const cleaned = cleanStudentName(raw);

  if (!cleaned) {
    return {
      valid: false,
      error: "Iltimos, ism va familiyangizni kiriting.",
      cleaned,
    };
  }

  if (cleaned.length < 5) {
    return {
      valid: false,
      error: "Ism va familiya juda qisqa. Iltimos, to'liq kiriting (masalan: Ali Valiyev).",
      cleaned,
    };
  }

  if (cleaned.length > 100) {
    return {
      valid: false,
      error: "Ism va familiya 100 ta belgidan oshmasligi kerak.",
      cleaned,
    };
  }

  // Allow Latin letters, Cyrillic letters (in case a user types Cyrillic, though Latin is primary),
  // standard apostrophe, hyphen, and spaces.
  const validCharsRegex = /^[A-Za-z\u00C0-\u024F\u0400-\u04FF'\-\s]+$/;
  if (!validCharsRegex.test(cleaned)) {
    return {
      valid: false,
      error: "Ism va familiyada faqat harflar, tire (-) va tutuq belgisi (') bo'lishi mumkin.",
      cleaned,
    };
  }

  const parts = cleaned.split(' ').filter(Boolean);
  if (parts.length < 2) {
    return {
      valid: false,
      error: "Iltimos, ism va familiyangizni to'liq kiriting (kamida ikkita so'z, masalan: Ali Valiyev).",
      cleaned,
    };
  }

  const hasTooShortWord = parts.some((part) => part.replace(/['\-]/g, '').length < 2);
  if (hasTooShortWord) {
    return {
      valid: false,
      error: "Ism va familiya qismlari kamida 2 ta harfdan iborat bo'lishi lozim.",
      cleaned,
    };
  }

  return { valid: true, cleaned };
}

/**
 * Maps Uzbek Latin letters and digraphs (o', g', sh, ch, ng) to sortable weights
 * so alphabetical ordering is consistent, case-insensitive, and locale-aware.
 */
function uzbekSortKey(str: string): string {
  const s = normalizeStudentName(str);
  // Replace digraphs and o'/g' with ordered tokens after base letters
  return s
    .replace(/o'/g, 'o\uFFFF1')
    .replace(/g'/g, 'g\uFFFF1')
    .replace(/sh/g, 's\uFFFF2')
    .replace(/ch/g, 'c\uFFFF2');
}

/**
 * Case-insensitive, Uzbek-aware alphabetical comparator.
 */
export function compareUzbekNames(a: string, b: string): number {
  const keyA = uzbekSortKey(a);
  const keyB = uzbekSortKey(b);
  if (keyA < keyB) return -1;
  if (keyA > keyB) return 1;
  return 0;
}

/**
 * Formats an ISO date string (YYYY-MM-DD) into DD.MM.YYYY format.
 */
export function formatDateUz(isoDate: string): string {
  if (!isoDate) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate.trim());
  if (!match) return isoDate;
  const [, year, month, day] = match;
  return `${day}.${month}.${year}`;
}

/**
 * Formats an ISO timestamp into DD.MM.YYYY HH:mm format.
 */
export function formatDateTimeUz(isoDateTime: string): string {
  if (!isoDateTime) return '';
  const d = new Date(isoDateTime);
  if (Number.isNaN(d.getTime())) return isoDateTime;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day}.${month}.${year} ${hours}:${minutes}`;
}

/**
 * Validates that a payment date is in YYYY-MM-DD format and within the collection period's allowed range.
 */
export function validatePaymentDate(
  paymentDate: string,
  allowedStartDate?: string | null,
  allowedEndDate?: string | null
): { valid: boolean; error?: string } {
  if (!paymentDate || typeof paymentDate !== 'string') {
    return { valid: false, error: "Iltimos, to'lov sanasini tanlang." };
  }

  const trimmed = paymentDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return { valid: false, error: "To'lov sanasi noto'g'ri formatda kiritilgan." };
  }

  const [y, m, d] = trimmed.split('-').map(Number);
  const dateObj = new Date(Date.UTC(y, m - 1, d));
  if (
    dateObj.getUTCFullYear() !== y ||
    dateObj.getUTCMonth() + 1 !== m ||
    dateObj.getUTCDate() !== d
  ) {
    return { valid: false, error: "Bunday sana mavjud emas." };
  }

  if (allowedStartDate && trimmed < allowedStartDate) {
    return {
      valid: false,
      error: `To'lov sanasi ${formatDateUz(allowedStartDate)} dan oldin bo'lishi mumkin emas.`,
    };
  }

  if (allowedEndDate && trimmed > allowedEndDate) {
    return {
      valid: false,
      error: `To'lov sanasi ${formatDateUz(allowedEndDate)} dan keyin bo'lishi mumkin emas.`,
    };
  }

  return { valid: true };
}

/**
 * Compares an imported student roster with actual submitted student names for a group.
 */
export function compareRosterWithSubmissions(
  rosterNames: string[],
  submissionNames: string[]
): {
  submitted: string[];
  notSubmitted: string[];
  extraSubmissions: string[];
  completionPercent: number;
} {
  const cleanRoster = Array.from(
    new Map(
      rosterNames
        .map((n) => cleanStudentName(n))
        .filter(Boolean)
        .map((n) => [normalizeStudentName(n), n])
    ).values()
  ).sort(compareUzbekNames);

  const submittedMap = new Map<string, string>();
  for (const sub of submissionNames) {
    const cleaned = cleanStudentName(sub);
    if (cleaned) {
      submittedMap.set(normalizeStudentName(cleaned), cleaned);
    }
  }

  const rosterKeySet = new Set(cleanRoster.map((r) => normalizeStudentName(r)));

  const submitted: string[] = [];
  const notSubmitted: string[] = [];

  for (const student of cleanRoster) {
    const key = normalizeStudentName(student);
    if (submittedMap.has(key)) {
      submitted.push(student);
    } else {
      notSubmitted.push(student);
    }
  }

  const extraSubmissions: string[] = [];
  for (const [key, name] of submittedMap.entries()) {
    if (!rosterKeySet.has(key)) {
      extraSubmissions.push(name);
    }
  }

  submitted.sort(compareUzbekNames);
  notSubmitted.sort(compareUzbekNames);
  extraSubmissions.sort(compareUzbekNames);

  const completionPercent =
    cleanRoster.length > 0 ? Math.round((submitted.length / cleanRoster.length) * 100) : 0;

  return {
    submitted,
    notSubmitted,
    extraSubmissions,
    completionPercent,
  };
}

export interface PaymentDateBucket {
  paymentDate: string;
  formattedDate: string;
  count: number;
  percentage: number;
  students: string[];
}

/**
 * Aggregates submissions by payment_date for monthly reporting and visual distribution charts.
 */
export function computePaymentDateDistribution<
  T extends { payment_date: string; student_full_name: string }
>(submissions: T[]): PaymentDateBucket[] {
  if (!submissions.length) return [];

  const map = new Map<string, string[]>();
  for (const sub of submissions) {
    const list = map.get(sub.payment_date) || [];
    list.push(cleanStudentName(sub.student_full_name));
    map.set(sub.payment_date, list);
  }

  const total = submissions.length;
  const sortedDates = Array.from(map.keys()).sort();

  return sortedDates.map((date) => {
    const students = (map.get(date) || []).sort(compareUzbekNames);
    return {
      paymentDate: date,
      formattedDate: formatDateUz(date),
      count: students.length,
      percentage: Math.round((students.length / total) * 100),
      students,
    };
  });
}

/**
 * Generates safe Excel worksheet names (max 31 chars, no forbidden characters: \ / ? * : [ ]).
 */
export function sanitizeExcelSheetName(name: string, usedNames: Set<string>): string {
  const base = name
    .replace(/[\\/?*:[\]]/g, '_')
    .trim()
    .slice(0, 28) || 'Guruh';

  let candidate = base;
  let counter = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${base.slice(0, 25)}_${counter}`;
    counter++;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Generates clean Excel filenames following the convention:
 * Tolov_hisoboti_Noyabr_2026.xlsx or IELTS_01_Noyabr_2026.xlsx
 */
export function buildExcelFilename(options: {
  monthName: string;
  year: number;
  groupName?: string;
  teacherName?: string;
}): string {
  const cleanPart = (s: string) =>
    standardizeUzbekApostrophes(s)
      .replace(/'/g, '')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

  const periodPart = `${cleanPart(options.monthName)}_${options.year}`;
  if (options.groupName) {
    return `${cleanPart(options.groupName)}_${periodPart}.xlsx`;
  }
  if (options.teacherName) {
    return `Oqituvchi_${cleanPart(options.teacherName)}_${periodPart}.xlsx`;
  }
  return `Tolov_hisoboti_${periodPart}.xlsx`;
}
