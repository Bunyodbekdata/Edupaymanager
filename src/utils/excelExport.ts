import ExcelJS from 'exceljs';
import { CollectionPeriod, Group, Submission, Teacher } from '../types/edupay';
import {
  buildExcelFilename,
  cleanStudentName,
  compareUzbekNames,
  formatDateUz,
  sanitizeExcelSheetName,
} from './edupayLogic';

export interface ExcelExportParams {
  period: CollectionPeriod;
  submissions: Submission[];
  teachers: Teacher[];
  groups: Group[];
  selectedTeacherId?: string;
  selectedGroupId?: string;
}

export async function generateSubmissionsExcelBuffer(
  params: ExcelExportParams
): Promise<{ buffer: ArrayBuffer; filename: string; sheetNames: string[] }> {
  const { period, submissions, teachers, groups, selectedTeacherId, selectedGroupId } = params;

  const teacherMap = new Map(teachers.map((t) => [t.id, t]));
  const groupMap = new Map(groups.map((g) => [g.id, g]));

  // Filter submissions for the selected period + optional teacher/group
  const filtered = submissions
    .filter((s) => {
      if (s.collection_period_id !== period.id) return false;
      if (selectedTeacherId && selectedTeacherId !== 'all' && s.teacher_id !== selectedTeacherId) {
        return false;
      }
      if (selectedGroupId && selectedGroupId !== 'all' && s.group_id !== selectedGroupId) {
        return false;
      }
      return true;
    })
    .sort((a, b) => compareUzbekNames(a.student_full_name, b.student_full_name));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'EduPay Manager';
  workbook.created = new Date();
  workbook.modified = new Date();

  const usedSheetNames = new Set<string>();
  const sheet1Name = sanitizeExcelSheetName('Umumiy hisobot', usedSheetNames);

  // ==========================================
  // Sheet 1: Umumiy hisobot
  // Columns: № | O'quvchi ismi | O'qituvchi | Guruh | To'lov sanasi
  // ==========================================
  const mainSheet = workbook.addWorksheet(sheet1Name, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  mainSheet.columns = [
    { header: '№', key: 'index', width: 8 },
    { header: "O'quvchi ismi", key: 'student_name', width: 34 },
    { header: "O'qituvchi", key: 'teacher_name', width: 28 },
    { header: 'Guruh', key: 'group_name', width: 24 },
    { header: "To'lov sanasi", key: 'payment_date', width: 18 },
    { header: 'Izoh', key: 'note', width: 32 },
  ];

  // Style Header Row (Row 1)
  const mainHeader = mainSheet.getRow(1);
  mainHeader.height = 28;
  mainHeader.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F172A' }, // Deep Navy
    };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: false };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF0F172A' } },
      left: { style: 'thin', color: { argb: 'FF334155' } },
      bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
      right: { style: 'thin', color: { argb: 'FF334155' } },
    };
  });
  mainHeader.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
  mainHeader.getCell(5).alignment = { vertical: 'middle', horizontal: 'center' };

  filtered.forEach((sub, idx) => {
    const teacherName = teacherMap.get(sub.teacher_id)?.full_name || "Noma'lum o'qituvchi";
    const groupName = groupMap.get(sub.group_id)?.group_name || "Noma'lum guruh";
    const row = mainSheet.addRow({
      index: idx + 1,
      student_name: cleanStudentName(sub.student_full_name),
      teacher_name: teacherName,
      group_name: groupName,
      payment_date: formatDateUz(sub.payment_date),
      note: sub.note || '',
    });

    row.height = 22;
    const isEven = (idx + 1) % 2 === 0;
    row.eachCell((cell, colNumber) => {
      cell.font = { name: 'Calibri', size: 11, color: { argb: 'FF0F172A' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: isEven ? 'FFF8FAFC' : 'FFFFFFFF' },
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      };
      cell.alignment = {
        vertical: 'middle',
        horizontal: colNumber === 1 || colNumber === 5 ? 'center' : 'left',
      };
    });
  });

  mainSheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, filtered.length + 1), column: 5 },
  };

  // ==========================================
  // Additional Worksheets: One per Group that has submissions (or selected group)
  // Columns: № | O'quvchi ismi va familiyasi | To'lov sanasi
  // ==========================================
  const targetGroups = groups
    .filter((g) => {
      if (selectedGroupId && selectedGroupId !== 'all') {
        return g.id === selectedGroupId;
      }
      if (selectedTeacherId && selectedTeacherId !== 'all') {
        return g.teacher_id === selectedTeacherId;
      }
      // Include groups that are active or have submissions in this period
      return (
        g.status === 'active' ||
        filtered.some((s) => s.group_id === g.id)
      );
    })
    .sort((a, b) => compareUzbekNames(a.group_name, b.group_name));

  for (const grp of targetGroups) {
    const groupSubs = filtered
      .filter((s) => s.group_id === grp.id)
      .sort((a, b) => compareUzbekNames(a.student_full_name, b.student_full_name));

    // Only create worksheet if group is explicitly selected or has submissions
    if (groupSubs.length === 0 && (!selectedGroupId || selectedGroupId === 'all')) {
      continue;
    }

    const sheetName = sanitizeExcelSheetName(grp.group_name, usedSheetNames);
    const groupSheet = workbook.addWorksheet(sheetName, {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    groupSheet.columns = [
      { header: '№', key: 'index', width: 8 },
      { header: "O'quvchi ismi va familiyasi", key: 'student_name', width: 38 },
      { header: "To'lov sanasi", key: 'payment_date', width: 20 },
      { header: 'Izoh', key: 'note', width: 32 },
    ];

    const grpHeader = groupSheet.getRow(1);
    grpHeader.height = 28;
    grpHeader.eachCell((cell, colNumber) => {
      cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0F172A' },
      };
      cell.alignment = {
        vertical: 'middle',
        horizontal: colNumber === 1 || colNumber === 3 ? 'center' : 'left',
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF0F172A' } },
        left: { style: 'thin', color: { argb: 'FF334155' } },
        bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
        right: { style: 'thin', color: { argb: 'FF334155' } },
      };
    });

    groupSubs.forEach((sub, idx) => {
      const row = groupSheet.addRow({
        index: idx + 1,
        student_name: cleanStudentName(sub.student_full_name),
        payment_date: formatDateUz(sub.payment_date),
        note: sub.note || '',
      });
      row.height = 22;
      const isEven = (idx + 1) % 2 === 0;
      row.eachCell((cell, colNumber) => {
        cell.font = { name: 'Calibri', size: 11, color: { argb: 'FF0F172A' } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: isEven ? 'FFF8FAFC' : 'FFFFFFFF' },
        };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        };
        cell.alignment = {
          vertical: 'middle',
          horizontal: colNumber === 1 || colNumber === 3 ? 'center' : 'left',
        };
      });
    });

    groupSheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(1, groupSubs.length + 1), column: 3 },
    };
  }

  const selectedGroupObj =
    selectedGroupId && selectedGroupId !== 'all' ? groupMap.get(selectedGroupId) : undefined;
  const selectedTeacherObj =
    selectedTeacherId && selectedTeacherId !== 'all'
      ? teacherMap.get(selectedTeacherId)
      : undefined;

  const filename = buildExcelFilename({
    monthName: period.month_name,
    year: period.year,
    groupName: selectedGroupObj?.group_name,
    teacherName: !selectedGroupObj ? selectedTeacherObj?.full_name : undefined,
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const sheetNames = workbook.worksheets.map((ws) => ws.name);

  return { buffer, filename, sheetNames };
}

/**
 * Parses an uploaded Excel (.xlsx) or CSV/Text buffer to extract student names for a group roster.
 */
export async function parseRosterExcelFile(arrayBuffer: ArrayBuffer): Promise<string[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(arrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const names: string[] = [];
  const headerKeywords = new Set([
    'ism',
    'familiya',
    "o'quvchi",
    'oquvchi',
    'f.i.sh',
    'fish',
    'student',
    'name',
    'full name',
    '№',
    '#',
  ]);

  sheet.eachRow((row, rowNumber) => {
    // Check cells in columns 1..4 to find the student name column
    for (let col = 1; col <= 4; col++) {
      const val = row.getCell(col).text?.trim();
      if (!val) continue;
      if (/^\d+$/.test(val)) continue; // Skip pure row index numbers
      const lower = cleanStudentName(val).toLowerCase();
      if (rowNumber === 1 && Array.from(headerKeywords).some((k) => lower.includes(k))) {
        continue;
      }
      const cleaned = cleanStudentName(val);
      if (cleaned.length >= 4 && cleaned.includes(' ')) {
        names.push(cleaned);
        break;
      }
    }
  });

  return Array.from(new Set(names)).sort(compareUzbekNames);
}
