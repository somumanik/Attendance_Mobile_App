'use client';

// web-next/components/hr/EmailSection.jsx — Email Control Center (parity with index.html hrEmail).
// 6 logical tabs: Provider Config, Email Source/Import, Single Email, Bulk Email, Templates, Logs.
// Secrets never leave the backend; every send goes through the configured provider (Brevo/SMTP).

import { useEffect, useRef, useState } from 'react';
import useApiData from '../useApiData';
import apiFetch from '../../lib/api';
import { isoToday } from '../../lib/format';
import LoadingState from '../LoadingState';
import ErrorState from '../ErrorState';

const EVENT_TYPES = ['Birthday', 'Work Anniversary', 'Marriage Anniversary', 'Custom'];

const TABS = [
  { id: 'provider', label: 'Provider Config', icon: 'fa-sliders', color: 'text-violet-400' },
  { id: 'source', label: 'Email Source / Import', icon: 'fa-file-excel', color: 'text-teal-400' },
  { id: 'single', label: 'Single Email', icon: 'fa-user', color: 'text-amber-400' },
  { id: 'bulk', label: 'Bulk Email', icon: 'fa-users', color: 'text-sky-400' },
  { id: 'templates', label: 'Templates', icon: 'fa-envelope-open-text', color: 'text-violet-400' },
  { id: 'logs', label: 'Logs', icon: 'fa-clock-rotate-left', color: 'text-slate-300' },
];

const inputCls = 'w-full mt-1 px-3 py-2 rounded-xl bg-[var(--input-bg)] border border-[var(--border)] text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]';
const labelCls = 'text-[10px] uppercase font-bold text-[var(--muted)]';

function StatusCard({ label, value, tone }) {
  const color = {
    green: 'text-emerald-300',
    amber: 'text-amber-300',
    rose: 'text-rose-300',
    sky: 'text-sky-300',
    neutral: 'text-[var(--text)]',
  }[tone || 'neutral'];
  return (
    <div className="p-3.5 rounded-2xl bg-white/5 border border-white/5">
      <p className="text-[10px] uppercase font-bold text-[var(--muted)]">{label}</p>
      <p className={`text-sm font-bold mt-1 ${color}`}>{value}</p>
    </div>
  );
}

function statusBadge(status) {
  if (status === 'Sent') return <span className="badge badge--present">Sent</span>;
  if (status === 'Failed') return <span className="badge badge--absent">Failed</span>;
  if (status === 'Invalid Email') return <span className="badge badge--miss">Invalid Email</span>;
  return <span className="badge badge--neutral">{status || 'Pending'}</span>;
}

function downloadCsv(filename, rows) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = '\uFEFF' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function Notice({ ok, children }) {
  return (
    <div className={`rounded-xl px-3 py-2 text-[11px] font-semibold leading-relaxed ${ok ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-200' : 'bg-rose-500/10 border border-rose-500/20 text-rose-200'}`}>
      {children}
    </div>
  );
}

export default function EmailSection() {
  const config = useApiData('/email/config');
  const health = useApiData('/email/health');
  const log = useApiData('/email/log?limit=150');
  const filters = useApiData('/hr/filters');

  const [tab, setTab] = useState('provider');

  // Provider form
  const [provType, setProvType] = useState('brevo');
  const [senderName, setSenderName] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [brevoKey, setBrevoKey] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [provBusy, setProvBusy] = useState(false);
  const [provMsg, setProvMsg] = useState(null); // { ok, text }

  // Test email
  const [testTo, setTestTo] = useState('');
  const [testBusy, setTestBusy] = useState(false);
  const [testMsg, setTestMsg] = useState(null);

  // Templates
  const [tpl, setTpl] = useState({});
  const [tplBusy, setTplBusy] = useState(false);
  const [tplMsg, setTplMsg] = useState(null);

  // Source / import
  const [srcBusy, setSrcBusy] = useState(false);
  const [srcMsg, setSrcMsg] = useState(null);
  const [importSummary, setImportSummary] = useState(null);
  const fileRef = useRef(null);

  // Single email
  const [singleQuery, setSingleQuery] = useState('');
  const [singleResults, setSingleResults] = useState([]);
  const [singleOpen, setSingleOpen] = useState(false);
  const [singleResolved, setSingleResolved] = useState(null);
  const [singlePaycode, setSinglePaycode] = useState('');
  const [singleType, setSingleType] = useState('Birthday');
  const [singleSubject, setSingleSubject] = useState('');
  const [singleBody, setSingleBody] = useState('');
  const [singleResend, setSingleResend] = useState(false);
  const [singleBusy, setSingleBusy] = useState(false);
  const [singleMsg, setSingleMsg] = useState(null);
  const searchTimer = useRef(null);

  // Bulk
  const [bulkType, setBulkType] = useState('Birthday');
  const [bulkDate, setBulkDate] = useState(isoToday());
  const [bulkCompany, setBulkCompany] = useState('');
  const [bulkDept, setBulkDept] = useState('');
  const [bulkSubject, setBulkSubject] = useState('');
  const [bulkBody, setBulkBody] = useState('');
  const [bulkResend, setBulkResend] = useState(false);
  const [bulkPreview, setBulkPreview] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState(null);

  const cfg = config.data?.config || {};
  const providerStatus = config.data?.providerStatus || {};
  const logs = Array.isArray(log.data) ? log.data : (log.data?.rows || []);
  const companies = filters.data?.companies || [];
  const departments = filters.data?.departments || [];

  const providerOk = !!providerStatus.configured;
  const senderOk = !!(cfg.senderemail && String(cfg.senderemail).trim());

  function templateFor(type) {
    const map = {
      'Birthday': [cfg.birthdaysubject, cfg.birthdaybody],
      'Work Anniversary': [cfg.workanniversarysubject, cfg.workanniversarybody],
      'Marriage Anniversary': [cfg.marriagesubject, cfg.marriagebody],
      'Custom': [cfg.customsubject, cfg.custombody],
    };
    return map[type] || ['', ''];
  }

  function refresh() {
    config.reload();
    health.reload();
    log.reload();
  }

  // Populate form state from the server's masked view (secrets never come back).
  useEffect(() => {
    if (!config.data) return;
    const c = config.data.config || {};
    const p = config.data.providerStatus || {};
    setTpl({ ...c });
    setSenderName(c.sendername || '');
    setSenderEmail(c.senderemail || '');
    setProvType(p.provider === 'smtp' ? 'smtp' : 'brevo');
    setSmtpHost(p.smtp?.host || '');
    setSmtpPort(String(p.smtp?.port || '587'));
    setSmtpUser(p.smtp?.user || '');
    setSmtpSecure(!!p.smtp?.secure);
    setBrevoKey('');
    setSmtpPass('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.data]);

  async function saveProvider() {
    setProvBusy(true);
    setProvMsg(null);
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
      setProvMsg({ ok: true, text: 'Provider + sender saved ✓ — ab "Send Test" se verify karo.' });
      setBrevoKey('');
      setSmtpPass('');
      config.reload();
      health.reload();
    } catch (e) {
      setProvMsg({ ok: false, text: e?.message || 'Provider save failed' });
    } finally {
      setProvBusy(false);
    }
  }

  async function sendTest() {
    if (!testTo.trim()) {
      setTestMsg({ ok: false, text: 'Pehle test email address daalo.' });
      return;
    }
    setTestBusy(true);
    setTestMsg({ ok: false, text: 'Sending…' });
    try {
      const d = await apiFetch('/email/test', { method: 'POST', body: { to: testTo.trim() } });
      setTestMsg({ ok: true, text: `Test email sent ✓${d.messageId ? ' • Provider ID: ' + d.messageId : ''} — inbox check karo.` });
      log.reload();
    } catch (e) {
      setTestMsg({ ok: false, text: e?.message || 'Test email failed' });
    } finally {
      setTestBusy(false);
    }
  }

  async function exportMissing() {
    setSrcBusy(true);
    setSrcMsg(null);
    try {
      const d = await apiFetch('/email/missing');
      const rows = [['CompanyCode', 'Paycode', 'DepartmentCode', 'EmployeeName', 'Email']];
      (d.rows || []).forEach((x) => rows.push([x.companycode || '', x.paycode || '', x.departmentcode || '', x.employeename || x.empname || '', '']));
      if (rows.length === 1) {
        setSrcMsg({ ok: true, text: 'Sab employees ka email available hai — koi missing row nahi ✓' });
        return;
      }
      downloadCsv('employee-email-missing', rows);
      setSrcMsg({ ok: true, text: `${rows.length - 1} missing employee rows export ho gayi ✓` });
    } catch (e) {
      setSrcMsg({ ok: false, text: e?.message || 'Missing email list failed' });
    } finally {
      setSrcBusy(false);
    }
  }

  function downloadTemplate() {
    downloadCsv('employee-email-import-template', [['CompanyCode', 'Paycode', 'DepartmentCode', 'EmployeeName', 'Email']]);
  }

  async function handleImportFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setSrcBusy(true);
    setSrcMsg(null);
    setImportSummary(null);
    try {
      let grid = [];
      if (/\.csv$/i.test(file.name)) {
        const text = await file.text();
        grid = text.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split(/[,;\t]/));
      } else {
        const XLSX = await import('xlsx');
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
        grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
      }
      if (!grid.length) {
        setSrcMsg({ ok: false, text: 'File khali hai.' });
        return;
      }
      const head = grid[0].map((h) => String(h || '').trim().toLowerCase());
      const idx = {
        company: head.indexOf('companycode'),
        pay: head.indexOf('paycode'),
        dept: head.indexOf('departmentcode'),
        name: head.indexOf('employeename'),
        email: head.indexOf('email'),
      };
      if (idx.pay === -1 || idx.email === -1) {
        setSrcMsg({ ok: false, text: 'Paycode aur Email columns required hain.' });
        return;
      }
      const rows = [];
      for (let i = 1; i < grid.length; i++) {
        const r = grid[i];
        if (!r || (!String(r[idx.pay] || '').trim() && !String(r[idx.email] || '').trim())) continue;
        rows.push({
          companycode: idx.company > -1 ? String(r[idx.company] || '').trim() : '',
          paycode: String(r[idx.pay] || '').trim(),
          departmentcode: idx.dept > -1 ? String(r[idx.dept] || '').trim() : '',
          employeename: idx.name > -1 ? String(r[idx.name] || '').trim() : '',
          email: String(r[idx.email] || '').trim(),
        });
      }
      if (!rows.length) {
        setSrcMsg({ ok: false, text: 'Koi data row nahi mili.' });
        return;
      }
      const d = await apiFetch('/email/import', { method: 'POST', body: { rows } });
      setImportSummary({ total: d.total ?? rows.length, inserted: d.inserted || 0, updated: d.updated || 0, invalid: d.invalid || 0, notFound: d.notFound || 0 });
      setSrcMsg({ ok: true, text: `Import done — Total: ${d.total ?? rows.length} • New: ${d.inserted || 0} • Updated: ${d.updated || 0} • Invalid: ${d.invalid || 0}${d.notFound ? ' • Paycode not in SQL: ' + d.notFound : ''}` });
      config.reload();
    } catch (err) {
      setSrcMsg({ ok: false, text: err?.message || 'File read failed' });
    } finally {
      setSrcBusy(false);
    }
  }

  async function searchSingle(q) {
    const query = (q ?? singleQuery).trim();
    if (!query) {
      setSingleResults([]);
      setSingleOpen(false);
      return;
    }
    try {
      const d = await apiFetch('/employees?search=' + encodeURIComponent(query) + '&pageSize=12');
      setSingleResults(d.rows || []);
      setSingleOpen(true);
    } catch (e) {
      setSingleMsg({ ok: false, text: e?.message || 'Employee search failed' });
    }
  }

  function onSingleInput(q) {
    setSingleQuery(q);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => searchSingle(q), 300);
  }

  async function selectSingle(paycode) {
    setSingleOpen(false);
    setSingleMsg(null);
    setSingleResolved(null);
    try {
      const d = await apiFetch('/email/resolve?paycode=' + encodeURIComponent(paycode));
      setSingleResolved(d);
      setSinglePaycode(d.employee?.paycode || paycode);
      const [subj, body] = templateFor(singleType);
      setSingleSubject(subj || '');
      setSingleBody(body || '');
    } catch (e) {
      setSingleMsg({ ok: false, text: e?.message || 'Employee resolve failed' });
    }
  }

  function changeSingleType(t) {
    setSingleType(t);
    const [subj, body] = templateFor(t);
    setSingleSubject(subj || '');
    setSingleBody(body || '');
  }

  async function sendSingle() {
    if (!singlePaycode) {
      setSingleMsg({ ok: false, text: 'Pehle employee select karo.' });
      return;
    }
    setSingleBusy(true);
    setSingleMsg(null);
    try {
      const d = await apiFetch('/email/send-single', {
        method: 'POST',
        body: { paycode: singlePaycode, eventType: singleType, subject: singleSubject.trim(), body: singleBody, resend: singleResend },
      });
      setSingleMsg({ ok: true, text: `Sent ✓ → ${d.email} (${d.emailSource})${d.messageId ? ' • ID: ' + d.messageId : ''}` });
      log.reload();
    } catch (e) {
      setSingleMsg({ ok: false, text: e?.message || 'Send failed' });
    } finally {
      setSingleBusy(false);
    }
  }

  function changeBulkType(t) {
    setBulkType(t);
    const [subj, body] = templateFor(t);
    setBulkSubject(subj || '');
    setBulkBody(body || '');
    setBulkPreview(null);
    setBulkMsg(null);
  }

  async function previewBulk() {
    setBulkBusy(true);
    setBulkMsg(null);
    try {
      const q = new URLSearchParams({ eventType: bulkType, date: bulkDate, subject: bulkSubject.trim(), body: bulkBody });
      if (bulkCompany) q.set('companycode', bulkCompany);
      if (bulkDept) q.set('departmentcode', bulkDept);
      const d = await apiFetch('/email/preview?' + q.toString());
      setBulkPreview(d);
    } catch (e) {
      setBulkMsg({ ok: false, text: e?.message || 'Preview failed' });
    } finally {
      setBulkBusy(false);
    }
  }

  async function sendBulk() {
    const d = bulkPreview;
    if (!d) {
      setBulkMsg({ ok: false, text: 'Pehle "Preview Recipients" chalao — bina preview send nahi hota.' });
      return;
    }
    if (!d.providerReady) {
      setBulkMsg({ ok: false, text: 'Email provider is not configured.' });
      return;
    }
    const scope = 'Company: ' + (bulkCompany || 'ALL') + ' • Department: ' + (bulkDept || 'ALL');
    if (!window.confirm(`Send ${bulkType} emails?\n${scope}\nDate: ${bulkDate}\nWill send: ${d.willSend} (already-sent skip)\n\nConfirm?`)) return;
    setBulkBusy(true);
    setBulkMsg(null);
    try {
      const data = await apiFetch('/email/send', {
        method: 'POST',
        body: { eventType: bulkType, companycode: bulkCompany, departmentcode: bulkDept, date: bulkDate, subject: bulkSubject.trim(), body: bulkBody, resend: bulkResend },
      });
      if (data.skippedReason) {
        setBulkMsg({ ok: false, text: data.skippedReason });
        return;
      }
      setBulkMsg({ ok: true, text: `Sent: ${data.sent || 0} • Already sent (skipped): ${data.alreadySent || 0} • No email: ${data.noEmail || 0} • Failed: ${data.failed || 0}` });
      setBulkPreview(null);
      log.reload();
    } catch (e) {
      setBulkMsg({ ok: false, text: e?.message || 'Send failed' });
    } finally {
      setBulkBusy(false);
    }
  }

  async function saveTemplates() {
    setTplBusy(true);
    setTplMsg(null);
    try {
      await apiFetch('/email/config', {
        method: 'POST',
        body: {
          birthdaysubject: tpl.birthdaysubject || '',
          birthdaybody: tpl.birthdaybody || '',
          workanniversarysubject: tpl.workanniversarysubject || '',
          workanniversarybody: tpl.workanniversarybody || '',
          marriagesubject: tpl.marriagesubject || '',
          marriagebody: tpl.marriagebody || '',
          customsubject: tpl.customsubject || '',
          custombody: tpl.custombody || '',
          birthdayenabled: !!tpl.birthdayenabled,
          workanniversaryenabled: !!tpl.workanniversaryenabled,
          marriageenabled: !!tpl.marriageenabled,
        },
      });
      setTplMsg({ ok: true, text: 'Templates saved ✓' });
      config.reload();
    } catch (e) {
      setTplMsg({ ok: false, text: e?.message || 'Save failed' });
    } finally {
      setTplBusy(false);
    }
  }

  return (
    <div className="glass-card rounded-3xl p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-5 pb-4 border-b border-[var(--border)]">
        <div>
          <h2 className="text-base font-bold text-[var(--text)] flex items-center gap-2"><i className="fas fa-envelope text-violet-400"></i> Email Control Center</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">Brevo-powered employee greetings &amp; custom emails — HR Admin only, secrets stay server-side</p>
        </div>
        <button type="button" onClick={refresh} className="px-3.5 py-2 rounded-xl bg-white/5 border border-[var(--border)] hover:bg-white/10 text-xs font-bold text-[var(--text)] transition">
          <i className="fas fa-rotate mr-1.5"></i>Refresh
        </button>
      </div>

      {config.loading ? (
        <LoadingState label="Email configuration load ho rahi hai..." />
      ) : config.error ? (
        <ErrorState message={config.error} onRetry={config.reload} />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <StatusCard label="Email Service" value={providerOk && senderOk ? 'Running ✓' : providerOk ? 'Sender email missing' : 'Action required'} tone={providerOk && senderOk ? 'green' : 'rose'} />
            <StatusCard label="Provider" value={providerOk ? (providerStatus.providerLabel || 'Configured ✓') : 'Not configured'} tone={providerOk ? 'green' : 'rose'} />
            <StatusCard label="Sender Email" value={senderOk ? cfg.senderemail : 'Not set'} tone={senderOk ? 'green' : 'rose'} />
            <StatusCard label="Priority 1 — SQL e_mail1" value={`${config.data?.masterEmailCount ?? 0} employees`} tone={config.data?.masterEmailCount ? 'green' : 'amber'} />
            <StatusCard label="Priority 2 — HR Mapping" value={`${config.data?.mappingCount ?? 0} mappings`} tone={config.data?.mappingCount ? 'green' : 'sky'} />
            <StatusCard label="No Email Found" value={config.data?.noEmailCount ? `${config.data.noEmailCount} — import needed` : 'None ✓'} tone={config.data?.noEmailCount ? 'rose' : 'green'} />
          </div>

          {health.data?.checks ? (
            (() => {
              const pending = health.data.checks.filter((c) => !c.ok);
              if (!pending.length) {
                return (
                  <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-200 font-semibold mb-5">
                    <i className="fas fa-circle-check mr-1.5"></i>Email service fully configured — provider ready, sender email set, {health.data.recipientCount ?? 0} employees ka email resolvable.
                  </div>
                );
              }
              return (
                <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 mb-5">
                  <p className="text-[11px] font-bold text-amber-200 mb-2"><i className="fas fa-triangle-exclamation mr-1.5"></i>Email service ko {pending.length} cheez chahiye (in order):</p>
                  <div className="space-y-1.5">
                    {pending.map((c) => (
                      <div key={c.key} className="flex items-start gap-2 text-[11px] leading-relaxed">
                        <span className="mt-0.5 text-amber-300"><i className="fas fa-arrow-right"></i></span>
                        <span><strong className="text-[var(--text)]">{c.label}</strong> — <span className="text-amber-100">{c.needs || 'configure karo'}</span> <span className="text-[var(--muted)]">(current: {c.value || '—'})</span></span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-[var(--muted)] mt-2.5">Fix karne ke baad upar wale cards apne aap green ho jayenge — server restart ki zarurat nahi.</p>
                </div>
              );
            })()
          ) : null}

          <div className="flex flex-wrap gap-2 mb-5">
            {TABS.map((t) => (
              <button key={t.id} type="button" onClick={() => setTab(t.id)} className={`tabbtn px-3.5 py-2 rounded-xl text-[11px] font-bold ${tab === t.id ? 'active' : ''}`}>
                <i className={`fas ${t.icon} mr-1.5 ${t.color}`}></i>{t.label}
              </button>
            ))}
          </div>

          {tab === 'provider' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
                <p className="text-xs font-bold text-[var(--text)] mb-3"><i className="fas fa-sliders text-violet-400 mr-1.5"></i>Provider &amp; Sender</p>
                <div className="space-y-2.5">
                  <div>
                    <label className={labelCls}>Email Provider</label>
                    <select value={provType} onChange={(e) => setProvType(e.target.value)} className={inputCls}>
                      <option value="brevo">Brevo — HTTPS API (api.brevo.com)</option>
                      <option value="smtp">SMTP — custom mail server (Gmail / Outlook 365)</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div><label className={labelCls}>Sender Name</label><input value={senderName} onChange={(e) => setSenderName(e.target.value)} className={inputCls} placeholder="HR Team" /></div>
                    <div><label className={labelCls}>Sender Email</label><input value={senderEmail} onChange={(e) => setSenderEmail(e.target.value)} className={inputCls} placeholder="hr@company.com" /></div>
                  </div>
                  {provType === 'brevo' ? (
                    <div>
                      <label className={labelCls}>Brevo API Key</label>
                      <input type="password" autoComplete="off" value={brevoKey} onChange={(e) => setBrevoKey(e.target.value)} className={inputCls} placeholder="xkeysib-..." />
                      <p className="text-[10px] text-[var(--muted)] mt-1 leading-relaxed">Blank chhod do = saved key waise hi rahegi. Key server par encrypted save hoti hai aur browser ko kabhi wapas nahi bheji jaati.</p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      <div className="grid grid-cols-3 gap-2.5">
                        <div className="col-span-2"><label className={labelCls}>SMTP Host</label><input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} className={inputCls} placeholder="smtp.gmail.com" /></div>
                        <div><label className={labelCls}>Port</label><input value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} className={inputCls} placeholder="587" /></div>
                      </div>
                      <div className="grid grid-cols-2 gap-2.5">
                        <div><label className={labelCls}>SMTP User</label><input autoComplete="off" value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} className={inputCls} placeholder="hr@company.com" /></div>
                        <div><label className={labelCls}>SMTP Password</label><input type="password" autoComplete="off" value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)} className={inputCls} placeholder="app password" /></div>
                      </div>
                      <label className="flex items-center gap-2 text-[10px] text-[var(--text)] font-semibold"><input type="checkbox" checked={smtpSecure} onChange={(e) => setSmtpSecure(e.target.checked)} className="accent-violet-500" />Use SSL/TLS (port 465 — warna 587 STARTTLS)</label>
                    </div>
                  )}
                  <div className="rounded-xl bg-slate-900/40 border border-white/5 px-3 py-2 text-[10px] text-[var(--muted)] leading-relaxed">
                    {providerOk ? (
                      <span><i className="fas fa-circle-check text-emerald-400 mr-1"></i><span className="text-emerald-300 font-bold">Running ✓</span> — {providerStatus.providerLabel}{providerStatus.source === 'env' ? ' (server .env)' : providerStatus.source === 'database' ? ' (database encrypted)' : ''}</span>
                    ) : (
                      <span><i className="fas fa-circle-info text-slate-400 mr-1"></i>{providerStatus.hint || 'Email provider configure nahi hai. Brevo API key ya SMTP credentials save karo.'}</span>
                    )}
                  </div>
                  <button type="button" onClick={saveProvider} disabled={provBusy} className="w-full py-2.5 rounded-xl bg-violet-500/15 border border-violet-500/30 text-violet-300 hover:bg-violet-500/25 text-xs font-bold transition disabled:opacity-50">
                    {provBusy ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-save mr-1"></i>}Save Provider &amp; Sender
                  </button>
                  {provMsg ? <Notice ok={provMsg.ok}>{provMsg.text}</Notice> : null}
                </div>
              </div>
              <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
                <p className="text-xs font-bold text-[var(--text)] mb-3"><i className="fas fa-paper-plane text-emerald-400 mr-1.5"></i>Test Email <span className="text-[10px] font-normal text-[var(--muted)]">(employee data use nahi hota)</span></p>
                <div className="flex gap-2">
                  <input value={testTo} onChange={(e) => setTestTo(e.target.value)} className={inputCls} placeholder="your@email.com" />
                  <button type="button" onClick={sendTest} disabled={testBusy} className="px-4 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 text-xs font-bold transition whitespace-nowrap disabled:opacity-50">Send Test</button>
                </div>
                {testMsg ? <div className="mt-2.5"><Notice ok={testMsg.ok}>{testMsg.text}</Notice></div> : null}
              </div>
            </div>
          )}

          {tab === 'source' && (
            <div className="space-y-5">
              <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
                <p className="text-xs font-bold text-[var(--text)] mb-3"><i className="fas fa-database text-amber-400 mr-1.5"></i>Employee Email Source — Resolution Priority</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <StatusCard label="Priority 1 — SQL e_mail1 (Savior)" value={`${config.data?.masterEmailCount ?? 0} employees`} tone={config.data?.masterEmailCount ? 'green' : 'amber'} />
                  <StatusCard label="Priority 2 — HR Mapping (Import)" value={`${config.data?.mappingCount ?? 0} mappings`} tone={config.data?.mappingCount ? 'green' : 'sky'} />
                  <StatusCard label="No Email Found" value={config.data?.noEmailCount ? `${config.data.noEmailCount} — export karke import karo` : 'None ✓'} tone={config.data?.noEmailCount ? 'rose' : 'green'} />
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  <button type="button" onClick={exportMissing} disabled={srcBusy} className="px-4 py-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 text-xs font-bold transition disabled:opacity-50">
                    <i className="fas fa-file-csv mr-1.5"></i>Export Missing Emails (CSV)
                  </button>
                  <span className="text-[10px] text-[var(--muted)] self-center">Jin employees ka email nahi mila sirf wahi rows export hongi — Excel me bhar kar import kar do.</span>
                </div>
                <p className="text-[10px] text-[var(--muted)] mt-3 leading-relaxed">1️⃣ Savior SQL <strong className="text-[var(--text)]">e_mail1</strong> (dbo.tblemployee — read-only) &nbsp;→&nbsp; 2️⃣ <strong className="text-[var(--text)]">HR_EmployeeEmails</strong> mapping (Excel import fallback). Savior table me koi column add nahi hota.</p>
              </div>
              <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
                <p className="text-xs font-bold text-[var(--text)] mb-3"><i className="fas fa-file-excel text-teal-400 mr-1.5"></i>Employee Email Import (Excel)</p>
                <p className="text-[10px] text-[var(--muted)] mb-2.5 leading-relaxed">Headers: <strong className="text-[var(--text)]">CompanyCode, Paycode, DepartmentCode, EmployeeName, Email</strong> — matching <strong className="text-[var(--text)]">sirf Paycode</strong> se. Same Paycode dobara aaye to mapping <strong className="text-[var(--text)]">update</strong> hoti hai. Invalid email rows skip.</p>
                <div className="flex gap-2">
                  <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImportFile} />
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={srcBusy} className="flex-1 py-2.5 rounded-xl bg-teal-500/15 border border-teal-500/30 text-teal-300 hover:bg-teal-500/25 text-xs font-bold transition disabled:opacity-50">
                    <i className="fas fa-upload mr-1.5"></i>{srcBusy ? 'Importing…' : 'Choose Excel'}
                  </button>
                  <button type="button" onClick={downloadTemplate} className="px-4 py-2.5 rounded-xl bg-white/5 border border-[var(--border)] hover:bg-white/10 text-xs font-bold text-[var(--text)] transition">Template</button>
                </div>
                {importSummary ? (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                    <StatusCard label="Total Rows" value={String(importSummary.total)} tone="neutral" />
                    <StatusCard label="Imported (new)" value={String(importSummary.inserted)} tone="green" />
                    <StatusCard label="Updated (same Paycode)" value={String(importSummary.updated)} tone="sky" />
                    <StatusCard label="Invalid / Skipped" value={`${importSummary.invalid}${importSummary.notFound ? ` • ${importSummary.notFound} paycode SQL me nahi` : ''}`} tone="rose" />
                  </div>
                ) : null}
                {srcMsg ? <div className="mt-3"><Notice ok={srcMsg.ok}>{srcMsg.text}</Notice></div> : null}
              </div>
            </div>
          )}

          {tab === 'single' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-white/5 border border-white/5 relative">
                  <p className="text-xs font-bold text-[var(--text)] mb-3"><i className="fas fa-magnifying-glass text-amber-400 mr-1.5"></i>Find Employee <span className="text-[10px] font-normal text-[var(--muted)]">— Paycode ya Name (real SQL search)</span></p>
                  <input value={singleQuery} onChange={(e) => onSingleInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') searchSingle(singleQuery); }} className={inputCls} placeholder="Paycode / Employee Name…" />
                  {singleOpen && (
                    <div className="absolute left-0 right-0 top-full mt-1 z-20 glass rounded-2xl p-1.5 max-h-60 overflow-y-auto border border-white/10">
                      {singleResults.length ? (
                        singleResults.map((e) => (
                          <button key={e.paycode} type="button" onClick={() => selectSingle(e.paycode)} className="w-full text-left px-3 py-2 rounded-xl hover:bg-white/10 flex items-center justify-between gap-3">
                            <span className="text-xs font-bold text-[var(--text)] truncate">{e.empname}</span>
                            <span className="text-[10px] mono text-indigo-300 whitespace-nowrap">{e.paycode} • {e.companycode || '—'}/{e.departmentcode || '—'}</span>
                          </button>
                        ))
                      ) : (
                        <p className="px-3 py-2 text-xs text-[var(--muted)]">Koi employee nahi mila (real Savior SQL search).</p>
                      )}
                    </div>
                  )}
                </div>
                {singleResolved ? (
                  <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
                    <div className="flex items-center justify-between gap-2 mb-2.5">
                      <p className="text-xs font-bold text-[var(--text)]">{singleResolved.employee?.empname || singleResolved.employee?.paycode}</p>
                      <span className={`text-[9px] uppercase font-bold px-2 py-1 rounded-lg border ${singleResolved.emailSource === 'SQL (e_mail1)' ? 'text-amber-300 bg-amber-500/10 border-amber-500/20' : singleResolved.emailSource?.indexOf('HR Mapping') === 0 ? 'text-sky-300 bg-sky-500/10 border-sky-500/20' : 'text-rose-300 bg-rose-500/10 border-rose-500/20'}`}>Source: {singleResolved.emailSource || '—'}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                      <p className="text-[var(--muted)]">Paycode: <span className="mono text-indigo-300">{singleResolved.employee?.paycode}</span></p>
                      <p className="text-[var(--muted)]">Company: <span className="text-[var(--text)]">{singleResolved.employee?.companycode || '—'}</span></p>
                      <p className="text-[var(--muted)]">Department: <span className="text-[var(--text)]">{singleResolved.employee?.departmentcode || '—'}</span></p>
                      <p className="text-[var(--muted)]">Designation: <span className="text-[var(--text)]">{singleResolved.employee?.designation || '—'}</span></p>
                      <p className="col-span-2 text-[var(--muted)]">Email: <span className={`mono ${singleResolved.hasEmail ? 'text-emerald-300' : 'text-rose-300'}`}>{singleResolved.email || '— none —'}</span></p>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
                <p className="text-xs font-bold text-[var(--text)] mb-3"><i className="fas fa-user-pen text-amber-400 mr-1.5"></i>Compose &amp; Send</p>
                <div className="space-y-2.5">
                  <div>
                    <label className={labelCls}>Mail Type</label>
                    <select value={singleType} onChange={(e) => changeSingleType(e.target.value)} className={inputCls}>
                      {EVENT_TYPES.map((t) => <option key={t} value={t}>{t === 'Custom' ? 'Custom Email' : t}</option>)}
                    </select>
                  </div>
                  <div><label className={labelCls}>Subject (editable)</label><input value={singleSubject} onChange={(e) => setSingleSubject(e.target.value)} className={inputCls} /></div>
                  <div><label className={labelCls}>Message Body (editable)</label><textarea rows={6} value={singleBody} onChange={(e) => setSingleBody(e.target.value)} className={inputCls} /></div>
                  <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={singleResend} onChange={(e) => setSingleResend(e.target.checked)} className="accent-amber-500" /><span className="text-[10px] font-bold text-amber-300">Resend (ignore duplicate protection)</span></label>
                  <button type="button" onClick={sendSingle} disabled={singleBusy} className="w-full py-2.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 text-xs font-bold transition disabled:opacity-50">
                    {singleBusy ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-paper-plane mr-1"></i>}Send Email
                  </button>
                  {singleMsg ? <Notice ok={singleMsg.ok}>{singleMsg.text}</Notice> : null}
                </div>
              </div>
            </div>
          )}

          {tab === 'bulk' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5">
                <div>
                  <label className={labelCls}>Mail Type</label>
                  <select value={bulkType} onChange={(e) => changeBulkType(e.target.value)} className={inputCls}>
                    {EVENT_TYPES.map((t) => <option key={t} value={t}>{t === 'Custom' ? 'Custom Email' : t}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Company Code</label>
                  <select value={bulkCompany} onChange={(e) => setBulkCompany(e.target.value)} className={inputCls}>
                    <option value="">All Companies</option>
                    {companies.map((c) => <option key={c.code} value={c.code}>{c.code}{c.name ? ' — ' + c.name : ''}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Department</label>
                  <select value={bulkDept} onChange={(e) => setBulkDept(e.target.value)} className={inputCls}>
                    <option value="">All Departments</option>
                    {departments.map((d) => <option key={d.code} value={d.code}>{d.code}{d.name ? ' — ' + d.name : ''}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Date <span className="normal-case font-normal">(day+month match; n/a for Custom)</span></label>
                  <input type="date" value={bulkDate} disabled={bulkType === 'Custom'} onChange={(e) => setBulkDate(e.target.value)} className={inputCls} />
                </div>
              </div>
              <div className="space-y-2.5">
                <div><label className={labelCls}>Subject <span className="normal-case font-normal">(pre-filled from template — editable)</span></label><input value={bulkSubject} onChange={(e) => setBulkSubject(e.target.value)} className={inputCls} /></div>
                <div><label className={labelCls}>Message Body <span className="normal-case font-normal">— placeholders: {'{{EmployeeName}} {{Paycode}} {{Department}} {{CompanyCode}} {{Designation}}'}</span></label><textarea rows={5} value={bulkBody} onChange={(e) => setBulkBody(e.target.value)} className={inputCls} /></div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={previewBulk} disabled={bulkBusy} className="flex-1 py-2.5 rounded-xl bg-sky-500/15 border border-sky-500/30 text-sky-300 hover:bg-sky-500/25 text-xs font-bold transition disabled:opacity-50">
                  <i className="fas fa-eye mr-1.5"></i>Preview Recipients
                </button>
                <button type="button" onClick={sendBulk} disabled={bulkBusy || !bulkPreview?.willSend} className="flex-1 py-2.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 text-xs font-bold transition disabled:opacity-40 disabled:cursor-not-allowed">
                  <i className="fas fa-paper-plane mr-1.5"></i>Send Bulk Email
                </button>
              </div>
              <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={bulkResend} onChange={(e) => setBulkResend(e.target.checked)} className="accent-amber-500" /><span className="text-[10px] font-bold text-amber-300">Resend (already-sent employees ko bhi dubara bhejo)</span></label>
              {bulkPreview ? (
                <div className="text-[11px] text-[var(--text)]">
                  <span className="font-bold">Total Recipients: {bulkPreview.total}</span> • Valid emails: {bulkPreview.validEmails} • Missing: {bulkPreview.missingEmails} • Already sent: {bulkPreview.alreadySent} • Will send: <span className="text-amber-300 font-bold">{bulkPreview.willSend}</span> • {bulkPreview.providerReady ? <span className="text-emerald-300 font-bold">Provider ready ✓</span> : <span className="text-rose-300 font-bold">Email provider is not configured</span>}
                </div>
              ) : null}
              {bulkMsg ? <Notice ok={bulkMsg.ok}>{bulkMsg.text}</Notice> : null}
              {bulkPreview && bulkPreview.rows ? (
                <div className="overflow-x-auto rounded-2xl border border-white/5">
                  <table className="portal-table">
                    <thead><tr><th>Employee Name</th><th>Paycode</th><th>Company Code</th><th>Department</th><th>Email</th><th>Mail Type</th><th>Email Source</th><th>Already Sent</th></tr></thead>
                    <tbody>
                      {bulkPreview.rows.map((x, i) => (
                        <tr key={x.paycode + '-' + i}>
                          <td className="font-semibold">{x.employeename || '—'}</td>
                          <td className="mono text-indigo-300">{x.paycode}</td>
                          <td>{x.companycode || '—'}</td>
                          <td>{x.departmentcode || '—'}</td>
                          <td className="mono">{x.email || '—'}</td>
                          <td className="text-violet-300">{x.mailType || bulkType}</td>
                          <td className={`text-[10px] ${x.emailSource === 'Missing' ? 'text-rose-300' : 'text-[var(--muted)]'}`}>{x.emailSource || '—'}</td>
                          <td>{x.alreadySent ? <span className="text-amber-300 font-bold">Yes</span> : <span className="text-[var(--muted)]">No</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              <p className="text-[10px] text-[var(--muted)]"><i className="fas fa-circle-info mr-1"></i>Preview me koi email send NAHI hota. Send sirf "Send Bulk Email" ke explicit confirm par hota hai.</p>
            </div>
          )}

          {tab === 'templates' && (
            <div className="space-y-4">
              <p className="text-[10px] text-[var(--muted)]">Placeholders: <strong className="text-[var(--text)]">{'{{EmployeeName}} {{Paycode}} {{Department}} {{CompanyCode}} {{Designation}}'}</strong> — har send par real employee data se replace hote hain.</p>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-2">
                  <p className="text-xs font-bold text-emerald-300"><i className="fas fa-cake-candles mr-1.5"></i>Birthday Template</p>
                  <input value={tpl.birthdaysubject || ''} onChange={(e) => setTpl({ ...tpl, birthdaysubject: e.target.value })} className={inputCls} placeholder="Subject" />
                  <textarea rows={5} value={tpl.birthdaybody || ''} onChange={(e) => setTpl({ ...tpl, birthdaybody: e.target.value })} className={inputCls} placeholder="Body" />
                  <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={!!tpl.birthdayenabled} onChange={(e) => setTpl({ ...tpl, birthdayenabled: e.target.checked })} className="accent-emerald-500" /><span className="text-[10px] font-bold text-emerald-300">Auto-send ON (daily scheduler)</span></label>
                </div>
                <div className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-2">
                  <p className="text-xs font-bold text-sky-300"><i className="fas fa-briefcase mr-1.5"></i>Work Anniversary Template</p>
                  <input value={tpl.workanniversarysubject || ''} onChange={(e) => setTpl({ ...tpl, workanniversarysubject: e.target.value })} className={inputCls} placeholder="Subject" />
                  <textarea rows={5} value={tpl.workanniversarybody || ''} onChange={(e) => setTpl({ ...tpl, workanniversarybody: e.target.value })} className={inputCls} placeholder="Body" />
                  <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={!!tpl.workanniversaryenabled} onChange={(e) => setTpl({ ...tpl, workanniversaryenabled: e.target.checked })} className="accent-sky-500" /><span className="text-[10px] font-bold text-sky-300">Auto-send ON (daily scheduler)</span></label>
                </div>
                <div className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-2">
                  <p className="text-xs font-bold text-pink-300"><i className="fas fa-heart mr-1.5"></i>Marriage Anniversary Template</p>
                  <input value={tpl.marriagesubject || ''} onChange={(e) => setTpl({ ...tpl, marriagesubject: e.target.value })} className={inputCls} placeholder="Subject" />
                  <textarea rows={5} value={tpl.marriagebody || ''} onChange={(e) => setTpl({ ...tpl, marriagebody: e.target.value })} className={inputCls} placeholder="Body" />
                  <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={!!tpl.marriageenabled} onChange={(e) => setTpl({ ...tpl, marriageenabled: e.target.checked })} className="accent-pink-500" /><span className="text-[10px] font-bold text-pink-300">Auto-send ON (daily scheduler)</span></label>
                </div>
                <div className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-2">
                  <p className="text-xs font-bold text-violet-300"><i className="fas fa-envelope-open-text mr-1.5"></i>Custom Message Template</p>
                  <input value={tpl.customsubject || ''} onChange={(e) => setTpl({ ...tpl, customsubject: e.target.value })} className={inputCls} placeholder="Subject" />
                  <textarea rows={5} value={tpl.custombody || ''} onChange={(e) => setTpl({ ...tpl, custombody: e.target.value })} className={inputCls} placeholder="Body" />
                  <p className="text-[10px] text-[var(--muted)]">Custom emails sirf manual (Single / Bulk tab) se jaate hain — scheduler me nahi.</p>
                </div>
              </div>
              <button type="button" onClick={saveTemplates} disabled={tplBusy} className="w-full py-2.5 rounded-xl bg-violet-500/15 border border-violet-500/30 text-violet-300 hover:bg-violet-500/25 text-xs font-bold transition disabled:opacity-50">
                {tplBusy ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-save mr-1"></i>}Save All Templates
              </button>
              {tplMsg ? <Notice ok={tplMsg.ok}>{tplMsg.text}</Notice> : null}
            </div>
          )}

          {tab === 'logs' && (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <p className="text-xs font-bold text-[var(--text)]"><i className="fas fa-clock-rotate-left text-slate-300 mr-1.5"></i>Email Log <span className="chip">{logs.length}</span> <span className="text-[10px] font-normal text-[var(--muted)]">— har attempt record hota hai (duplicate protection isi table se chalti hai)</span></p>
                <button type="button" onClick={log.reload} className="px-3 py-1.5 rounded-xl bg-white/5 border border-[var(--border)] hover:bg-white/10 text-[11px] font-bold text-[var(--text)] transition">Refresh Log</button>
              </div>
              {log.loading ? (
                <LoadingState label="Email log load ho raha hai..." />
              ) : log.error ? (
                <ErrorState message={log.error} onRetry={log.reload} />
              ) : logs.length ? (
                <div className="overflow-x-auto">
                  <table className="portal-table">
                    <thead><tr><th>Date</th><th>Employee</th><th>Paycode</th><th>Company</th><th>Department</th><th>Event</th><th>Email</th><th>Status</th><th>Sent Time</th><th>Error</th></tr></thead>
                    <tbody>
                      {logs.map((l, i) => (
                        <tr key={l.id ?? i}>
                          <td>{l.eventdate || '—'}</td>
                          <td className="font-semibold">{l.employeename || '—'}</td>
                          <td className="mono text-indigo-300">{l.paycode || '—'}</td>
                          <td>{l.companycode || '—'}</td>
                          <td>{l.departmentcode || '—'}</td>
                          <td>{l.eventtype || '—'}</td>
                          <td className="mono">{l.recipientemail || '—'}</td>
                          <td>{statusBadge(l.status)}</td>
                          <td className="mono text-[10px]">{l.sentat || '—'}</td>
                          <td className="text-rose-300/80 text-[10px] max-w-[180px] truncate" title={l.errormessage || ''}>{l.errormessage || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-[var(--muted)] py-6 text-center">Koi email log nahi — abhi tak koi greeting send nahi hui.</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
