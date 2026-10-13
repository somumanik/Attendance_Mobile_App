'use client';

// web-next/components/hr/EmailSection.jsx — Email Control Center (parity with index.html hrEmail).
// Provider config, templates, single/bulk send, preview, test, logs. Secrets never leave the backend.

import { useEffect, useState } from 'react';
import useApiData from '../useApiData';
import AsyncBox from '../employee/AsyncBox';
import apiFetch from '../../lib/api';
import { isoToday } from '../../lib/format';

const EVENT_TYPES = ['Birthday', 'Work Anniversary', 'Marriage Anniversary', 'Custom'];

function StatusCard({ label, value, ok }) {
  return (
    <div className="p-3.5 rounded-2xl bg-white/5 border border-white/5">
      <p className="text-[10px] uppercase font-bold text-[var(--muted)]">{label}</p>
      <p className={`text-sm font-bold mt-1 ${ok === false ? 'text-rose-400' : 'text-[var(--text)]'}`}>{value}</p>
    </div>
  );
}

const inputCls = 'w-full mt-1 px-3 py-2 rounded-xl bg-[var(--input-bg)] border border-[var(--border)] text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]';

export default function EmailSection() {
  const config = useApiData('/email/config');
  const log = useApiData('/email/log');
  const filters = useApiData('/hr/filters');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const [provType, setProvType] = useState('brevo');
  const [senderName, setSenderName] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [brevoKey, setBrevoKey] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [smtpSecure, setSmtpSecure] = useState(false);

  const [tpl, setTpl] = useState({});

  const [singlePaycode, setSinglePaycode] = useState('');
  const [singleType, setSingleType] = useState('Birthday');
  const [singleResolved, setSingleResolved] = useState(null);

  const [bulkType, setBulkType] = useState('Birthday');
  const [bulkDate, setBulkDate] = useState(isoToday());
  const [bulkCompany, setBulkCompany] = useState('');
  const [bulkDept, setBulkDept] = useState('');
  const [bulkPreview, setBulkPreview] = useState(null);

  const [testTo, setTestTo] = useState('');

  const c = config.data || {};
  const logs = Array.isArray(log.data) ? log.data : (log.data?.logs || []);
  const refresh = () => { config.reload(); log.reload(); };

  useEffect(() => {
    if (config.data?.config) setTpl({ ...config.data.config });
    if (config.data?.provider) {
      setProvType(config.data.provider.smtp ? 'smtp' : 'brevo');
      setSenderName(config.data.config?.sendername || '');
      setSenderEmail(config.data.config?.senderemail || '');
    }
  }, [config.data]);

  async function saveProvider() {
    setBusy(true); setMsg('');
    try {
      const payload = { provider: provType, sendername: senderName.trim(), senderemail: senderEmail.trim() };
      const key = brevoKey.trim();
      if (key) payload.brevoApiKey = key;
      if (provType === 'smtp') {
        payload.smtpHost = smtpHost.trim();
        payload.smtpPort = Number(smtpPort) || 587;
        payload.smtpUser = smtpUser.trim();
        payload.smtpSecure = smtpSecure;
        if (smtpPass) payload.smtpPassword = smtpPass;
      }
      await apiFetch('/email/provider', { method: 'POST', body: payload });
      setMsg('Provider + sender saved ✓ Ab "Send Test" se verify karo.');
      setBrevoKey(''); setSmtpPass('');
      config.reload();
    } catch (e) { setMsg(e?.message || 'Provider save failed'); }
    finally { setBusy(false); }
  }

  async function saveTemplates() {
    setBusy(true); setMsg('');
    try {
      await apiFetch('/email/config', { method: 'POST', body: tpl });
      setMsg('Templates saved ✓');
      config.reload();
    } catch (e) { setMsg(e?.message || 'Template save failed'); }
    finally { setBusy(false); }
  }

  async function sendTest() {
    if (!testTo) return;
    setBusy(true); setMsg('');
    try {
      const res = await apiFetch('/email/test', { method: 'POST', body: { to: testTo } });
      setMsg('Test email sent: ' + (res.messageId || 'OK'));
    } catch (e) { setMsg(e?.message || 'Test email failed.'); }
    finally { setBusy(false); }
  }

  async function resolveSingle() {
    setBusy(true); setMsg('');
    try {
      const res = await apiFetch(`/email/resolve?paycode=${encodeURIComponent(singlePaycode.trim())}`);
      setSingleResolved(res);
    } catch (e) { setSingleResolved(null); setMsg(e?.message || 'Resolve failed'); }
    finally { setBusy(false); }
  }

  async function sendSingle() {
    setBusy(true); setMsg('');
    try {
      const res = await apiFetch('/email/send-single', { method: 'POST', body: { paycode: singlePaycode.trim(), eventType: singleType } });
      setMsg('Email sent: ' + (res.subject || res.messageId || 'OK'));
      log.reload();
    } catch (e) { setMsg(e?.message || 'Send failed'); }
    finally { setBusy(false); }
  }

  async function previewBulk() {
    setBusy(true); setMsg('');
    try {
      const params = new URLSearchParams({ eventType: bulkType, date: bulkDate });
      if (bulkCompany) params.set('companycode', bulkCompany);
      if (bulkDept) params.set('departmentcode', bulkDept);
      const res = await apiFetch(`/email/preview?${params.toString()}`);
      setBulkPreview(res);
    } catch (e) { setMsg(e?.message || 'Preview failed'); }
    finally { setBusy(false); }
  }

  async function sendBulk() {
    setBusy(true); setMsg('');
    try {
      await apiFetch('/email/send', { method: 'POST', body: { eventType: bulkType, date: bulkDate, companycode: bulkCompany, departmentcode: bulkDept } });
      setMsg('Bulk email dispatched ✓');
      log.reload();
    } catch (e) { setMsg(e?.message || 'Bulk send failed'); }
    finally { setBusy(false); }
  }

  return (
    <>
      {/* __EMAIL_BODY__ */}
      <AsyncBox loading={config.loading} error={config.error} onRetry={refresh} label="Email config load ho raha hai...">
        <div className="glass-card rounded-3xl p-6">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-5 pb-4 border-b border-[var(--border)]">
            <div>
              <h2 className="text-base font-bold text-[var(--text)] flex items-center gap-2"><i className="fas fa-envelope text-violet-400"></i> Email Control Center</h2>
              <p className="text-xs text-[var(--muted)] mt-0.5">Brevo-powered employee greetings &amp; custom emails — HR Admin only, secrets stay server-side</p>
            </div>
            <button type="button" onClick={refresh} className="px-3.5 py-2 rounded-xl bg-white/5 border border-[var(--border)] hover:bg-white/10 text-xs font-bold text-[var(--text)] transition"><i className="fas fa-rotate mr-1.5"></i>Refresh</button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <StatusCard label="Email Provider" value={c.provider?.label || 'Not configured'} ok={c.provider?.configured} />
            <StatusCard label="Sender Email" value={c.config?.senderemail || 'Not set'} ok={!!c.config?.senderemail} />
            <StatusCard label="Recipients" value={c.recipientCount ?? '—'} />
            <StatusCard label="Missing Email" value={c.noEmailCount ?? '—'} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
              <p className="text-xs font-bold text-[var(--text)] mb-3"><i className="fas fa-sliders text-violet-400 mr-1.5"></i>Provider &amp; Sender</p>
              <dl className="space-y-2">
                <div className="flex justify-between gap-3 text-xs"><dt className="text-[var(--muted)]">Provider</dt><dd className="text-[var(--text)] font-semibold">{c.provider?.label || '—'}</dd></div>
                <div className="flex justify-between gap-3 text-xs"><dt className="text-[var(--muted)]">Configured</dt><dd className="text-[var(--text)] font-semibold">{c.provider?.configured ? 'Yes' : 'No'}</dd></div>
                <div className="flex justify-between gap-3 text-xs"><dt className="text-[var(--muted)]">Sender Name</dt><dd className="text-[var(--text)] font-semibold">{c.config?.sendername || '—'}</dd></div>
                <div className="flex justify-between gap-3 text-xs"><dt className="text-[var(--muted)]">Sender Email</dt><dd className="text-[var(--text)] font-semibold">{c.config?.senderemail || '—'}</dd></div>
                <div className="flex justify-between gap-3 text-xs"><dt className="text-[var(--muted)]">SQL Email Field</dt><dd className="text-[var(--text)] font-semibold">{c.sqlEmailField || 'e_mail1'}</dd></div>
              </dl>
              {c.provider?.hint ? <p className="text-[10px] text-amber-300 mt-3"><i className="fas fa-circle-info mr-1"></i>{c.provider.hint}</p> : null}
            </div>

            <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
              <p className="text-xs font-bold text-[var(--text)] mb-3"><i className="fas fa-paper-plane text-emerald-400 mr-1.5"></i>Send Test Email</p>
              <div className="flex gap-2">
                <input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="recipient@example.com" className="flex-1 bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]" />
                <button type="button" onClick={sendTest} disabled={busy || !testTo} className="px-4 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 text-xs font-bold transition disabled:opacity-50">
                  {busy ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-paper-plane mr-1"></i>}Send Test
                </button>
              </div>
              {msg ? <p className="text-[11px] text-[var(--accent-soft)] mt-3">{msg}</p> : null}
              <p className="text-[10px] text-[var(--muted)] mt-3">SMTP/API keys browser me kabhi nahi dikhte (server-side hi hain).</p>
            </div>
          </div>

          {/* __EMAIL_SECTIONS__ */}
          <div className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-2.5 mt-5">
            <p className="text-xs font-bold text-[var(--text)]"><i className="fas fa-sliders text-violet-400 mr-1.5"></i>Provider &amp; Sender Configuration</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              <div><label className="text-[10px] uppercase font-bold text-[var(--muted)]">Email Provider</label>
                <select value={provType} onChange={(e) => setProvType(e.target.value)} className={inputCls}>
                  <option value="brevo">Brevo — HTTPS API</option>
                  <option value="smtp">SMTP — custom mail server</option>
                </select>
              </div>
              <div><label className="text-[10px] uppercase font-bold text-[var(--muted)]">Sender Email</label><input type="email" value={senderEmail} onChange={(e) => setSenderEmail(e.target.value)} className={inputCls} /></div>
            </div>
            <div><label className="text-[10px] uppercase font-bold text-[var(--muted)]">Sender Name</label><input value={senderName} onChange={(e) => setSenderName(e.target.value)} className={inputCls} /></div>
            {provType === 'brevo' ? (
              <div><label className="text-[10px] uppercase font-bold text-[var(--muted)]">Brevo API Key (blank = keep stored)</label><input type="password" value={brevoKey} onChange={(e) => setBrevoKey(e.target.value)} placeholder="xkeysib-..." className={inputCls} /></div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                <div><label className="text-[10px] uppercase font-bold text-[var(--muted)]">SMTP Host</label><input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} className={inputCls} /></div>
                <div><label className="text-[10px] uppercase font-bold text-[var(--muted)]">SMTP Port</label><input value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} className={inputCls} /></div>
                <div><label className="text-[10px] uppercase font-bold text-[var(--muted)]">SMTP Username</label><input value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} className={inputCls} /></div>
                <div><label className="text-[10px] uppercase font-bold text-[var(--muted)]">SMTP Password (blank = keep stored)</label><input type="password" value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)} className={inputCls} /></div>
                <label className="flex items-center gap-1.5 cursor-pointer text-[10px] font-bold text-[var(--text)]"><input type="checkbox" checked={smtpSecure} onChange={(e) => setSmtpSecure(e.target.checked)} className="accent-emerald-500" />Secure (TLS)</label>
              </div>
            )}
            <button type="button" onClick={saveProvider} disabled={busy} className="w-full py-2.5 rounded-xl bg-violet-500/15 border border-violet-500/30 text-violet-300 hover:bg-violet-500/25 text-xs font-bold transition disabled:opacity-50">Save Provider &amp; Sender</button>
            {c.provider?.hint ? <p className="text-[10px] text-amber-300"><i className="fas fa-circle-info mr-1"></i>{c.provider.hint}</p> : null}
          </div>
          {/* __EMAIL_SECTIONS2__ */}
          <div className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-2.5 mt-5">
            <p className="text-xs font-bold text-[var(--text)]"><i className="fas fa-envelope-open-text text-violet-400 mr-1.5"></i>Email Templates</p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
              <div><label className="text-[10px] uppercase font-bold text-pink-300">Birthday Subject</label><input value={tpl.birthdaysubject || ''} onChange={(e) => setTpl({ ...tpl, birthdaysubject: e.target.value })} className={inputCls} /></div>
              <div><label className="text-[10px] uppercase font-bold text-sky-300">Work Anniversary Subject</label><input value={tpl.workanniversarysubject || ''} onChange={(e) => setTpl({ ...tpl, workanniversarysubject: e.target.value })} className={inputCls} /></div>
              <div><label className="text-[10px] uppercase font-bold text-rose-300">Marriage Anniversary Subject</label><input value={tpl.marriagesubject || ''} onChange={(e) => setTpl({ ...tpl, marriagesubject: e.target.value })} className={inputCls} /></div>
              <div><label className="text-[10px] uppercase font-bold text-violet-300">Custom Subject</label><input value={tpl.customsubject || ''} onChange={(e) => setTpl({ ...tpl, customsubject: e.target.value })} className={inputCls} /></div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
              <div><label className="text-[10px] uppercase font-bold text-pink-300">Birthday Body</label><textarea rows={2} value={tpl.birthdaybody || ''} onChange={(e) => setTpl({ ...tpl, birthdaybody: e.target.value })} className={inputCls} /></div>
              <div><label className="text-[10px] uppercase font-bold text-sky-300">Work Anniversary Body</label><textarea rows={2} value={tpl.workanniversarybody || ''} onChange={(e) => setTpl({ ...tpl, workanniversarybody: e.target.value })} className={inputCls} /></div>
              <div><label className="text-[10px] uppercase font-bold text-rose-300">Marriage Anniversary Body</label><textarea rows={2} value={tpl.marriagebody || ''} onChange={(e) => setTpl({ ...tpl, marriagebody: e.target.value })} className={inputCls} /></div>
              <div><label className="text-[10px] uppercase font-bold text-violet-300">Custom Body</label><textarea rows={2} value={tpl.custombody || ''} onChange={(e) => setTpl({ ...tpl, custombody: e.target.value })} className={inputCls} /></div>
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-1.5 cursor-pointer text-[10px] font-bold text-[var(--text)]"><input type="checkbox" checked={!!tpl.birthdayenabled} onChange={(e) => setTpl({ ...tpl, birthdayenabled: e.target.checked })} className="accent-pink-500" />Birthday auto-send</label>
              <label className="flex items-center gap-1.5 cursor-pointer text-[10px] font-bold text-[var(--text)]"><input type="checkbox" checked={!!tpl.workanniversaryenabled} onChange={(e) => setTpl({ ...tpl, workanniversaryenabled: e.target.checked })} className="accent-sky-500" />Work Anniversary auto-send</label>
              <label className="flex items-center gap-1.5 cursor-pointer text-[10px] font-bold text-[var(--text)]"><input type="checkbox" checked={!!tpl.marriageenabled} onChange={(e) => setTpl({ ...tpl, marriageenabled: e.target.checked })} className="accent-rose-500" />Marriage auto-send</label>
            </div>
            <button type="button" onClick={saveTemplates} disabled={busy} className="w-full py-2.5 rounded-xl bg-violet-500/15 border border-violet-500/30 text-violet-300 hover:bg-violet-500/25 text-xs font-bold transition disabled:opacity-50">Save All Templates</button>
          </div>
          {/* __EMAIL_SECTIONS3__ */}
          <div className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-3 mt-5">
            <p className="text-xs font-bold text-[var(--text)]"><i className="fas fa-user text-amber-400 mr-1.5"></i>Single Employee Email</p>
            <div className="flex flex-wrap gap-2">
              <input value={singlePaycode} onChange={(e) => setSinglePaycode(e.target.value)} placeholder="Employee paycode" className={inputCls} />
              <select value={singleType} onChange={(e) => setSingleType(e.target.value)} className={inputCls}>{EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
              <button type="button" onClick={resolveSingle} disabled={busy || !singlePaycode} className="px-4 py-2 rounded-xl bg-white/5 border border-[var(--border)] text-[var(--text)] text-xs font-bold transition disabled:opacity-50">Resolve</button>
            </div>
            {singleResolved && (
              <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-1 text-xs">
                <p><span className="text-[var(--muted)]">Employee:</span> <span className="font-semibold">{singleResolved.employee?.empname} ({singleResolved.employee?.paycode})</span></p>
                <p><span className="text-[var(--muted)]">Email:</span> <span className="mono">{singleResolved.email || '—'}</span> <span className="text-[10px] text-[var(--muted)]">({singleResolved.emailSource || ''})</span></p>
                <button type="button" onClick={sendSingle} disabled={busy || !singleResolved?.hasEmail} className="px-4 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 text-xs font-bold transition disabled:opacity-50"><i className="fas fa-paper-plane mr-1"></i>Send Email</button>
              </div>
            )}
          </div>

          <div className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-3 mt-5">
            <p className="text-xs font-bold text-[var(--text)]"><i className="fas fa-users text-sky-400 mr-1.5"></i>Bulk Email</p>
            <div className="flex flex-wrap gap-2 items-end">
              <div><label className="text-[10px] uppercase font-bold text-[var(--muted)]">Event</label><select value={bulkType} onChange={(e) => setBulkType(e.target.value)} className={inputCls}>{EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
              <div><label className="text-[10px] uppercase font-bold text-[var(--muted)]">Date</label><input type="date" value={bulkDate} onChange={(e) => setBulkDate(e.target.value)} className={inputCls} /></div>
              <div><label className="text-[10px] uppercase font-bold text-[var(--muted)]">Company</label><select value={bulkCompany} onChange={(e) => setBulkCompany(e.target.value)} className={inputCls}><option value="">All</option>{(filters.data?.companies || []).map((co) => <option key={co.code} value={co.code}>{co.name || co.code}</option>)}</select></div>
              <div><label className="text-[10px] uppercase font-bold text-[var(--muted)]">Department</label><select value={bulkDept} onChange={(e) => setBulkDept(e.target.value)} className={inputCls}><option value="">All</option>{(filters.data?.departments || []).map((d) => <option key={d.code} value={d.code}>{d.name || d.code}</option>)}</select></div>
              <button type="button" onClick={previewBulk} disabled={busy} className="px-4 py-2 rounded-xl bg-white/5 border border-[var(--border)] text-[var(--text)] text-xs font-bold transition disabled:opacity-50">Preview</button>
            </div>
            {bulkPreview && (
              <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-2 text-xs">
                <div className="flex flex-wrap gap-3">
                  <span className="text-[var(--muted)]">Total: <b className="text-[var(--text)]">{bulkPreview.total}</b></span>
                  <span className="text-[var(--muted)]">Valid: <b className="text-emerald-400">{bulkPreview.validEmails}</b></span>
                  <span className="text-[var(--muted)]">Missing: <b className="text-amber-400">{bulkPreview.missingEmails}</b></span>
                  <span className="text-[var(--muted)]">Already sent: <b className="text-sky-400">{bulkPreview.alreadySent}</b></span>
                  <span className="text-[var(--muted)]">Will send: <b className="text-emerald-400">{bulkPreview.willSend}</b></span>
                </div>
                <button type="button" onClick={sendBulk} disabled={busy || !bulkPreview.willSend} className="px-4 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 text-xs font-bold transition disabled:opacity-50"><i className="fas fa-paper-plane mr-1"></i>Send Bulk ({bulkPreview.willSend})</button>
              </div>
            )}
          </div>

        </div>
      </AsyncBox>
      {/* __EMAIL_LOG__ */}
      <div className="glass-card rounded-3xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="font-bold text-sm text-[var(--text)] flex items-center gap-2"><i className="fas fa-clock-rotate-left text-slate-300"></i> Email Log</h3>
          <button type="button" onClick={log.reload} className="px-3 py-1.5 rounded-xl bg-white/5 border border-[var(--border)] hover:bg-white/10 text-[11px] font-bold text-[var(--text)] transition">Refresh Log</button>
        </div>
        <AsyncBox loading={log.loading} error={log.error} onRetry={log.reload} label="Email log load ho raha hai...">
          {logs.length ? (
            <div className="overflow-x-auto">
              <table className="portal-table">
                <thead><tr><th>Date</th><th>Employee</th><th>Paycode</th><th>Company</th><th>Department</th><th>Event</th><th>Email</th><th>Status</th><th>Sent Time</th><th>Error</th></tr></thead>
                <tbody>
                  {logs.map((l, i) => (
                    <tr key={l.id ?? i}>
                      <td>{l.eventdate || '—'}</td>
                      <td>{l.employeename || '—'}</td>
                      <td className="mono">{l.paycode || '—'}</td>
                      <td>{l.companycode || '—'}</td>
                      <td>{l.departmentcode || '—'}</td>
                      <td>{l.eventtype || '—'}</td>
                      <td className="mono">{l.recipientemail || '—'}</td>
                      <td><span className={`badge ${l.status === 'Sent' ? 'badge--present' : l.status === 'Failed' ? 'badge--absent' : 'badge--neutral'}`}>{l.status || '—'}</span></td>
                      <td>{l.sentat || '—'}</td>
                      <td className="text-rose-300">{l.errormessage || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-[var(--muted)] py-6 text-center">Koi email attempt abhi tak record nahi hua.</p>
          )}
        </AsyncBox>
      </div>
    </>
  );
}
