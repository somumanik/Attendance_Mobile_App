'use client';

// web-next/components/employee/LeaveSection.jsx
// Employee Leave — real balance, apply, and own requests (same backend as mobile).
//   GET  /api/employee/leave/types      GET  /api/employee/leave/balance
//   GET  /api/employee/leave/requests   POST /api/employee/leave/requests
//   POST /api/employee/leave/requests/:id/cancel
// Identity comes from the JWT (server side) — a paycode is never sent.

import { useCallback, useEffect, useMemo, useState } from 'react';
import apiFetch from '../../lib/api';
import { prettyDate, isoToday } from '../../lib/format';

const PLACEHOLDER = '—';
const clean = (v) => String(v == null ? '' : v).trim();

const STATUS_STYLE = {
  Pending: { color: '#D97706', bg: 'rgba(217,119,6,.14)', border: 'rgba(217,119,6,.4)' },
  Approved: { color: '#059669', bg: 'rgba(5,150,105,.14)', border: 'rgba(5,150,105,.4)' },
  Rejected: { color: '#DC2626', bg: 'rgba(220,38,38,.14)', border: 'rgba(220,38,38,.4)' },
  Cancelled: { color: '#64748B', bg: 'rgba(100,116,139,.14)', border: 'rgba(100,116,139,.4)' },
};
const statusStyle = (s) => STATUS_STYLE[clean(s)] || { color: '#64748B', bg: 'rgba(100,116,139,.12)', border: 'rgba(100,116,139,.3)' };
const daysLabel = (n) => { const v = Number(n) || 0; return v === 0.5 ? 'Half day' : `${v} day${v === 1 ? '' : 's'}`; };
const fmtDate = (iso) => (clean(iso) ? prettyDate(iso) : PLACEHOLDER);

const FILTERS = ['All', 'Pending', 'Approved', 'Rejected', 'Cancelled'];
const TYPE_PRESET = [
  ['PL', 'Paid Leave'], ['SL', 'Sick Leave'], ['CL', 'Casual Leave'],
  ['OLA', 'Optional Leave A'], ['OLB', 'Optional Leave B'],
];

export default function LeaveSection() {
  const [types, setTypes] = useState([]);
  const [balance, setBalance] = useState(null);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('All');
  const [form, setForm] = useState({ leavetype: '', fromdate: isoToday(), todate: isoToday(), isHalfDay: false, halfdaypart: 'FN', reason: '', contactdetails: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [cancelId, setCancelId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [t, b, r] = await Promise.all([
        apiFetch('/employee/leave/types').catch(() => ({ types: [] })),
        apiFetch('/employee/leave/balance').catch(() => ({ types: [] })),
        apiFetch('/employee/leave/requests').catch(() => ({ requests: [] })),
      ]);
      setTypes(Array.isArray(t?.types) ? t.types : []);
      setBalance(b?.types ? b : null);
      setRequests(Array.isArray(r?.requests) ? r.requests : []);
    } catch (e) {
      setError(e?.message || 'Unable to load your leave data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const typeOptions = useMemo(() => {
    if (types.length) return types.map((t) => ({ code: clean(t.leavetype), name: clean(t.typename) || clean(t.leavetype), active: t.active }));
    return TYPE_PRESET.map(([code, name]) => ({ code, name, active: true }));
  }, [types]);

  const balanceRows = balance?.types || [];
  const filtered = filter === 'All' ? requests : requests.filter((r) => clean(r.status) === filter);
  const counts = useMemo(() => {
    const c = { All: requests.length, Pending: 0, Approved: 0, Rejected: 0, Cancelled: 0 };
    requests.forEach((r) => { const s = clean(r.status); if (c[s] != null) c[s] += 1; });
    return c;
  }, [requests]);
  function setField(name, value) {
    setForm((f) => {
      const next = { ...f, [name]: value };
      if (name === 'isHalfDay' && value) { next.todate = next.fromdate; next.halfdaypart = 'FN'; }
      if (name === 'fromdate' && f.isHalfDay) next.todate = value;
      return next;
    });
    setMsg(null);
  }

  function validate() {
    if (!clean(form.leavetype)) return 'Leave type select karein.';
    if (!clean(form.fromdate) || !clean(form.todate)) return 'From aur To date dono required hain.';
    if (clean(form.todate) < clean(form.fromdate)) return 'To date, From date se pehle nahi ho sakti.';
    if (form.isHalfDay && clean(form.fromdate) !== clean(form.todate)) return 'Half day leave sirf ek din ke liye hoti hai.';
    if (clean(form.reason).length < 3) return 'Leave ka reason likhein (kam se kam 3 characters).';
    return '';
  }

  async function submit(e) {
    e.preventDefault();
    const err = validate();
    if (err) { setMsg({ ok: false, text: err }); return; }
    setBusy(true);
    setMsg(null);
    try {
      const body = {
        leavetype: clean(form.leavetype),
        fromdate: clean(form.fromdate),
        todate: form.isHalfDay ? clean(form.fromdate) : clean(form.todate),
        isHalfDay: form.isHalfDay === true,
        halfdaypart: form.isHalfDay ? clean(form.halfdaypart) : undefined,
        reason: clean(form.reason),
        contactdetails: clean(form.contactdetails),
      };
      const res = await apiFetch('/employee/leave/requests', { method: 'POST', body });
      setMsg({ ok: true, text: `Leave request submit ho gayi (${daysLabel(res?.request?.days)}). HR approval ke liye pending hai.` });
      setForm({ leavetype: '', fromdate: isoToday(), todate: isoToday(), isHalfDay: false, halfdaypart: 'FN', reason: '', contactdetails: '' });
      await load();
    } catch (e2) {
      setMsg({ ok: false, text: e2?.message || 'Leave request submit nahi ho payi. Dobara try karein.' });
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id) {
    setCancelId(id);
    try {
      await apiFetch(`/employee/leave/requests/${id}/cancel`, { method: 'POST' });
      setMsg({ ok: true, text: 'Leave request cancel ho gayi.' });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e?.message || 'Request cancel nahi ho payi.' });
    } finally {
      setCancelId(null);
    }
  }
  return (
    <div className="leave">
      <div className="card">
        <h3 className="card__title">Leave Balance{balance?.leaveyear ? ` · ${balance.leaveyear}` : ''}</h3>
        {loading ? <p className="muted">Balance load ho raha hai…</p> : balanceRows.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Leave Type</th><th>Opening</th><th>Approved Used</th><th>Pending</th><th>Available</th></tr></thead>
              <tbody>
                {balanceRows.map((t) => (
                  <tr key={clean(t.leavetype)}>
                    <td><strong>{clean(t.leavetype)}</strong>{clean(t.typename) && clean(t.typename) !== clean(t.leavetype) ? <span className="muted"> · {clean(t.typename)}</span> : null}</td>
                    <td>{Number(t.openingBalance || 0)}</td>
                    <td>{Number(t.approvedUsed || 0)}</td>
                    <td>{Number(t.pending || 0)}</td>
                    <td><strong style={{ color: Number(t.availableBalance || 0) > 0 ? '#059669' : '#D97706' }}>{Number(t.availableBalance || 0)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">Koi leave balance configured nahi hai (opening balance Excel import se aata hai). Available zero hai.</p>
        )}
      </div>

      <div className="card">
        <h3 className="card__title">Apply for Leave</h3>
        <form onSubmit={submit} className="leave-form">
          {msg ? <div className={msg.ok ? 'leave-msg leave-msg--ok' : 'leave-msg leave-msg--err'} role="alert">{msg.text}</div> : null}

          <div className="field">
            <span className="field__label">Leave Type</span>
            <div className="leave-types">
              {typeOptions.filter((t) => t.active !== false).map((t) => (
                <button
                  key={t.code}
                  type="button"
                  className={'leave-chip' + (form.leavetype === t.code ? ' leave-chip--active' : '')}
                  onClick={() => setField('leavetype', t.code)}
                >
                  <strong>{t.code}</strong><span>{t.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="leave-row">
            <div className="field">
              <label className="field__label" htmlFor="lv-from">From Date</label>
              <input id="lv-from" className="field__input" type="date" value={form.fromdate} onChange={(e) => setField('fromdate', e.target.value)} required />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="lv-to">To Date</label>
              <input id="lv-to" className="field__input" type="date" value={form.todate} onChange={(e) => setField('todate', e.target.value)} required disabled={form.isHalfDay} />
            </div>
          </div>

          <div className="field">
            <span className="field__label">Duration</span>
            <div className="leave-row leave-row--tight">
              <button type="button" className={'leave-toggle' + (!form.isHalfDay ? ' leave-toggle--active' : '')} onClick={() => setField('isHalfDay', false)}>Full Day</button>
              <button type="button" className={'leave-toggle' + (form.isHalfDay ? ' leave-toggle--active' : '')} onClick={() => setField('isHalfDay', true)}>Half Day</button>
              {form.isHalfDay ? (
                <>
                  <button type="button" className={'leave-toggle' + (form.halfdaypart === 'FN' ? ' leave-toggle--active' : '')} onClick={() => setField('halfdaypart', 'FN')}>First Half</button>
                  <button type="button" className={'leave-toggle' + (form.halfdaypart === 'AN' ? ' leave-toggle--active' : '')} onClick={() => setField('halfdaypart', 'AN')}>Second Half</button>
                </>
              ) : null}
            </div>
            <p className="muted leave-hint">Days working-days ke hisaab se server calculate karta hai (week-off/holiday skip hote hain).</p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="lv-reason">Reason</label>
            <textarea id="lv-reason" className="field__input leave-textarea" value={form.reason} onChange={(e) => setField('reason', e.target.value)} placeholder="Leave ka reason…" required />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="lv-contact">Contact Details (optional)</label>
            <input id="lv-contact" className="field__input" value={form.contactdetails} onChange={(e) => setField('contactdetails', e.target.value)} placeholder="Leave ke dauran contact number / address" />
          </div>

          <p className="muted leave-hint">Attachment upload is build mein available nahi hai (backend file download support nahi karta). Long leave par HR se attachment share karein.</p>

          <button className="btn btn--primary btn--block" type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit Leave Request'}</button>
        </form>
      </div>
      <div className="card">
        <div className="leave-req-head">
          <h3 className="card__title" style={{ margin: 0 }}>My Leave Requests</h3>
          <div className="leave-filters">
            {FILTERS.map((f) => (
              <button key={f} type="button" className={'leave-filter' + (filter === f ? ' leave-filter--active' : '')} onClick={() => setFilter(f)}>
                {f}<span className="leave-filter__count">{counts[f]}</span>
              </button>
            ))}
          </div>
        </div>

        {loading ? <p className="muted">Requests load ho rahe hain…</p> : error ? <p className="auth__error" role="alert">{error}</p> : filtered.length ? (
          <div className="leave-req-list">
            {filtered.map((r) => {
              const st = statusStyle(r.status);
              const canCancel = clean(r.status) === 'Pending';
              return (
                <div key={r.id} className="leave-req">
                  <div className="leave-req__top">
                    <div>
                      <div className="leave-req__type">{clean(r.typename) || clean(r.leavetype)}</div>
                      <div className="muted leave-req__dates">
                        {fmtDate(r.fromdate)} → {fmtDate(r.todate)}
                        {r.isHalfDay ? ` · ${clean(r.halfdaypart) === 'AN' ? 'Second Half' : 'First Half'}` : ''}
                        {r.days != null ? ` · ${daysLabel(r.days)}` : ''}
                      </div>
                    </div>
                    <span className="badge" style={{ background: st.bg, color: st.color, border: `1px solid ${st.border}` }}>{clean(r.status) || PLACEHOLDER}</span>
                  </div>
                  {clean(r.reason) ? <p className="leave-req__reason">{clean(r.reason)}</p> : null}
                  <div className="leave-req__meta">
                    {clean(r.contactdetails) ? <span className="muted">Contact: {clean(r.contactdetails)}</span> : null}
                    {r.hasAttachment ? <span className="muted">📎 {clean(r.attachmentname) || 'attachment'}</span> : null}
                  </div>
                  {clean(r.decisionnote) ? <p className="leave-req__decision">HR remark: {clean(r.decisionnote)}</p> : null}
                  <div className="leave-req__foot">
                    <span className="muted leave-req__applied">Applied {r.appliedat ? fmtDate(r.appliedat) : PLACEHOLDER}</span>
                    {canCancel ? (
                      <button type="button" className="leave-cancel" disabled={cancelId === r.id} onClick={() => cancel(r.id)}>
                        {cancelId === r.id ? 'Cancelling…' : 'Cancel'}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="empty">{filter === 'All' ? 'Aapne abhi tak koi leave request nahi ki hai.' : `${filter} status ki koi request nahi hai.`}</p>
        )}
      </div>
    </div>
  );
}
