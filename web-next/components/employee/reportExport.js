// web-next/components/employee/reportExport.js
// PDF + Excel generators for the Employee Reports tab (client-side, offline).
// PDF: jspdf + jspdf-autotable (tables/pagination); Excel: existing xlsx dep.
// Both consume ONLY the data already authorised for the logged-in employee by
// the common backend (JWT identity) — no extra data source, no invented records.

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { fmtDate, dayNameOf, monthLabel, hoursText, hoursDecimal, DASH, STATUS_META, clean, partsOf } from './reportData';

const INK = [15, 23, 42];        // slate-900
const MUTED = [100, 116, 139];   // slate-500
const ACCENT = [79, 70, 229];    // indigo-600
const LINE = [226, 232, 240];    // slate-200

/**
 * Personal Monthly Attendance Report (A4, multi-page, print-ready).
 * chartImages: optional { dist, week, punct } PNG dataURLs captured from the
 * on-screen Chart.js canvases — skipped cleanly when unavailable.
 */
export function buildPdf({ profile, month, summary, register, insights, punct, chartImages, notes }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const M = 14;
  const W = 210 - M * 2;
  const title = 'Personal Monthly Attendance Report';
  const monthText = monthLabel(month);
  const generated = fmtDate(new Date().toISOString().slice(0, 10));

  // ---------- header ----------
  doc.setFillColor(...ACCENT);
  doc.rect(0, 0, 210, 26, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(title, M, 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Month: ${monthText}`, M, 19);
  doc.text(`Generated: ${generated}`, 210 - M, 19, { align: 'right' });

  let y = 34;
  // ---------- employee block ----------
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Employee Details', M, y);
  y += 2;
  autoTable(doc, {
    startY: y,
    theme: 'grid',
    head: [],
    body: [[
      `Name: ${clean(profile?.empname) || DASH}`,
      `Paycode / Employee ID: ${clean(profile?.paycode) || DASH}`,
      `Designation: ${clean(profile?.designation) || DASH}`,
      `Department: ${clean(profile?.departmentname || profile?.departmentcode) || DASH}`,
    ]],
    styles: { fontSize: 9, cellPadding: 2, textColor: INK, lineColor: LINE, lineWidth: 0.2 },
    columnStyles: { 0: { cellWidth: 52 }, 1: { cellWidth: 50 }, 2: { cellWidth: 42 }, 3: { cellWidth: 'auto' } },
  });
  y = doc.lastAutoTable.finalY + 6;

  // ---------- summary metrics ----------
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Monthly Summary', M, y);
  y += 2;
  const pct = summary.attendancePct === null ? 'Not available' : `${summary.attendancePct}%`;
  autoTable(doc, {
    startY: y,
    theme: 'grid',
    head: [['Present Days', 'Absent Days', 'Miss Punch', 'Late Arrivals', 'Attendance %', 'Recorded Hours']],
    body: [[
      String(summary.present), String(summary.absent), String(summary.miss),
      String(summary.lateFinal), pct,
      summary.recordedDays > 0 ? hoursText(summary.hoursMin) : 'Not available',
    ]],
    headStyles: { fillColor: ACCENT, textColor: [255, 255, 255], fontSize: 8.5 },
    styles: { fontSize: 9.5, cellPadding: 2.2, textColor: INK, lineColor: LINE, lineWidth: 0.2, halign: 'center' },
  });
  y = doc.lastAutoTable.finalY + 6;

  // ---------- charts ----------
  const imgs = chartImages || {};
  const chartRow = (heading, list) => {
    const usable = list.filter((c) => c.img);
    if (!usable.length) return;
    if (y > 297 - 80) { doc.addPage(); y = 20; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(heading, M, y);
    y += 3;
    const w = usable.length > 1 ? W / usable.length : W;
    usable.forEach((c, i) => {
      try {
        doc.addImage(c.img, 'PNG', M + i * w, y, w - 4, 52);
      } catch { /* image unavailable - skip silently */ }
    });
    y += 58;
  };
  chartRow('Attendance Distribution', [{ img: imgs.dist }]);
  chartRow('Week-wise Attendance Trend & Punctuality', [{ img: imgs.week }, { img: imgs.punct }]);

  // ---------- insights ----------
  if ((insights || []).length) {
    if (y > 297 - 60) { doc.addPage(); y = 20; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('My Month at a Glance', M, y);
    y += 2;
    autoTable(doc, {
      startY: y,
      theme: 'grid',
      head: [['Insight', 'Value', 'Basis']],
      body: insights.map((it) => [it.title, it.value, it.note]),
      headStyles: { fillColor: ACCENT, textColor: [255, 255, 255], fontSize: 8.5 },
      styles: { fontSize: 9, cellPadding: 2, textColor: INK, lineColor: LINE, lineWidth: 0.2 },
      columnStyles: { 0: { cellWidth: 48 }, 1: { cellWidth: 52 }, 2: { cellWidth: 'auto' } },
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  // ---------- daily register ----------
  if (y > 297 - 50) { doc.addPage(); y = 20; }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`Daily Attendance Register — ${monthText}`, M, y);
  y += 2;
  autoTable(doc, {
    startY: y,
    theme: 'grid',
    head: [['Date', 'Day', 'In', 'Out', 'Hours', 'Status', 'Late', 'Remark / Reason']],
    body: (register || []).map((r) => [
      fmtDate(r.date), r.dayName, r.inTime || DASH, r.outTime || DASH,
      r.hasRow ? r.hoursText : DASH, r.status,
      r.lateText ? (r.graceUsed ? `${r.lateText} (${r.graceUsed} covered)` : r.lateText) : DASH,
      clean(r.remark) || DASH,
    ]),
    headStyles: { fillColor: ACCENT, textColor: [255, 255, 255], fontSize: 8 },
    styles: { fontSize: 7.6, cellPadding: 1.6, textColor: INK, lineColor: LINE, lineWidth: 0.2 },
    columnStyles: {
      0: { cellWidth: 22 }, 1: { cellWidth: 12 }, 2: { cellWidth: 18 }, 3: { cellWidth: 18 },
      4: { cellWidth: 16 }, 5: { cellWidth: 24 }, 6: { cellWidth: 24 }, 7: { cellWidth: 'auto' },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 5) {
        const key = (register[data.row.index] || {}).kind;
        const color = (STATUS_META[key] || STATUS_META.noRecord).color;
        data.cell.styles.textColor = color;
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });
  y = doc.lastAutoTable.finalY + 6;

  // ---------- legend + calculation notes ----------
  if (y > 297 - 46) { doc.addPage(); y = 20; }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Status Legend & Calculation Notes', M, y);
  y += 4;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.2);
  doc.setTextColor(...MUTED);
  const lines = [
    `Legend: ${Object.values(STATUS_META).map((m) => m.label).join(' · ')}`,
    ...(notes || []),
  ];
  lines.forEach((line) => {
    const wrapped = doc.splitTextToSize(line, W);
    if (y + wrapped.length * 4 > 297 - 16) { doc.addPage(); y = 20; }
    doc.text(wrapped, M, y);
    y += wrapped.length * 4 + 1.2;
  });

  // ---------- footers: page numbers (final pass) ----------
  const pages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.setDrawColor(...LINE);
    doc.line(M, 285, 210 - M, 285);
    doc.text(`${title} · ${monthText} · ${clean(profile?.empname) || clean(profile?.paycode) || ''}`, M, 290);
    doc.text(`Page ${p} of ${pages}`, 210 - M, 290, { align: 'right' });
  }
  return doc;
}

export function downloadPdf(doc, fileName) {
  doc.save(fileName);
}

/**
 * Excel workbook — Sheet 1 "Monthly Summary", Sheet 2 "Daily Attendance".
 * Real selected-month data only; date cells are real dates (dd-mmm-yyyy), hours
 * are numeric decimal hours (0.00), late minutes numeric. No formulas, no
 * invented records. Consistent with the dashboard and the PDF.
 */
export function buildExcel({ profile, month, summary, register, notes }) {
  const wb = XLSX.utils.book_new();
  const monthText = monthLabel(month);
  const generated = fmtDate(new Date().toISOString().slice(0, 10));
  const pct = summary.attendancePct === null ? 'Not available' : summary.attendancePct / 100;

  // ----- Sheet 1: Monthly Summary -----
  const s1 = [
    ['Personal Monthly Attendance Report'],
    ['Month', monthText],
    ['Report Generated', generated],
    [],
    ['Employee Details'],
    ['Employee Name', clean(profile?.empname) || DASH],
    ['Paycode / Employee ID', clean(profile?.paycode) || DASH],
    ['Designation', clean(profile?.designation) || DASH],
    ['Department', clean(profile?.departmentname || profile?.departmentcode) || DASH],
    [],
    ['Monthly Summary'],
    ['Present Days', summary.present],
    ['Absent Days', summary.absent],
    ['Miss Punch', summary.miss],
    ['Approved Leave Days', summary.leave],
    ['Holiday Days', summary.holiday],
    ['Weekly Off Days', summary.weekoff],
    ['Late Arrivals (final, after grace)', summary.lateFinal],
    ['Attendance Percentage', summary.attendancePct === null ? 'Not available' : pct],
    ['Total Recorded Working Hours', summary.recordedDays > 0 ? hoursDecimal(summary.hoursMin) : 'Not available'],
    ['Recorded Days with Data', summary.recordedDays],
    [],
    ['Calculation Notes'],
    ...(notes || []).map((n) => [n]),
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(s1);
  ws1['!cols'] = [{ wch: 34 }, { wch: 28 }];
  // Attendance % as a real percentage value when available.
  const pctCell = ws1[XLSX.utils.encode_cell({ r: 18, c: 1 })];
  if (pctCell && typeof pctCell.v === 'number') pctCell.z = '0.0%';
  const hoursCell = ws1[XLSX.utils.encode_cell({ r: 19, c: 1 })];
  if (hoursCell && typeof hoursCell.v === 'number') hoursCell.z = '0.00';
  XLSX.utils.book_append_sheet(wb, ws1, 'Monthly Summary');

  // ----- Sheet 2: Daily Attendance -----
  const headers = ['Date', 'Day', 'In Time', 'Out Time', 'Working Hours', 'Status', 'Late (min)', 'Late Duration', 'Remark / Reason'];
  const rows = (register || []).map((r) => {
    const d = partsOf(r.date);
    return [
      d, r.dayName, r.inTime || DASH, r.outTime || DASH,
      r.hasRow ? hoursDecimal(r.hoursMin) : null,
      r.status,
      r.hasRow && r.lateMin > 0 ? r.lateMin : null,
      r.lateText ? (r.graceUsed ? `${r.lateText} (covered by ${r.graceUsed})` : r.lateText) : DASH,
      clean(r.remark) || DASH,
    ];
  });
  const ws2 = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws2['!cols'] = [{ wch: 13 }, { wch: 6 }, { wch: 11 }, { wch: 11 }, { wch: 13 }, { wch: 16 }, { wch: 10 }, { wch: 24 }, { wch: 44 }];
  ws2['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: headers.length - 1 } }) };
  rows.forEach((_, i) => {
    const dateCell = ws2[XLSX.utils.encode_cell({ r: i + 1, c: 0 })];
    if (dateCell) dateCell.z = 'dd-mmm-yyyy';
    const hoursCell2 = ws2[XLSX.utils.encode_cell({ r: i + 1, c: 4 })];
    if (hoursCell2 && typeof hoursCell2.v === 'number') hoursCell2.z = '0.00';
    const lateCell = ws2[XLSX.utils.encode_cell({ r: i + 1, c: 6 })];
    if (lateCell && typeof lateCell.v === 'number') lateCell.z = '0';
  });
  XLSX.utils.book_append_sheet(wb, ws2, 'Daily Attendance');

  return wb;
}

export function downloadExcel(wb, fileName) {
  XLSX.writeFile(wb, fileName);
}