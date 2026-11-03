import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  cleanStudentName,
  normalizeStudentName,
  validateStudentName,
  compareUzbekNames,
  formatDateUz,
  validatePaymentDate,
  compareRosterWithSubmissions,
  computePaymentDateDistribution,
  buildExcelFilename,
} from './edupayLogic';
import { generateSubmissionsExcelBuffer } from './excelExport';

test('cleanStudentName and normalizeStudentName handle spaces and Uzbek apostrophes', () => {
  assert.equal(cleanStudentName("   O‘ktamov   G‘olibjon  "), "O'ktamov G'olibjon");
  assert.equal(
    normalizeStudentName("O‘ktamov G’olibjon"),
    normalizeStudentName("o'ktamov   g`olibjon")
  );
});

test('validateStudentName enforces full name rules in Uzbek', () => {
  assert.equal(validateStudentName('').valid, false);
  assert.equal(validateStudentName('Ali').valid, false);
  assert.equal(validateStudentName('A B').valid, false);
  const validResult = validateStudentName("  G‘aniyeva   Go‘zal  ");
  assert.equal(validResult.valid, true);
  assert.equal(validResult.cleaned, "G'aniyeva Go'zal");
});

test('compareUzbekNames sorts student names alphabetically and case-insensitively', () => {
  const unsorted = [
    'Valiyev Ali',
    'Abdullayev Aziz',
    'Rahimov Sardor',
    'Karimov Akmal',
  ];
  const sorted = [...unsorted].sort(compareUzbekNames);
  assert.deepEqual(sorted, [
    'Abdullayev Aziz',
    'Karimov Akmal',
    'Rahimov Sardor',
    'Valiyev Ali',
  ]);
});

test('formatDateUz and validatePaymentDate enforce DD.MM.YYYY display and period boundaries', () => {
  assert.equal(formatDateUz('2026-11-05'), '05.11.2026');
  assert.equal(
    validatePaymentDate('2026-11-05', '2026-11-01', '2026-11-25').valid,
    true
  );
  assert.equal(
    validatePaymentDate('2026-10-29', '2026-11-01', '2026-11-25').valid,
    false
  );
  assert.equal(
    validatePaymentDate('2026-11-28', '2026-11-01', '2026-11-25').valid,
    false
  );
});

test('compareRosterWithSubmissions accurately identifies submitted and missing students', () => {
  const roster = ['Valiyev Ali', "O‘ktamov Shoxrux", 'Karimova Malika'];
  const submissions = ["o'ktamov shoxrux", 'Valiyev Ali'];
  const comparison = compareRosterWithSubmissions(roster, submissions);
  assert.deepEqual(comparison.submitted, ["O'ktamov Shoxrux", 'Valiyev Ali']);
  assert.deepEqual(comparison.notSubmitted, ['Karimova Malika']);
  assert.equal(comparison.completionPercent, 67);
});

test('computePaymentDateDistribution groups by date and sorts students alphabetically', () => {
  const dist = computePaymentDateDistribution([
    { payment_date: '2026-11-10', student_full_name: 'Valiyev Ali' },
    { payment_date: '2026-11-05', student_full_name: 'Karimov Akmal' },
    { payment_date: '2026-11-05', student_full_name: 'Abdullayev Aziz' },
  ]);
  assert.equal(dist.length, 2);
  assert.equal(dist[0].formattedDate, '05.11.2026');
  assert.equal(dist[0].count, 2);
  assert.deepEqual(dist[0].students, ['Abdullayev Aziz', 'Karimov Akmal']);
  assert.equal(dist[1].formattedDate, '10.11.2026');
});

test('buildExcelFilename follows required naming conventions', () => {
  assert.equal(
    buildExcelFilename({ monthName: 'Noyabr', year: 2026 }),
    'Tolov_hisoboti_Noyabr_2026.xlsx'
  );
  assert.equal(
    buildExcelFilename({ monthName: 'Noyabr', year: 2026, groupName: 'IELTS-01' }),
    'IELTS_01_Noyabr_2026.xlsx'
  );
});

test('generateSubmissionsExcelBuffer creates valid multi-sheet Excel workbook with sorted rows', async () => {
  const { buffer, filename, sheetNames } = await generateSubmissionsExcelBuffer({
    period: {
      id: 'prd-2026-11',
      month_name: 'Noyabr',
      month_number: 11,
      year: 2026,
      title: 'Noyabr 2026',
      start_date: '2026-11-01',
      closing_date: '2026-11-20',
      allowed_payment_start_date: '2026-11-01',
      allowed_payment_end_date: '2026-11-30',
      status: 'active',
      created_at: '2026-11-01T00:00:00Z',
    },
    teachers: [
      {
        id: 't1',
        full_name: 'Abdulaziz Karimov',
        status: 'active',
        created_at: '2026-09-01T00:00:00Z',
      },
    ],
    groups: [
      {
        id: 'g1',
        group_name: 'IELTS-01',
        teacher_id: 't1',
        status: 'active',
        created_at: '2026-09-01T00:00:00Z',
      },
    ],
    submissions: [
      {
        id: 's1',
        collection_period_id: 'prd-2026-11',
        teacher_id: 't1',
        group_id: 'g1',
        student_full_name: 'Valiyev Ali',
        normalized_student_name: 'valiyev ali',
        payment_date: '2026-11-05',
        created_at: '2026-11-01T10:00:00Z',
        updated_at: '2026-11-01T10:00:00Z',
      },
      {
        id: 's2',
        collection_period_id: 'prd-2026-11',
        teacher_id: 't1',
        group_id: 'g1',
        student_full_name: 'Abdullayev Aziz',
        normalized_student_name: 'abdullayev aziz',
        payment_date: '2026-11-03',
        created_at: '2026-11-01T09:00:00Z',
        updated_at: '2026-11-01T09:00:00Z',
      },
    ],
  });

  assert.equal(filename, 'Tolov_hisoboti_Noyabr_2026.xlsx');
  assert.deepEqual(sheetNames, ['Umumiy hisobot', 'IELTS-01']);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const mainSheet = wb.getWorksheet('Umumiy hisobot');
  assert.ok(mainSheet);
  assert.equal(mainSheet.getRow(2).getCell(2).text, 'Abdullayev Aziz');
  assert.equal(mainSheet.getRow(3).getCell(2).text, 'Valiyev Ali');

  const groupSheet = wb.getWorksheet('IELTS-01');
  assert.ok(groupSheet);
  assert.equal(groupSheet.getRow(2).getCell(2).text, 'Abdullayev Aziz');
  assert.equal(groupSheet.getRow(2).getCell(3).text, '03.11.2026');
});
