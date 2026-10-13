'use client';

// web-next/components/hr/CelebrationsSection.jsx — Birthdays & Anniversaries (full parity with index.html hrCelebrations).
// Sources of truth: /hr/celebrations (COMPLETE active employee master — dateofbirth/dateofjoin)
// and /marriage-anniversary (HR application import table). Day+month matching, no hard-coded dates.

import Link from 'next/link';
import useApiData from '../useApiData';
import AsyncBox from '../employee/AsyncBox';
import { prettyDate } from '../../lib/format';
import { initials, ageFrom, yearsCompleted, daysUntilMonthDay, isTodayMMDD } from '../../lib/hr';

// Next occurrence (year-independent) of a MM-DD taken from an ISO date.
// NOTE: 29 Feb common years me Date overflow se 1 Mar ban jata hai — yahi
// original React website ka established behaviour hai (nextDateOf ke jaisa).
function nextOccurrenceISO(iso) {
  const s = String(iso || '').slice(5, 10);
  if (s.length !== 5) return '';
  const [m, d] = s.split('-').map(Number);
  if (!m || !d) return '';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), m - 1, d);
  if (next < today) next = new Date(now.getFullYear() + 1, m - 1, d);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
}

function PersonRow({ e, extra }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/5 border border-white/5">
      <div className="w-10 h-10 rounded-xl card-gradient-1 flex items-center justify-center text-[11px] font-extrabold text-white shrink-0 overflow-hidden">{initials(e.empname)}</div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-[var(--text)] truncate">{e.empname} <span className="text-[var(--muted)] mono font-semibold">({e.paycode})</span></p>
        <p className="text-[10px] text-[var(--muted)] truncate">{(e.designation || '—')} • {(e.departmentcode || '—')}</p>
        {extra}
      </div>
    </div>
  );
}

function StatCard({ label, value, colorClass, borderClass }) {
  return (
    <div className={`glass-card rounded-2xl p-5 border-l-4 ${borderClass}`}>
      <p className="text-xs font-bold text-[var(--muted)] uppercase">{label}</p>
      <p className={`text-3xl font-extrabold mt-2 ${colorClass}`}>{value}</p>
    </div>
  );
}

function Empty({ msg }) {
  return <div className="p-4 rounded-2xl bg-white/5 border border-white/5 text-center"><p className="text-[11px] text-[var(--muted)]">{msg}</p></div>;
}

export default function CelebrationsSection() {
  // Employee master: /hr/celebrations = COMPLETE active list (backend me active='Y'
  // default — wahi rule jo React website ke directoryEmployees() me hai). Purana
  // /employees?pageSize=500 fetch backend ke 100-row clamp ki wajah se sirf pehle
  // 100 employees deta tha, isliye upcoming list adhoori thi. Yeh ek halki request
  // teeno lists ke liye shared hai — koi duplicate fetch nahi, koi attendance data nahi.
  const cele = useApiData('/hr/celebrations');
  // Marriage anniversaries: existing HR application import table (Excel import ka
  // asli source). Cache NAHI rakhte — import ke baad turant fresh data dikhe.
  const mar = useApiData('/marriage-anniversary');

  const employees = cele.data?.employees || [];
  const marriages = Array.isArray(mar.data) ? mar.data : [];

  // Aaj ke birthday / anniversary — DAY+MONTH match, year independent.
  const bToday = employees.filter((e) => isTodayMMDD(e.dateofbirth));
  // Agle 30 din: sirf month+day se next occurrence nikalte hain (year independent,
  // Dec-Jan boundary par next year roll hota hai). Aaj wala birthday "Today" list me
  // hai isliye days > 0 (original React ki established rule). Sort = jo pehle aayega upar.
  const bUpcoming = employees.map((e) => ({ e, days: daysUntilMonthDay(e.dateofbirth) })).filter((x) => x.days !== null && x.days > 0 && x.days <= 30).sort((a, b) => a.days - b.days);
  const aToday = employees.filter((e) => isTodayMMDD(e.dateofjoin));
  // Date of Joining ka month/day use karke agla work anniversary (45 din ka window).
  const aUpcoming = employees.map((e) => ({ e, days: daysUntilMonthDay(e.dateofjoin) })).filter((x) => x.days !== null && x.days > 0 && x.days <= 45).sort((a, b) => a.days - b.days);
  const mToday = marriages.filter((m) => isTodayMMDD(m.anniversarydate));
  // Imported marriage anniversary dates (HR table) se agla 60 din ka window —
  // missing/invalid dates daysUntilMonthDay se null hoke list se bahar ho jate hain.
  const mUpcoming = marriages.map((m) => ({ m, days: daysUntilMonthDay(m.anniversarydate) })).filter((x) => x.days !== null && x.days > 0 && x.days <= 60).sort((a, b) => a.days - b.days);

  // Marriage rows ke paycode CHAR-padded ho sakte hain ('1109        ') — trim karke
  // match karo, warna naam ki jagah raw paycode dikhata hai (employee matching fix).
  const findEmp = (paycode) => employees.find((x) => String(x.paycode || '').trim() === String(paycode || '').trim()) || { empname: String(paycode || '').trim() || '—', paycode, departmentcode: '—', designation: '—' };

  return (
    <AsyncBox loading={cele.loading || mar.loading} error={cele.error || mar.error} onRetry={() => { cele.reload(); mar.reload(); }} label="Celebrations load ho rahe hain...">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Birthdays Today" value={bToday.length} colorClass="text-pink-400" borderClass="border-l-pink-500" />
        <StatCard label="Work Anniversaries Today" value={aToday.length} colorClass="text-amber-400" borderClass="border-l-amber-500" />
        <StatCard label="Marriage Anniversaries Today" value={mToday.length} colorClass="text-rose-400" borderClass="border-l-rose-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <div className="glass-card rounded-3xl p-6">
          <h3 className="font-bold text-sm text-[var(--text)] flex items-center gap-2 mb-1"><i className="fas fa-cake-candles text-pink-400"></i> Today's Birthdays</h3>
          <p className="text-xs text-[var(--muted)] mb-4">Match on <span className="mono text-[var(--accent-soft)]">DAY + MONTH</span> of <span className="mono text-[var(--accent-soft)]">dateofbirth</span></p>
          <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
            {bToday.length ? bToday.map((e) => (
              <PersonRow key={e.paycode} e={e} extra={<p className="text-[10px] text-pink-300 mt-0.5"><i className="fas fa-cake-candles mr-1"></i>{prettyDate(e.dateofbirth)} • Age {ageFrom(e.dateofbirth)}</p>} />
            )) : <Empty msg="Aaj koi birthday nahi hai." />}
          </div>
        </div>

        <div className="glass-card rounded-3xl p-6">
          <h3 className="font-bold text-sm text-[var(--text)] flex items-center gap-2 mb-1"><i className="fas fa-calendar-star text-pink-400"></i> Upcoming Birthdays (Next 30 Days)</h3>
          <p className="text-xs text-[var(--muted)] mb-4">Dynamic list — no hard-coded dates</p>
          <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
            {bUpcoming.length ? bUpcoming.map((x) => (
              <PersonRow key={x.e.paycode} e={x.e} extra={<p className="text-[10px] text-[var(--muted)] mt-0.5">Birthday: <span className="text-pink-300 font-bold">{prettyDate(nextOccurrenceISO(x.e.dateofbirth))}</span> • {x.days} day(s) to go • Age {ageFrom(x.e.dateofbirth) + 1}</p>} />
            )) : <Empty msg="Next 30 days me koi birthday nahi." />}
          </div>
        </div>
        <div className="glass-card rounded-3xl p-6">
          <h3 className="font-bold text-sm text-[var(--text)] flex items-center gap-2 mb-1"><i className="fas fa-award text-amber-400"></i> Today's Work Anniversaries</h3>
          <p className="text-xs text-[var(--muted)] mb-4">Years completed from <span className="mono text-[var(--accent-soft)]">dateofjoin</span></p>
          <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
            {aToday.length ? aToday.map((e) => (
              <PersonRow key={e.paycode} e={e} extra={<p className="text-[10px] text-amber-300 mt-0.5"><i className="fas fa-award mr-1"></i>{yearsCompleted(e.dateofjoin)} years completed • joined {prettyDate(e.dateofjoin)}</p>} />
            )) : <Empty msg="Aaj koi work anniversary nahi hai." />}
          </div>
        </div>

        <div className="glass-card rounded-3xl p-6">
          <h3 className="font-bold text-sm text-[var(--text)] flex items-center gap-2 mb-1"><i className="fas fa-calendar-plus text-amber-400"></i> Upcoming Work Anniversaries (Next 45 Days)</h3>
          <p className="text-xs text-[var(--muted)] mb-4">Upcoming milestones with days remaining</p>
          <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
            {aUpcoming.length ? aUpcoming.map((x) => (
              <PersonRow key={x.e.paycode} e={x.e} extra={<p className="text-[10px] text-[var(--muted)] mt-0.5">On <span className="text-amber-300 font-bold">{prettyDate(nextOccurrenceISO(x.e.dateofjoin))}</span> • {x.days} day(s) to go • {yearsCompleted(x.e.dateofjoin) + 1} years</p>} />
            )) : <Empty msg="Next 45 days me koi work anniversary nahi." />}
          </div>
        </div>
      </div>

      <div className="glass-card rounded-3xl p-6 mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <h3 className="font-bold text-sm text-[var(--text)] flex items-center gap-2"><i className="fas fa-heart text-rose-400"></i> Marriage Anniversaries</h3>
            <p className="text-xs text-[var(--muted)]">HR application table (separate from <span className="mono text-[var(--accent-soft)]">dbo.tblemployee</span>) • matching key: paycode / presentcardno</p>
          </div>
          <Link href="/hr/marriage" className="px-3.5 py-2 rounded-xl bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 text-[11px] font-bold transition"><i className="fas fa-file-excel mr-1"></i>Manage / Import Excel</Link>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)] mb-3">Today</h4>
            <div className="space-y-3">
              {mToday.length ? mToday.map((m) => (
                <PersonRow key={m.id ?? m.paycode} e={findEmp(m.paycode)} extra={<p className="text-[10px] text-rose-300 mt-0.5"><i className="fas fa-heart mr-1"></i>{prettyDate(m.anniversarydate)} • {yearsCompleted(m.anniversarydate)} years</p>} />
              )) : <Empty msg="Aaj koi marriage anniversary nahi (ya data import nahi hua)." />}
            </div>
          </div>
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)] mb-3">Upcoming (Next 60 Days)</h4>
            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {mUpcoming.length ? mUpcoming.map((x) => (
                <PersonRow key={x.m.id ?? x.m.paycode} e={findEmp(x.m.paycode)} extra={<p className="text-[10px] text-[var(--muted)] mt-0.5">On <span className="text-rose-300 font-bold">{prettyDate(nextOccurrenceISO(x.m.anniversarydate))}</span> • {x.days} day(s) to go • {yearsCompleted(x.m.anniversarydate) + 1} years</p>} />
              )) : <Empty msg="Next 60 days me koi marriage anniversary nahi." />}
            </div>
          </div>
        </div>
      </div>
    </AsyncBox>
  );
}
