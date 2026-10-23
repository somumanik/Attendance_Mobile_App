'use client';

// web-next/components/hr/HolidaysSection.jsx — Holiday Management (HR Admin).
//
// Website parity port of the WORKING mobile module
// (mobile/src/screens/hr/HRHolidayManagementScreen.jsx) against the SAME shared
// backend — no website-only data, no schema changes, no new endpoints:
//   GET    /api/hr/holidays             -> list (search / active filters)
//   GET    /api/hr/filters              -> REAL companies (+ real category name master)
//   GET    /api/hr/holiday-categories   -> REAL dynamic categories + company/category pairs
//   POST   /api/hr/holidays             -> add holiday
//   PUT    /api/hr/holidays/:id         -> edit / activate / deactivate
//   DELETE /api/hr/holidays/:id         -> delete
//
// Applicability (same as mobile): companies = REAL company master; categories =
// REAL employee categories of the SELECTED companies; saved applicability =
// real (company, category) pairs INTERSECT selection (computed server-side), so
// an impossible pair can never be stored and no Cartesian product is created.
// Duplicate rule stays the backend one (same date + same category -> rejected).
// Write endpoints are enforced server-side (requireRole('HR') + HR permission
// rules); every backend error is surfaced to the user, never swallowed.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import useApiData from '../useApiData';
import apiFetch from '../../lib/api';
import { prettyDate, currentMonthKey, shiftMonth, prettyMonth } from '../../lib/format';

const clean = (v) => String(v == null ? '' : v).trim();
const PLACEHOLDER = '—';
const WEEK_HEADER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** 'YYYY-MM-DD' from a LOCAL Date — calendar keys only, never UTC-shifted. */
const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayISO = () => isoOf(new Date());

function durationText(h) {
  return h?.isHalfDay
    ? `Half Day${clean(h?.halfdaypart) === 'AN' ? ' · Second Half' : ' · First Half'}`
    : 'Full Day';
}

/**
 * Month grid exactly like the mobile calendar: Monday-first, a flat 42-cell
 * grid that INCLUDES leading/trailing adjacent-month dates, stepping with
 * setDate so month lengths (28/29/30/31), leap Februaries and year boundaries
 * always render correctly. Holidays are matched by exact 'YYYY-MM-DD' key, so
 * a holiday can never shift to the previous/next day. Multiple holidays on the
 * same date stay in a per-date array — markers never overwrite each other.
 */
function buildCalCells(monthKey, holidayByDate) {
  const m = /^(\d{4})-(\d{2})$/.exec(clean(monthKey));
  if (!m) return [];
  const year = Number(m[1]);
  const mon = Number(m[2]) - 1;
  const first = new Date(year, mon, 1);
  const lead = (first.getDay() + 6) % 7; // Monday-first
  const gridStart = new Date(year, mon, 1 - lead);
  const cells = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    const key = isoOf(d);
    const list = holidayByDate.get(key) || [];
    cells.push({
      key,
      day: d.getDate(),
      inMonth: d.getMonth() === mon && d.getFullYear() === year,
      holidays: list,
      hasActive: list.some((h) => h.active !== false),
      hasInactive: list.some((h) => h.active === false),
    });
  }
  return cells;
}

/** Chunk the flat 42-cell grid into 6 week rows of 7. */
function chunkWeeks(cells) {
  const out = [];
  for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
  return out;
}

/** Accessible modal shell (same pattern as AuditModal: portal, Escape, scroll lock). */
function Modal({ title, onClose, children, footer, maxWidth = 560 }) {
  const closeRef = useRef(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(4,3,13,.82)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="glass rounded-3xl w-full flex flex-col overflow-hidden shadow-2xl"
        style={{ maxHeight: 'calc(100dvh - 32px)', maxWidth }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <h3 className="font-bold text-base text-[var(--text)]">{title}</h3>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/15 text-slate-400 hover:text-white transition flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            aria-label="Close"
          >
            <i className="fas fa-times text-sm"></i>
          </button>
        </div>
        <div className="p-5 overflow-y-auto min-h-0 flex-1">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 px-5 py-4 border-t border-white/10 shrink-0">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/** Multi-select chip (companies / categories / duration), matching the mobile Chip. */
function Chip({ label, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`px-3 py-1.5 rounded-xl text-[11px] font-bold border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
        selected
          ? 'bg-indigo-600 border-indigo-500 text-white'
          : 'bg-white/5 border-[var(--border)] text-[var(--text)] hover:bg-white/10'
      }`}
    >
      {label}
    </button>
  );
}

const inputCls = 'px-3 py-2 rounded-xl bg-[var(--input-bg)] border border-[var(--border)] text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] w-full';
const btnGhost = 'px-3 py-2 rounded-xl bg-white/5 border border-[var(--border)] text-[var(--text)] text-[11px] font-bold transition hover:bg-white/10 disabled:opacity-40';
const btnPrimary = 'px-4 py-2 rounded-xl bg-indigo-600 text-white text-[11px] font-bold transition hover:bg-indigo-500 disabled:opacity-50';

export default function HolidaysSection() {
  // ---- Holiday list (same load contract as the mobile screen) ----
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const seqRef = useRef(0);

  // Filters (search / filter holidays)
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [activeFilter, setActiveFilter] = useState('ALL'); // ALL | Y | N

  // Company / category options
  const filters = useApiData('/hr/filters');
  const filterOptions = useMemo(() => ({
    companies: Array.isArray(filters.data?.companies) ? filters.data.companies : [],
    categories: Array.isArray(filters.data?.categories) ? filters.data.categories : [],
  }), [filters.data]);
  const [selectedCompanies, setSelectedCompanies] = useState([]);
  const [availableCategories, setAvailableCategories] = useState([]);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [companyCategoryPairs, setCompanyCategoryPairs] = useState([]);

  // Add / edit modal
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null); // read-only View modal
  const [form, setForm] = useState({ holidaydate: '', holidayname: '', description: '', companycode: '', active: true, isHalfDay: false, halfdaypart: '' });
  const [formErrors, setFormErrors] = useState({});
  const [formBanner, setFormBanner] = useState(null);
  const [saving, setSaving] = useState(false);

  // Row actions (toggle / delete) + list-level banner
  const [busyId, setBusyId] = useState(null);
  const [listBanner, setListBanner] = useState(null);

  // Month grid (holiday calendar)
  const [calMonth, setCalMonth] = useState(currentMonthKey());

  const load = useCallback(async (isRefresh) => {
    const seq = ++seqRef.current;
    if (isRefresh) setRefreshing(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (activeFilter !== 'ALL') params.set('active', activeFilter);
      // Same as mobile: the calendar derives its purple markers from THIS list
      // by exact date key, so markers always follow the displayed month with no
      // hard-coded dates and no stale UI.
      const qs = params.toString();
      const list = await apiFetch(`/hr/holidays${qs ? `?${qs}` : ''}`);
      if (seq !== seqRef.current) return;
      setHolidays(Array.isArray(list?.holidays) ? list.holidays : []);
    } catch (err) {
      if (seq !== seqRef.current) return;
      setError(err?.data?.message || err?.message || 'Holidays load nahi ho paye.');
    } finally {
      if (seq === seqRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [search, activeFilter]);

  useEffect(() => { load(false); }, [load]);

  // Load categories for selected companies (REAL employee categories of exactly
  // those companies — union, no duplicates). Selections that became invalid
  // after a company change are pruned (mobile behaviour).
  useEffect(() => {
    let active = true;
    const fetchCategories = async () => {
      if (!selectedCompanies.length) {
        if (active) { setAvailableCategories([]); setCompanyCategoryPairs([]); }
        return;
      }
      setLoadingCategories(true);
      try {
        const res = await apiFetch(`/hr/holiday-categories?companies=${encodeURIComponent(selectedCompanies.join(','))}`);
        if (!active) return;
        const cats = Array.isArray(res?.categories) ? res.categories : [];
        const pairs = Array.isArray(res?.pairs) ? res.pairs : [];
        setAvailableCategories(cats);
        setCompanyCategoryPairs(pairs);
        const validCodes = new Set(cats.map((c) => c.code));
        setSelectedCategories((prev) => prev.filter((c) => validCodes.has(c)));
      } catch {
        if (active) { setAvailableCategories([]); setCompanyCategoryPairs([]); }
      } finally {
        if (active) setLoadingCategories(false);
      }
    };
    fetchCategories();
    return () => { active = false; };
  }, [selectedCompanies]);

  const applySearch = () => { setSearch(searchDraft.trim()); };

  // ---- Add / edit ----
  const openForm = (holiday = null) => {
    if (holiday) {
      setEditing(holiday);
      const companies = Array.isArray(holiday.companies) ? holiday.companies : (clean(holiday.companycode) ? [clean(holiday.companycode)] : []);
      const categories = Array.isArray(holiday.categories) ? holiday.categories : [];
      const pairs = Array.isArray(holiday.companyCategoryPairs) ? holiday.companyCategoryPairs : [];
      setSelectedCompanies(companies);
      setSelectedCategories(categories);
      setCompanyCategoryPairs(pairs);
      setForm({
        holidaydate: clean(holiday.holidaydate).slice(0, 10),
        holidayname: clean(holiday.holidayname),
        description: clean(holiday.description),
        companycode: clean(holiday.companycode),
        active: holiday.active !== false,
        isHalfDay: Boolean(holiday.isHalfDay),
        halfdaypart: clean(holiday.halfdaypart),
      });
    } else {
      setEditing(null);
      setSelectedCompanies([]);
      setSelectedCategories([]);
      setCompanyCategoryPairs([]);
      setForm({
        holidaydate: todayISO(),
        holidayname: '',
        description: '',
        companycode: '',
        active: true,
        isHalfDay: false,
        halfdaypart: '',
      });
    }
    setFormErrors({});
    setFormBanner(null);
    setFormOpen(true);
  };

  /**
   * Same validation as the mobile form: date, name, duration, at least one
   * company, at least one category — AND the selection must resolve to REAL
   * company+category pairs from employee data (no impossible combinations).
   */
  const validate = () => {
    const errors = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.holidaydate)) errors.holidaydate = 'Date YYYY-MM-DD format mein daalein.';
    if (!form.holidayname.trim()) errors.holidayname = 'Holiday name required hai.';
    if (typeof form.isHalfDay !== 'boolean') errors.duration = 'Duration (Full Day / Half Day) select karein.';
    if (!selectedCompanies.length) errors.companies = 'Kam se kam ek company select karein.';
    if (selectedCompanies.length && !selectedCategories.length) errors.categories = 'Kam se kam ek category select karein.';

    if (selectedCompanies.length && selectedCategories.length) {
      if (loadingCategories) {
        errors.categories = 'Categories abhi load ho rahi hain, ek moment rukein.';
      } else {
        // REAL pairs (server se, selected companies ke liye) me se sirf
        // selected companies x selected categories wale valid pairs.
        const validPairs = companyCategoryPairs.filter(
          (p) => selectedCompanies.includes(p.companycode) && selectedCategories.includes(p.categorycode),
        );
        if (!validPairs.length) {
          errors.categories = 'Selected company/category combination employee data me exist nahi karta.';
        } else {
          const companyLabel = (code) => filterOptions.companies.find((c) => c.code === code)?.name || code;
          const catLabel = (code) => availableCategories.find((c) => c.code === code)?.name || code;
          const emptyCompany = selectedCompanies.find((c) => !validPairs.some((p) => p.companycode === c));
          if (emptyCompany) {
            errors.companies = `"${companyLabel(emptyCompany)}" me selected categories exist nahi karti - company ke liye kam se kam ek valid category chunein.`;
          }
          const emptyCat = selectedCategories.find((c) => !validPairs.some((p) => p.categorycode === c));
          if (emptyCat) {
            errors.categories = `Category "${catLabel(emptyCat)}" selected companies me exist nahi karti.`;
          }
        }
      }
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    setFormBanner(null);
    try {
      // Backend computes the authoritative applicability:
      //   REAL pairs INTERSECT (companies x categories) — never a Cartesian product.
      const payload = {
        holidaydate: form.holidaydate,
        holidayname: form.holidayname.trim(),
        description: form.description,
        companycode: selectedCompanies[0] || '',
        companies: selectedCompanies,
        categories: selectedCategories,
        isHalfDay: form.isHalfDay,
        halfdaypart: form.isHalfDay ? (form.halfdaypart || 'FN') : null,
        active: form.active,
      };
      if (editing) {
        await apiFetch(`/hr/holidays/${editing.id}`, { method: 'PUT', body: payload });
      } else {
        await apiFetch('/hr/holidays', { method: 'POST', body: payload });
      }
      setFormOpen(false);
      setEditing(null);
      load(true);
    } catch (err) {
      // Surface backend validation codes on the matching field (mobile parity);
      // any other failure shows the backend message — never a success state.
      const data = err?.data;
      if (data?.code === 'DUPLICATE_HOLIDAY') {
        setFormErrors({ holidaydate: data.message });
      } else if (data?.code === 'COMPANY_REQUIRED') {
        setFormErrors({ companies: data.message });
      } else if (data?.code === 'CATEGORY_REQUIRED') {
        setFormErrors({ categories: data.message });
      } else if (data?.code === 'NO_VALID_PAIRS') {
        setFormErrors({ categories: data.message });
      } else {
        setFormBanner({ ok: false, text: data?.message || err?.message || 'Please try again.' });
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (holiday) => {
    setBusyId(holiday.id);
    setListBanner(null);
    try {
      await apiFetch(`/hr/holidays/${holiday.id}`, { method: 'PUT', body: { active: !holiday.active } });
      load(true);
    } catch (err) {
      setListBanner({ ok: false, text: err?.data?.message || err?.message || 'Could not update status.' });
    } finally {
      setBusyId(null);
    }
  };

  /** Shared delete call (runs after the user confirms). */
  const runDelete = async (holiday) => {
    setBusyId(holiday.id);
    setListBanner(null);
    try {
      await apiFetch(`/hr/holidays/${holiday.id}`, { method: 'DELETE' });
      load(true);
    } catch (err) {
      setListBanner({ ok: false, text: err?.data?.message || err?.message || 'Could not delete.' });
    } finally {
      setBusyId(null);
    }
  };

  const remove = (holiday) => {
    const message = `"${clean(holiday.holidayname)}" (${prettyDate(holiday.holidaydate)}) permanently delete karein? Ye calendar se bhi hat jayega.`;
    if (window.confirm(message)) runDelete(holiday);
  };

  // ---- Month grid (holiday calendar) ----
  const holidayByDate = useMemo(() => {
    const map = new Map();
    holidays.forEach((h) => {
      const key = clean(h.holidaydate).slice(0, 10);
      if (!key) return;
      const list = map.get(key) || [];
      list.push(h);
      map.set(key, list);
    });
    return map;
  }, [holidays]);

  const calWeeks = useMemo(() => chunkWeeks(buildCalCells(calMonth, holidayByDate)), [calMonth, holidayByDate]);

  // Counters keep the mobile meaning: they count the currently loaded
  // (filtered) managed set, exactly like the reference implementation.
  const activeCount = useMemo(() => holidays.filter((h) => h.active !== false).length, [holidays]);
  const inactiveCount = holidays.length - activeCount;

  // Category name lookup: REAL tblcategory master (from /hr/filters) FIRST, then
  // the company-specific dynamic categories, so rows/views always show real names.
  const categoryNameLookup = useMemo(() => {
    const map = new Map();
    for (const c of filterOptions.categories) {
      if (c && c.code) map.set(c.code, c.name || c.code);
    }
    for (const c of availableCategories) map.set(c.code, c.name || c.code);
    return map;
  }, [filterOptions.categories, availableCategories]);

  const companyNameOf = (code) => filterOptions.companies.find((c) => c.code === code)?.name || code;

  return (
    <div className="space-y-4">
      {/* ---------- Summary + actions + filters ---------- */}
      <div className="glass-card rounded-3xl p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-5">
          <h2 className="font-bold text-lg text-[var(--text)] flex items-center gap-2">
            <i className="fas fa-calendar-day text-violet-400"></i> Holiday Management
          </h2>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => load(true)} disabled={refreshing} className={btnGhost} aria-label="Refresh holidays">
              <i className={`fas fa-rotate mr-1 ${refreshing ? 'fa-spin' : ''}`}></i>Refresh
            </button>
            <button type="button" onClick={() => openForm()} className={btnPrimary}>
              <i className="fas fa-plus mr-1"></i>Add Holiday
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="p-4 rounded-2xl bg-violet-500/10 border border-violet-500/20 text-center">
            <p className="text-2xl font-extrabold text-violet-300">{activeCount}</p>
            <p className="text-[10px] text-[var(--muted)] uppercase font-bold mt-1">Active</p>
          </div>
          <div className="p-4 rounded-2xl bg-slate-500/10 border border-slate-500/20 text-center">
            <p className="text-2xl font-extrabold text-slate-300">{inactiveCount}</p>
            <p className="text-[10px] text-[var(--muted)] uppercase font-bold mt-1">Inactive</p>
          </div>
          <div className="p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-center col-span-2 lg:col-span-1">
            <p className="text-2xl font-extrabold text-indigo-300">{holidays.length}</p>
            <p className="text-[10px] text-[var(--muted)] uppercase font-bold mt-1">Total</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-5">
          <form
            className="flex items-center gap-2 flex-1 min-w-[220px]"
            onSubmit={(e) => { e.preventDefault(); applySearch(); }}
          >
            <input
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Search name, description, company..."
              aria-label="Search holidays"
              className={inputCls}
            />
            <button type="submit" className={btnGhost} aria-label="Search holidays">
              <i className="fas fa-search"></i>
            </button>
          </form>
          <div className="flex flex-wrap items-center gap-1.5">
            {[['ALL', 'All'], ['Y', 'Active'], ['N', 'Inactive']].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setActiveFilter(value)}
                aria-pressed={activeFilter === value}
                className={`px-3.5 py-1.5 rounded-xl text-[11px] font-bold transition ${
                  activeFilter === value
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white/5 border border-[var(--border)] text-[var(--text)] hover:bg-white/10'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {listBanner ? (
        <p className={`text-xs px-3 py-2 rounded-xl border ${listBanner.ok ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20' : 'text-rose-300 bg-rose-500/10 border-rose-500/20'}`}>
          {listBanner.text}
        </p>
      ) : null}

      {/* ---------- Holiday calendar (month navigation, no hardcoded dates) ---------- */}
      <div className="glass-card rounded-3xl p-6">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <h3 className="font-bold text-sm text-[var(--text)]">Holiday Calendar</h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCalMonth(shiftMonth(calMonth, -1))}
              className={btnGhost}
              aria-label="Previous month"
            >
              <i className="fas fa-chevron-left"></i>
            </button>
            <span className="px-3 py-1.5 rounded-lg bg-violet-600/15 border border-violet-500/30 text-violet-200 text-xs font-bold min-w-[86px] text-center">
              {prettyMonth(calMonth)}
            </span>
            <button
              type="button"
              onClick={() => setCalMonth(shiftMonth(calMonth, 1))}
              className={btnGhost}
              aria-label="Next month"
            >
              <i className="fas fa-chevron-right"></i>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1 mb-1">
          {WEEK_HEADER.map((w) => (
            <div key={w} className="text-center text-[10px] font-bold uppercase tracking-wide text-[var(--muted)] py-1">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {calWeeks.flat().map((c) => {
            const showHoliday = c.inMonth && (c.hasActive || c.hasInactive);
            return (
              <div
                key={c.key}
                title={showHoliday ? c.holidays.map((h) => h.holidayname).join(', ') : undefined}
                aria-label={`${c.key}${showHoliday ? ` holiday ${c.holidays.map((h) => h.holidayname).join(', ')}` : ' no holiday'}`}
                className="flex flex-col items-center justify-start gap-0.5 rounded-xl py-1.5 px-0.5 min-h-[42px]"
              >
                <span
                  className="w-3 h-1 rounded-full"
                  style={{
                    backgroundColor: showHoliday ? '#7C3AED' : 'transparent',
                    opacity: c.hasActive ? 1 : 0.35,
                  }}
                ></span>
                <span
                  className={`text-xs font-bold leading-none ${
                    !c.inMonth
                      ? 'text-[var(--muted)] opacity-50 font-medium'
                      : showHoliday && !c.hasActive
                        ? 'text-[var(--muted)]'
                        : 'text-[var(--text)]'
                  }`}
                >
                  {c.day}
                </span>
              </div>
            );
          })}
        </div>
        <p className="text-[10px] text-[var(--muted)] mt-2">Purple dot = holiday. Inactive holidays appear faded.</p>
      </div>

      {/* ---------- Holiday list ---------- */}
      <div className="glass-card rounded-3xl p-6">
        <h3 className="font-bold text-sm text-[var(--text)] mb-4">Holidays</h3>

        {loading ? (
          <div className="flex flex-col items-center gap-3 py-10">
            <i className="fas fa-spinner fa-spin text-xl text-[var(--accent-soft)]"></i>
            <p className="text-xs text-[var(--muted)]">Loading holidays...</p>
          </div>
        ) : null}

        {!loading && error ? (
          <div className="flex flex-col items-center gap-3 py-8 px-4 rounded-2xl bg-rose-500/10 border border-rose-500/20">
            <p className="text-xs text-rose-300 text-center"><i className="fas fa-circle-exclamation mr-1"></i>{error}</p>
            <button type="button" onClick={() => load(false)} className={btnGhost}>Retry</button>
          </div>
        ) : null}

        {!loading && !error && holidays.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-xs text-[var(--text)] font-semibold">Is filter me koi holiday nahi hai.</p>
            <p className="text-[11px] text-[var(--muted)] mt-1">&quot;Add Holiday&quot; se naya holiday banayein.</p>
          </div>
        ) : null}

        {!loading && !error && holidays.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Holiday</th>
                  <th>Companies</th>
                  <th>Categories</th>
                  <th>Duration</th>
                  <th>Status</th>
                  <th className="text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {holidays.map((h) => {
                  const isActive = h.active !== false;
                  const companies = Array.isArray(h.companies) ? h.companies : (clean(h.companycode) ? [clean(h.companycode)] : []);
                  const cats = Array.isArray(h.categories) ? h.categories : [];
                  return (
                    <tr key={h.id}>
                      <td className="mono whitespace-nowrap">{prettyDate(h.holidaydate)}</td>
                      <td>
                        <span className="font-semibold">{clean(h.holidayname)}</span>
                        {clean(h.description) ? <span className="block text-[10px] text-[var(--muted)] max-w-[260px] truncate">{clean(h.description)}</span> : null}
                      </td>
                      <td className="text-[11px] max-w-[180px]">
                        {companies.length ? companies.map((c) => companyNameOf(c)).join(', ') : PLACEHOLDER}
                      </td>
                      <td className="text-[11px] max-w-[180px]">
                        {cats.length ? cats.map((c) => categoryNameLookup.get(c) || c).join(', ') : (clean(h.category) || PLACEHOLDER)}
                      </td>
                      <td className="text-[11px] whitespace-nowrap">{durationText(h)}</td>
                      <td>
                        <span className={`badge ${isActive ? 'badge--present' : 'badge--neutral'}`}>{isActive ? 'Active' : 'Inactive'}</span>
                      </td>
                      <td className="text-center">
                        <div className="flex justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setViewing(h)}
                            className="px-2.5 py-1 rounded-lg bg-white/5 border border-[var(--border)] text-[var(--text)] hover:bg-white/10 text-[11px] font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                            aria-label={`View ${clean(h.holidayname)}`}
                            title="View details"
                          >
                            <i className="fas fa-circle-info"></i>
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleActive(h)}
                            disabled={busyId === h.id}
                            className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold transition disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                              isActive
                                ? 'bg-amber-500/15 border-amber-500/30 text-amber-300 hover:bg-amber-500/25'
                                : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25'
                            }`}
                            aria-label={isActive ? `Deactivate ${clean(h.holidayname)}` : `Activate ${clean(h.holidayname)}`}
                            title={isActive ? 'Deactivate' : 'Activate'}
                          >
                            {busyId === h.id ? <i className="fas fa-spinner fa-spin"></i> : <i className={`fas ${isActive ? 'fa-eye-slash' : 'fa-eye'}`}></i>}
                          </button>
                          <button
                            type="button"
                            onClick={() => openForm(h)}
                            className="px-2.5 py-1 rounded-lg bg-sky-500/15 border border-sky-500/30 text-sky-300 hover:bg-sky-500/25 text-[11px] font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                            aria-label={`Edit ${clean(h.holidayname)}`}
                            title="Edit"
                          >
                            <i className="fas fa-pen"></i>
                          </button>
                          <button
                            type="button"
                            onClick={() => remove(h)}
                            disabled={busyId === h.id}
                            className="px-2.5 py-1 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 text-[11px] font-bold transition disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                            aria-label={`Delete ${clean(h.holidayname)}`}
                            title="Delete"
                          >
                            <i className="fas fa-trash"></i>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {/* ---------- Add / edit holiday ---------- */}
      {formOpen ? (
        <Modal
          title={editing ? 'Edit Holiday' : 'Add Holiday'}
          onClose={() => { if (!saving) { setFormOpen(false); setEditing(null); } }}
          maxWidth={640}
          footer={(
            <>
              <button type="button" onClick={() => { setFormOpen(false); setEditing(null); }} disabled={saving} className={btnGhost}>Cancel</button>
              <button type="button" onClick={save} disabled={saving} className={btnPrimary}>
                {saving ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-check mr-1"></i>}
                {editing ? 'Save Changes' : 'Add Holiday'}
              </button>
            </>
          )}
        >
          {formBanner ? (
            <p className={`text-xs mb-3 px-3 py-2 rounded-xl border ${formBanner.ok ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20' : 'text-rose-300 bg-rose-500/10 border-rose-500/20'}`}>
              {formBanner.text}
            </p>
          ) : null}

          <div>
            <label htmlFor="holiday-date" className="block text-[10px] uppercase font-bold text-[var(--muted)] mb-1">
              Holiday Date <span className="text-rose-400">*</span>
            </label>
            <input
              id="holiday-date"
              type="date"
              value={form.holidaydate}
              onChange={(e) => setForm({ ...form, holidaydate: e.target.value })}
              className={`${inputCls} ${formErrors.holidaydate ? 'border-rose-500/60' : ''}`}
              required
            />
            {formErrors.holidaydate ? <p className="text-[11px] text-rose-300 mt-1">{formErrors.holidaydate}</p> : null}
          </div>

          <div className="mt-3">
            <label htmlFor="holiday-name" className="block text-[10px] uppercase font-bold text-[var(--muted)] mb-1">
              Holiday Name <span className="text-rose-400">*</span>
            </label>
            <input
              id="holiday-name"
              value={form.holidayname}
              onChange={(e) => setForm({ ...form, holidayname: e.target.value })}
              placeholder="e.g. Republic Day"
              maxLength={200}
              className={`${inputCls} ${formErrors.holidayname ? 'border-rose-500/60' : ''}`}
              required
            />
            {formErrors.holidayname ? <p className="text-[11px] text-rose-300 mt-1">{formErrors.holidayname}</p> : null}
          </div>

          <div className="mt-3">
            <span className="block text-[10px] uppercase font-bold text-[var(--muted)] mb-1">
              Companies <span className="text-rose-400">*</span>
            </span>
            <div className="flex flex-wrap gap-1.5">
              {filterOptions.companies.length ? filterOptions.companies.map((c) => {
                const sel = selectedCompanies.includes(c.code);
                return (
                  <Chip
                    key={c.code}
                    label={c.name || c.code}
                    selected={sel}
                    onClick={() => setSelectedCompanies((prev) => (sel ? prev.filter((x) => x !== c.code) : [...prev, c.code]))}
                  />
                );
              }) : <p className="text-[11px] text-[var(--muted)]">Companies load nahi hui — Refresh karein.</p>}
            </div>
            {formErrors.companies ? <p className="text-[11px] text-rose-300 mt-1">{formErrors.companies}</p> : null}
          </div>

          <div className="mt-3">
            <span className="block text-[10px] uppercase font-bold text-[var(--muted)] mb-1">
              Categories <span className="text-rose-400">*</span>
            </span>
            {/* Dynamic categories: REAL employee categories of the SELECTED
                companies only (union, no duplicates) — same states as mobile:
                none selected -> "Select company first"; loading -> spinner;
                no data -> explicit message; else -> multi-select chips. */}
            {!selectedCompanies.length ? (
              <p className="text-[11px] text-[var(--muted)]">Select company first - categories selected companies ke employee data se aati hain.</p>
            ) : loadingCategories ? (
              <p className="text-[11px] text-[var(--muted)]"><i className="fas fa-spinner fa-spin mr-1"></i>Loading categories...</p>
            ) : availableCategories.length ? (
              <div className="flex flex-wrap gap-1.5">
                {availableCategories.map((c) => {
                  const sel = selectedCategories.includes(c.code);
                  return (
                    <Chip
                      key={c.code}
                      label={c.name || c.code}
                      selected={sel}
                      onClick={() => setSelectedCategories((prev) => (sel ? prev.filter((x) => x !== c.code) : [...prev, c.code]))}
                    />
                  );
                })}
              </div>
            ) : (
              <p className="text-[11px] text-[var(--muted)]">No employee categories found for selected company.</p>
            )}
            {formErrors.categories ? <p className="text-[11px] text-rose-300 mt-1">{formErrors.categories}</p> : null}
          </div>

          <div className="mt-3">
            <span className="block text-[10px] uppercase font-bold text-[var(--muted)] mb-1">
              Duration <span className="text-rose-400">*</span>
            </span>
            <div className="flex flex-wrap gap-1.5">
              <Chip label="Full Day" selected={!form.isHalfDay} onClick={() => setForm({ ...form, isHalfDay: false, halfdaypart: '' })} />
              <Chip label="Half Day" selected={form.isHalfDay} onClick={() => setForm({ ...form, isHalfDay: true, halfdaypart: form.halfdaypart || 'FN' })} />
              {form.isHalfDay ? (
                <>
                  <Chip label="First Half" selected={form.halfdaypart === 'FN'} onClick={() => setForm({ ...form, halfdaypart: 'FN' })} />
                  <Chip label="Second Half" selected={form.halfdaypart === 'AN'} onClick={() => setForm({ ...form, halfdaypart: 'AN' })} />
                </>
              ) : null}
            </div>
            {formErrors.duration ? <p className="text-[11px] text-rose-300 mt-1">{formErrors.duration}</p> : null}
          </div>

          <div className="mt-3">
            <label htmlFor="holiday-desc" className="block text-[10px] uppercase font-bold text-[var(--muted)] mb-1">
              Description (optional)
            </label>
            <textarea
              id="holiday-desc"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Short note..."
              maxLength={500}
              rows={3}
              className={`${inputCls} resize-y`}
            />
          </div>

          {editing ? (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setForm({ ...form, active: !form.active })}
                aria-pressed={form.active}
                className="flex items-center gap-2 text-xs font-bold text-[var(--text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded-lg"
              >
                <span className={`w-11 h-6 rounded-full flex items-center px-0.5 transition ${form.active ? 'bg-emerald-500' : 'bg-white/15 border border-[var(--border)]'}`}>
                  <span className={`w-5 h-5 rounded-full bg-white transition-transform ${form.active ? 'translate-x-5' : ''}`}></span>
                </span>
                {form.active ? 'Active' : 'Inactive'}
              </button>
            </div>
          ) : null}
        </Modal>
      ) : null}

      {/* ---------- View holiday (read-only details) ---------- */}
      {viewing ? (
        <Modal
          title="Holiday Details"
          onClose={() => setViewing(null)}
          maxWidth={520}
          footer={<button type="button" onClick={() => setViewing(null)} className={btnGhost}>Close</button>}
        >
          {(() => {
            const h = viewing || {};
            const companyNames = (Array.isArray(h.companies) && h.companies.length
              ? h.companies
              : (clean(h.companycode) ? [clean(h.companycode)] : [])
            ).map((code) => companyNameOf(code));
            const catNames = (Array.isArray(h.categories) ? h.categories : [])
              .map((code) => categoryNameLookup.get(code) || code);
            const rows = [
              ['Date', prettyDate(h.holidaydate)],
              ['Holiday', clean(h.holidayname)],
              ['Companies', companyNames.length ? companyNames.join(', ') : PLACEHOLDER],
              ['Categories', catNames.length ? catNames.join(', ') : PLACEHOLDER],
              ['Duration', durationText(h)],
              ['Status', h.active !== false ? 'Active' : 'Inactive'],
              ['Description', clean(h.description) || PLACEHOLDER],
            ];
            return rows.map(([key, value]) => (
              <div key={key} className="flex items-start justify-between gap-4 py-2 border-b border-white/5 last:border-b-0">
                <span className="text-[11px] font-bold text-[var(--muted)] w-24 shrink-0">{key}</span>
                <span className="text-xs text-[var(--text)] text-right min-w-0 flex-1 whitespace-pre-wrap break-words">{value}</span>
              </div>
            ));
          })()}
        </Modal>
      ) : null}
    </div>
  );
}