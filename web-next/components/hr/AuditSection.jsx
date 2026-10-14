'use client';

// web-next/components/hr/AuditSection.jsx — Single Employee Audit (full parity).

import { useEffect, useState } from 'react';
import useApiData from '../useApiData';
import AsyncBox from '../employee/AsyncBox';
import apiFetch from '../../lib/api';
import { prettyDate, dayName, fmtPunch, currentMonthKey, shiftMonth } from '../../lib/format';
import { initials, ageFrom, yearsCompleted, daysUntilMonthDay, statusBadgeClass, hoursText } from '../../lib/hr';
import AttendanceCalendar, { dateOf, dayStatus } from './AttendanceCalendar';

// ---------------------------------------------------------------------------
// Full ACTIVE employee directory for the Single Audit dropdown.
// Port of the original React website's `ensureAllEmployeesLoaded()`
// (index.html): GET /employees?page=N&pageSize=100&active=Y — the backend
// clamps pageSize to 100, so all pages are walked with the SAME break
// conditions as the original, plus paycode de-duplication and a hard page
// safety cap (no infinite pagination loops). The loaded list is cached at
// module level (like the original's `allEmployees` global) so re-entering the
// tab never refetches the directory.
// ---------------------------------------------------------------------------
const EMP_PAGE_SIZE = 100;
const EMP_MAX_PAGES = 50;
let activeEmployeesCache = null;
let activeEmployeesInflight = null;

function fetchAllActiveEmployees() {
  if (activeEmployeesCache) return Promise.resolve(activeEmployeesCache);
  if (activeEmployeesInflight) return activeEmployeesInflight;
  activeEmployeesInflight = (async () => {
    const rows = [];
    const seen = new Set();
    let page = 1;
    let total = Number.POSITIVE_INFINITY;
    while (rows.length < total && page <= EMP_MAX_PAGES) {
      const data = await apiFetch(`/employees?page=${page}&pageSize=${EMP_PAGE_SIZE}&active=Y`);
      const batch = Array.isArray(data?.rows) ? data.rows : [];
      total = Number(data?.total || 0);
      if (!batch.length) break;
      for (const r of batch) {
        const key = String(r?.paycode || '').trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        rows.push(r);
      }
      if (batch.length < EMP_PAGE_SIZE || rows.length >= total) break;
      page += 1;
    }
    activeEmployeesCache = rows;
    return rows;
  })().finally(() => {
    activeEmployeesInflight = null;
  });
  return activeEmployeesInflight;
}

function InfoCard({ label, children, extra, extraClass = '' }) {
  return (
    <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
      <p className="text-[10px] uppercase font-bold text-[var(--muted)]">{label}</p>
      <p className="text-sm font-bold audit-val mt-1">{children || '—'}</p>
      {extra ? <p className={`text-[10px] mt-0.5 ${extraClass || 'text-[var(--muted)]'}`}>{extra}</p> : null}
    </div>
  );
}

// Punch-time cell for this tab (scoped colours): real times in bright
// emerald/coral, missing values keep the existing dash — never a fake time.
function PunchValue({ value, side }) {
  const text = fmtPunch(value);
  const missing = !value || text === '—';
  return (
    <span className={missing ? 'audit-dash' : side === 'out' ? 'audit-out' : 'audit-in'}>
      {missing ? (text || '--') : text}
    </span>
  );
}

export default function AuditSection() {
  const cele = useApiData('/hr/celebrations');
  const [selected, setSelected] = useState('');
  const [empList, setEmpList] = useState(activeEmployeesCache || []);
  const [listLoading, setListLoading] = useState(!activeEmployeesCache);
  const [listError, setListError] = useState(null);
  const [listRetry, setListRetry] = useState(0);
  const [calMonth, setCalMonth] = useState(currentMonthKey());
  const [selectedDate, setSelectedDate] = useState(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('paycode');
    if (p) setSelected(p);
  }, []);

  // Load the FULL active-employee list (all pages) once per session.
  useEffect(() => {
    let alive = true;
    if (activeEmployeesCache) {
      setEmpList(activeEmployeesCache);
      setListLoading(false);
      setListError(null);
      return () => { alive = false; };
    }
    setListLoading(true);
    setListError(null);
    fetchAllActiveEmployees()
      .then((rows) => {
        if (!alive) return;
        setEmpList(rows);
        setListLoading(false);
        // Original default-selection behaviour: the first employee of the
        // loaded active list is selected and its audit loads automatically.
        setSelected((cur) => cur || String(rows[0]?.paycode || ''));
      })
      .catch((err) => {
        if (!alive) return;
        setListError(err?.message || 'Active employees load nahi ho paye.');
        setListLoading(false);
      });
    return () => { alive = false; };
  }, [listRetry]);

  const profile = useApiData(selected ? `/employees/${encodeURIComponent(selected)}` : null);
  // SOURCE OF TRUTH: ONE /hr/audit request keyed by (selected employee, selected
  // calendar month). Summary cards, calendar, Late Arrival Details and date
  // details all derive from this single response, so they can never disagree
  // about the month (root-cause fix for the stale cards).
  const audit = useApiData(selected ? `/hr/audit/${encodeURIComponent(selected)}?month=${calMonth}` : null);

  // Clear any previously selected date when the employee changes.
  useEffect(() => {
    setSelectedDate(null);
  }, [selected]);

  const e = profile.data || {};
  // The response carries its own employee identity — never trust data belonging
  // to a previously selected employee, even if it lands late.
  const auditData = audit.data && String(audit.data.employee?.paycode || '').trim() === String(selected || '').trim() ? audit.data : null;
  const fresh = Boolean(auditData) && !audit.loading;
  // "No usable data yet" (initial load / employee switch) — month navigation
  // keeps the layout because the previous month's same-employee data still
  // exists; only the summary region shows a loading indicator then.
  const auditBusy = Boolean(selected) && !auditData && !audit.error;

  const attendance = [...(auditData?.attendance || [])].sort((a, b) => (String(a.date || '') < String(b.date || '') ? -1 : String(a.date || '') > String(b.date || '') ? 1 : 0));
  const lateDetails = fresh ? (auditData?.lateDetails || []) : [];
  const grace = fresh ? (auditData?.graceRemaining || {}) : {};
  /* PHASE 6.2A — Grace eligibility (STAFF?) aur configured limits SHARED backend
     se aate hain (computeMonthlyLateForEmployee ka graceEligibility) — yahan
     category rules dobara implement nahi karte (single source of truth).
     Field na ho (legacy response) to null = unknown → fallback behaviour. */
  const graceElig = fresh && auditData?.graceEligibility && typeof auditData.graceEligibility === 'object' ? auditData.graceEligibility : null;
  const graceLimits = (graceElig && graceElig.limits) || { grace30min: 2, grace1hr: 1, grace2hr: 1 };
  // Hinglish: Grace "used" = configured limit - jo bacha hai (graceRemaining).
  const graceUsedOf = (key) => Math.max(0, Number(graceLimits[key] || 0) - Number(grace[key] ?? 0));
  const staffGraceEligible = graceElig ? graceElig.isStaff === true : null; // null = unknown (legacy)
  /* Hinglish: Section visibility — eligible STAFF ke liye hamesha dikhta hai
     (0 usage par bhi "0/2 used" dikhna chahiye). Non-STAFF par sirf real late rows
     ke liye, aur unpar staff-grace block kabhi nahi (unhe grace milti hi nahi).
     Legacy response (eligibility unknown) me purana condition chalta hai. */
  const hasLateRows = lateDetails.length > 0;
  const graceSectionVisible = fresh && (staffGraceEligible === true
    ? true
    : staffGraceEligible === false
      ? hasLateRows
      : (hasLateRows || Number(grace.grace30min) < 2 || Number(grace.grace1hr) < 1 || Number(grace.grace2hr) < 1));
  // PHASE 6.2A — employee header ka current shift (shared audit response ka `shift`
  // object; resolveEmployeeShift se aata hai — code + real start/end timings).
  const shiftInfo = fresh && auditData?.shift && typeof auditData.shift === 'object' ? auditData.shift : null;
  const calRows = fresh ? attendance : [];
  const calHolidays = fresh ? (auditData?.holidays || []) : [];

  // Monthly summary recalculated from THAT month's real rows (same per-row
  // classifier output the calendar displays):
  //   - Weekly Off and an applicable active Holiday without a punch are never
  //     counted Absent (a holiday is not "absent" merely because no punch exists)
  //   - each attendance date is counted exactly once
  //   - Half Day / Short Leave / Present (Week Off) / ongoing current day keep
  //     the established classifier handling (computedStatus)
  //   - Late Marks = eligible late occurrences remaining AFTER staff grace
  //     (30-min x2 -> 1-hr -> 2-hr, chronological, smallest-covering-first per
  //     computeMonthlyLateForEmployee): exactly the isFinalLate entries of
  //     lateDetails — identical to stats.late and always consistent with the
  //     Late Arrival Details section below.
  const summary = (() => {
    const holidaySet = new Set(calHolidays.filter((h) => h && h.active !== false).map((h) => String(h.holidaydate || '').slice(0, 10)));
    const byDate = new Map();
    for (const r of calRows) {
      const k = dateOf(r);
      if (k && !byDate.has(k)) byDate.set(k, r);
    }
    let present = 0;
    let absent = 0;
    let miss = 0;
    for (const [k, r] of byDate) {
      const label = String(r?.computedStatus || r?.statusLabel || '');
      if (label === 'Week Off') continue;
      const punched = Boolean(r?.inTime || r?.outTime || r?.in1 || r?.in2 || r?.out1 || r?.out2);
      if (holidaySet.has(k) && !punched) continue;
      if (label === 'Absent') absent += 1;
      else if (label === 'Miss Punch') miss += 1;
      else present += 1;
    }
    const late = lateDetails.length
      ? lateDetails.filter((d) => d && d.isFinalLate).length
      : Number(auditData?.stats?.late || 0);
    return { present, absent, miss, late };
  })();
  const { present, absent, miss, late } = summary;
  const tot = present + absent + miss;
  const pct = tot ? Math.round((present / tot) * 100) : 0;
  const pctClass = pct >= 90 ? 'text-emerald-400' : pct >= 75 ? 'text-amber-400' : 'text-rose-400';
  const mar = (cele.data?.marriages || []).find((m) => m.paycode === selected);

  // Phase 1 — resolve master codes through the EXISTING API mappings only:
  // departmentname (tbldepartment join) and companyname (tblcompany join on the
  // already-loaded active-employee list). If no mapping exists, the real code is
  // retained with its label — never an invented value.
  const empRow = empList.find((r) => String(r.paycode || '').trim() === String(selected || '').trim()) || {};
  const auditEmp = auditData?.employee || {};
  const deptLabel = e.departmentname || empRow.departmentname || auditEmp.departmentname || e.departmentcode || '—';
  const companyLabel = empRow.companyname || auditEmp.companyname || e.companycode || '—';

  const detailRow = selectedDate ? calRows.find((r) => dateOf(r) === selectedDate) : null;
  const detailHoliday = selectedDate ? calHolidays.find((h) => String(h?.holidaydate || '').slice(0, 10) === selectedDate) : null;
  const detailStatus = selectedDate ? dayStatus(detailRow, detailHoliday) : null;
  return (
    <div className="glass-card rounded-3xl p-6 audit-tab">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6 pb-4 border-b border-[var(--border)]">
        <div>
          <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2"><i className="fas fa-user-check text-purple-400"></i> Single Employee Audit</h3>
          <p className="text-xs text-[var(--muted)]">Individual master data, punching records &amp; trends</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-[var(--text)]">Employee:</label>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={listLoading}
            className="audit-select rounded-xl text-xs outline-none max-w-[260px] disabled:opacity-60"
          >
            {listLoading ? (
              <option value="">Loading active employees…</option>
            ) : listError ? (
              <option value="">Employee list unavailable</option>
            ) : (
              <>
                <option value="">Select Employee...</option>
                {empList.map((r) => <option key={r.paycode} value={r.paycode}>{r.empname} ({r.paycode})</option>)}
              </>
            )}
          </select>
          {listLoading ? (
            <span className="text-[11px] text-[var(--muted)] flex items-center gap-1.5"><i className="fas fa-spinner fa-spin"></i>Loading active employees…</span>
          ) : null}
          {listError ? (
            <span className="flex items-center gap-2 text-[11px] text-rose-300">
              <i className="fas fa-triangle-exclamation"></i>
              <span>{listError}</span>
              <button type="button" onClick={() => setListRetry((t) => t + 1)} className="px-2 py-1 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 font-bold text-[10px] transition">Retry</button>
            </span>
          ) : null}
          {!listLoading && !listError && empList.length ? (
            <span className="text-[10px] font-semibold text-[var(--muted)]">{empList.length} active</span>
          ) : null}
        </div>
      </div>

      {listLoading ? (
        <div className="p-5 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-sm text-[var(--text)]">
          <i className="fas fa-spinner fa-spin mr-2"></i>Loading active employees…
        </div>
      ) : listError ? (
        <div className="p-5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-sm text-rose-300">
          {listError} <button type="button" onClick={() => setListRetry((t) => t + 1)} className="underline ml-2">Retry</button>
        </div>
      ) : !empList.length ? (
        <p className="text-xs text-[var(--muted)] py-6 text-center">Koi active employee nahi mila — employee list khali hai.</p>
      ) : !selected ? (
        <p className="text-xs text-[var(--muted)] py-6 text-center">Employee select karke audit dekhein.</p>
      ) : (
        <AsyncBox loading={profile.loading || auditBusy} error={profile.error || audit.error} onRetry={() => { profile.reload(); audit.reload(); }} label="Audit load ho raha hai...">
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row items-center gap-5 p-5 rounded-2xl bg-white/5 border border-white/5">
              <div className="w-20 h-20 rounded-2xl card-gradient-1 flex items-center justify-center text-2xl font-extrabold text-white shadow-xl overflow-hidden shrink-0">{initials(e.empname)}</div>
              <div className="flex-1 text-center md:text-left">
                <h3 className="text-xl audit-name">{e.empname || '—'}</h3>
                <p className="text-sm audit-accent">{e.designation || '—'} • {deptLabel}</p>
                <p className="text-xs audit-meta mt-1 mono">Paycode: {e.paycode || '—'} | Card No: {e.presentcardno || '—'} | Company: {companyLabel}</p>
                {/* PHASE 6.2A — header me employee ki current Savior shift (code + real
                    timings). Data shared /hr/audit response ke `shift` object se aata hai
                    (resolveEmployeeShift: tblemployeeshiftmaster + tblshiftmaster).
                    Unresolved ho to honest reason dikhate hain — koi guessed/default
                    shift kabhi nahi. */}
                <p className="text-xs audit-meta mt-1 mono">
                  Shift: {shiftInfo?.resolved
                    ? `${shiftInfo.shiftCode || shiftInfo.shiftName || '—'} | ${shiftInfo.startTime || '—'} – ${shiftInfo.endTime || '—'}`
                    : shiftInfo
                      ? `Not available (${shiftInfo.reason || 'UNRESOLVED'})`
                      : '—'}
                </p>
              </div>
              <div className="text-center">
                {fresh ? (
                  <p className={`text-3xl font-extrabold audit-pct ${pctClass}`}>{pct}%</p>
                ) : (
                  <p className="text-3xl font-extrabold audit-pct text-[var(--muted)]"><i className="fas fa-spinner fa-spin"></i></p>
                )}
                <p className="text-[10px] audit-kpi-label uppercase">Attendance</p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-center"><p className="text-2xl font-extrabold text-emerald-400">{fresh ? present : <i className="fas fa-spinner fa-spin text-[var(--muted)]"></i>}</p><p className="text-[10px] audit-kpi-label uppercase mt-1">Present</p></div>
              <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-center"><p className="text-2xl font-extrabold text-rose-400">{fresh ? absent : <i className="fas fa-spinner fa-spin text-[var(--muted)]"></i>}</p><p className="text-[10px] audit-kpi-label uppercase mt-1">Absent</p></div>
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-center"><p className="text-2xl font-extrabold text-amber-400">{fresh ? miss : <i className="fas fa-spinner fa-spin text-[var(--muted)]"></i>}</p><p className="text-[10px] audit-kpi-label uppercase mt-1">Miss Punch</p></div>
              <div className="p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-center"><p className="text-2xl font-extrabold text-indigo-400">{fresh ? late : <i className="fas fa-spinner fa-spin text-[var(--muted)]"></i>}</p><p className="text-[10px] audit-kpi-label uppercase mt-1">Late Marks</p></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <InfoCard label="Date of Birth" extraClass="audit-help--pink" extra={`Age ${ageFrom(e.dateofbirth) ?? '—'} • next in ${daysUntilMonthDay(e.dateofbirth) ?? '—'} days`}>{prettyDate(e.dateofbirth)}</InfoCard>
              <InfoCard label="Date of Joining" extraClass="audit-help--amber" extra={`${yearsCompleted(e.dateofjoin) ?? '—'} yrs service`}>{prettyDate(e.dateofjoin)}</InfoCard>
              <InfoCard label="Marital Status" extraClass="audit-help--cyan" extra="ismarried (status only)">{e.ismarried === 'Y' || e.ismarried === true ? 'Married' : 'Unmarried'}</InfoCard>
              <InfoCard label="Marriage Anniversary" extraClass="audit-help--violet" extra={mar ? `${yearsCompleted(mar.anniversarydate)} yrs (HR import)` : 'HR Excel import required'}>{mar ? prettyDate(mar.anniversarydate) : 'Not on record'}</InfoCard>
              <InfoCard label="Qualification">{e.qualification}</InfoCard>
              <InfoCard label="Experience">{e.experience}</InfoCard>
              <InfoCard label="Contact"><span className="mono">{e.telephone1}</span></InfoCard>
              <InfoCard label="E-Mail">{e.e_mail1}</InfoCard>
            </div>

            {/* PHASE 6.2A — Late Arrival Details + Monthly Staff Grace Used.
                Hinglish: Eligible STAFF ke liye ye section hamesha dikhta hai (chahe is
                month koi late na ho) taaki Monthly Staff Grace Used ka actual used/limit
                dikhe. Non-STAFF par sirf real late rows ke liye dikhta hai aur unpar
                staff-grace block kabhi nahi (unhe grace milti hi nahi). Visibility
                eligibility server ke SHARED grace logic se aati hai (graceSectionVisible). */}
            {graceSectionVisible ? (
              <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)] mb-3 flex items-center gap-2"><i className="fas fa-clock text-amber-400"></i>Late Arrival Details (Monthly Grace Consumption)</h4>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px] font-bold text-amber-300 mb-2">Late Occurrences</p>
                    <div className="max-h-64 overflow-y-auto space-y-1">
                      {lateDetails.length ? lateDetails.map((d, i) => (
                        <div key={i} className={`flex items-center justify-between gap-2 text-[10px] p-1.5 rounded border ${d.isFinalLate ? 'bg-rose-500/10 border-rose-500/20' : 'bg-emerald-500/10 border-emerald-500/20'}`}>
                          <span className="text-[var(--text)]">{prettyDate(d.date)}</span>
                          <span className="mono"><PunchValue value={d.inTime} side="in" /></span>
                          <span className={`${d.isFinalLate ? 'text-rose-300' : 'text-emerald-300'} font-semibold`}>{d.isFinalLate ? (d.graceUsed == null ? 'No grace — FINAL LATE' : 'FINAL LATE') : (d.graceUsed === '30min' ? 'Covered by 30-min grace' : d.graceUsed === '1hr' ? 'Covered by 1-hr grace' : d.graceUsed === '2hr' ? 'Covered by 2-hr grace' : 'Grace applied')}</span>
                          {d.lateMinutes ? <span className="text-rose-300 mono">+{d.lateMinutes}m late</span> : null}
                        </div>
                      )) : <div className="text-[10px] text-[var(--muted)] p-2">No late occurrences this month</div>}
                    </div>
                  </div>
                  {/* PHASE 6.2A — Monthly Staff Grace Used: sirf grace-eligible (STAFF)
                      employees ke liye. Hinglish: used = configured limit - bacha hua
                      (graceRemaining); limits server ke shared grace logic se aate hain.
                      Non-STAFF par ye block kabhi nahi dikhta. */}
                  {staffGraceEligible !== false ? (
                    <div>
                      <p className="text-[10px] font-bold text-amber-300 mb-2">Monthly Staff Grace Used</p>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between p-2 rounded bg-white/5"><span className="text-[var(--text)] text-[10px]">30-min grace ({graceLimits.grace30min} per month)</span><span className="text-[var(--text)] font-bold mono">{graceUsedOf('grace30min')}/{graceLimits.grace30min}</span></div>
                        <div className="flex items-center justify-between p-2 rounded bg-white/5"><span className="text-[var(--text)] text-[10px]">1-hr grace ({graceLimits.grace1hr} per month)</span><span className="text-[var(--text)] font-bold mono">{graceUsedOf('grace1hr')}/{graceLimits.grace1hr}</span></div>
                        <div className="flex items-center justify-between p-2 rounded bg-white/5"><span className="text-[var(--text)] text-[10px]">2-hr grace ({graceLimits.grace2hr} per month)</span><span className="text-[var(--text)] font-bold mono">{graceUsedOf('grace2hr')}/{graceLimits.grace2hr}</span></div>
                      </div>
                      <p className="text-[9px] text-[var(--muted)] mt-2">Used/Total. Universal 5-min grace applies to all categories. Staff grace consumed chronologically (smallest first).</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-[10px] font-bold text-amber-300 mb-2">Monthly Staff Grace Used</p>
                      <p className="text-[10px] text-[var(--muted)] p-2">Not applicable — ye employee STAFF category ka nahi hai, isliye monthly staff grace rules apply nahi hote. Sab late occurrences FINAL LATE count hote hain.</p>
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
              <AttendanceCalendar
                monthKey={calMonth}
                onPrev={() => { setCalMonth((m) => shiftMonth(m, -1)); setSelectedDate(null); }}
                onNext={() => { setCalMonth((m) => shiftMonth(m, 1)); setSelectedDate(null); }}
                onToday={() => { setCalMonth(currentMonthKey()); setSelectedDate(null); }}
                rows={calRows}
                holidays={calHolidays}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
                loading={!fresh}
                error={audit.error}
                onRetry={() => { audit.reload(); }}
              />
            </div>

            <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)] mb-3">Attendance Details</h4>
              {!selectedDate ? (
                <p className="text-xs text-[var(--muted)]">Calendar par koi date click karein — us din ke real IN/OUT details yahan dikhenge.</p>
              ) : detailRow || detailHoliday ? (
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
                  <span className="text-[var(--text)] font-bold">{prettyDate(selectedDate)} • {dayName(selectedDate)}</span>
                  <span className="flex items-center gap-1.5"><span className="text-[var(--muted)] font-semibold">IN</span><PunchValue value={detailRow?.inTime} side="in" /></span>
                  <span className="flex items-center gap-1.5"><span className="text-[var(--muted)] font-semibold">OUT</span><PunchValue value={detailRow?.outTime} side="out" /></span>
                  <span className="flex items-center gap-1.5"><span className="text-[var(--muted)] font-semibold">Hrs</span><span className="mono text-[var(--text)]">{detailRow ? hoursText(detailRow.hoursworked) : '—'}</span></span>
                  <span className={`badge ${statusBadgeClass(detailStatus.label)}`}>{detailStatus.label}</span>
                  {detailRow && (detailRow.isLate || Number(detailRow.latearrival) > 0) ? <span className="text-rose-300 font-semibold">+{Number(detailRow.latearrival || 0)}m late</span> : null}
                  {detailHoliday ? <span className="text-[var(--text)]"><i className="fas fa-umbrella-beach text-purple-400 mr-1.5"></i>{detailHoliday.holidayname}</span> : null}
                </div>
              ) : (
                <p className="text-xs text-[var(--muted)]">Is date ka koi attendance record nahi hai.</p>
              )}
            </div>
          </div>
        </AsyncBox>
      )}
    </div>
  );
}


