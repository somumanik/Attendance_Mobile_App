'use client';

// web-next/components/hr/WhatsAppSection.jsx — WhatsApp Attendance Messaging (V1).
// HR-only. FREE_MANUAL preview/export + gated Cloud API sending (real send stays OFF
// unless Cloud API is configured, enabled, dry-run=false and HR-approved).

import { useEffect, useState } from 'react';
import useApiData from '../useApiData';
import apiFetch from '../../lib/api';
import { HrCan } from './HrAccess';
import { isoToday } from '../../lib/format';
import LoadingState from '../LoadingState';
import ErrorState from '../ErrorState';

const TABS = [
  { id: 'provider', label: 'Provider Config', icon: 'fa-sliders', color: 'text-violet-400' },
  { id: 'eligibility', label: 'Eligibility & Consent', icon: 'fa-user-check', color: 'text-teal-400' },
  { id: 'template', label: 'Template & Schedule', icon: 'fa-envelope-open-text', color: 'text-amber-400' },
  { id: 'preview', label: 'Preview / Export', icon: 'fa-file-csv', color: 'text-sky-400' },
  { id: 'logs', label: 'Logs', icon: 'fa-clock-rotate-left', color: 'text-slate-300' },
];

const inputCls = 'w-full mt-1 px-3 py-2 rounded-xl bg-[var(--input-bg)] border border-[var(--border)] text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]';
const labelCls = 'text-[10px] uppercase font-bold text-[var(--muted)]';

function Notice({ ok, children }) {
  return <div className={`rounded-xl px-3 py-2 text-[11px] font-semibold leading-relaxed ${ok ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-200' : 'bg-rose-500/10 border border-rose-500/20 text-rose-200'}`}>{children}</div>;
}

function statusBadge(status) {
  if (status === 'Sent' || status === 'Delivered' || status === 'Read') return <span className="badge badge--present">{status}</span>;
  if (status === 'Failed') return <span className="badge badge--absent">Failed</span>;
  if (status === 'DryRun') return <span className="badge badge--neutral">Dry Run</span>;
  return <span className="badge badge--neutral">{status || '—'}</span>;
}

export default function WhatsAppSection() {
  const config = useApiData('/whatsapp/config');
  const health = useApiData('/whatsapp/health');

  const [tab, setTab] = useState('provider');
  const [prov, setProv] = useState({ accessToken: '', appSecret: '', phoneNumberId: '', businessAccountId: '', apiVersion: 'v21.0', webhookVerifyToken: '' });
  const [provBusy, setProvBusy] = useState(false);
  const [provMsg, setProvMsg] = useState(null);

  const [cfg, setCfg] = useState({ enabled: false, mode: 'FREE_MANUAL', sendtime: '21:00', timezone: 'Asia/Kolkata', eligiblecategory: '', dryrun: true, templatename: '', templatelanguage: 'en', templatebody: '', approved: false });
  const [cfgBusy, setCfgBusy] = useState(false);
  const [cfgMsg, setCfgMsg] = useState(null);

  const [elig, setElig] = useState(null);
  const [consent, setConsent] = useState(null);
  const [consentPaycode, setConsentPaycode] = useState('');
  const [consentAction, setConsentAction] = useState('Granted');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const [previewDate, setPreviewDate] = useState(isoToday());
  const [previewPaycode, setPreviewPaycode] = useState('');
  const [previews, setPreviews] = useState(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendResult, setSendResult] = useState(null);

  const [logDate, setLogDate] = useState('');
  const [logPaycode, setLogPaycode] = useState('');
  const [logStatus, setLogStatus] = useState('');
  const [logRows, setLogRows] = useState(null);

  useEffect(() => {
    if (config.data?.config) {
      const c = config.data.config;
      setCfg({ enabled: !!c.enabled, mode: c.mode || 'FREE_MANUAL', sendtime: c.sendtime || '21:00', timezone: c.timezone || 'Asia/Kolkata', eligiblecategory: c.eligiblecategory || '', dryrun: !!c.dryrun, templatename: c.templatename || '', templatelanguage: c.templatelanguage || 'en', templatebody: c.templatebody || '', approved: !!c.approved });
    }
  }, [config.data]);

  async function saveProvider(e) {
    e.preventDefault();
    setProvBusy(true); setProvMsg(null);
    try {
      const body = { ...prov };
      if (!prov.accessToken) delete body.accessToken;
      if (!prov.appSecret) delete body.appSecret;
      await apiFetch('/whatsapp/provider', { method: 'POST', body });
      setProvMsg({ ok: true, text: 'Provider saved (secrets encrypted at rest).' });
      setProv({ ...prov, accessToken: '', appSecret: '' });
      config.reload(); health.reload();
    } catch (err) { setProvMsg({ ok: false, text: err.message }); }
    finally { setProvBusy(false); }
  }

  async function saveConfig(e) {
    e.preventDefault();
    setCfgBusy(true); setCfgMsg(null);
    try {
      await apiFetch('/whatsapp/config', { method: 'POST', body: cfg });
      setCfgMsg({ ok: true, text: 'Configuration saved.' });
      config.reload(); health.reload();
    } catch (err) { setCfgMsg({ ok: false, text: err.message }); }
    finally { setCfgBusy(false); }
  }

  async function loadEligibility() {
    setBusy(true);
    try { setElig(await apiFetch('/whatsapp/eligibility')); }
    catch (err) { setMsg({ ok: false, text: err.message }); }
    finally { setBusy(false); }
  }
  async function loadConsent() {
    setBusy(true);
    try { setConsent(await apiFetch('/whatsapp/consent')); }
    catch (err) { setMsg({ ok: false, text: err.message }); }
    finally { setBusy(false); }
  }
  async function setConsentFor(paycode, status) {
    setBusy(true); setMsg(null);
    try {
      await apiFetch(`/whatsapp/consent/${encodeURIComponent(paycode)}`, { method: 'POST', body: { status } });
      setMsg({ ok: true, text: `${paycode} → ${status}.` });
      await Promise.all([loadEligibility(), loadConsent()]);
    } catch (err) { setMsg({ ok: false, text: err.message }); }
    finally { setBusy(false); }
  }

  async function generatePreview() {
    setPreviewBusy(true); setPreviews(null);
    try {
      const q = new URLSearchParams({ date: previewDate });
      if (previewPaycode) q.set('paycode', previewPaycode);
      const d = await apiFetch(`/whatsapp/preview?${q.toString()}`);
      setPreviews(d.previews || []);
    } catch (err) { setMsg({ ok: false, text: err.message }); }
    finally { setPreviewBusy(false); }
  }

  async function exportCsv() {
    setPreviewBusy(true);
    try {
      const res = await fetch('/api/whatsapp/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: previewDate, paycode: previewPaycode || undefined }), credentials: 'include' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || `Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `whatsapp-attendance-${previewDate}.csv`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (err) { setMsg({ ok: false, text: err.message }); }
    finally { setPreviewBusy(false); }
  }

  /** Run the server-side send pipeline. dryRun=true NEVER contacts Meta (default);
      dryRun=false attempts a real send but is still gated by canSendReal(). */
  async function runSend(dryRun) {
    if (dryRun === false && !window.confirm('Send real WhatsApp messages to eligible employees? This contacts Meta.')) return;
    setSendBusy(true); setSendResult(null); setMsg(null);
    try {
      const body = { date: previewDate, paycode: previewPaycode || undefined, dryRun: dryRun !== false };
      const res = await apiFetch('/whatsapp/send', { method: 'POST', body });
      setSendResult(res);
      if (res.real) setMsg({ ok: true, text: `Real send dispatched: ${res.sent || 0} sent, ${res.failed || 0} failed, ${res.skipped || 0} skipped.` });
      else setMsg({ ok: true, text: `Dry-run complete: ${res.dryRun || 0} message(s) would be sent (${res.skipped || 0} skipped). No real messages sent.` });
      loadLogs().catch(() => {});
    } catch (err) { setMsg({ ok: false, text: err.message }); }
    finally { setSendBusy(false); }
  }

  async function loadLogs() {
    setBusy(true);
    try {
      const q = new URLSearchParams({ limit: '150' });
      if (logDate) q.set('date', logDate);
      if (logPaycode) q.set('paycode', logPaycode);
      if (logStatus) q.set('status', logStatus);
      const d = await apiFetch(`/whatsapp/log?${q.toString()}`);
      setLogRows(d.rows || []);
    } catch (err) { setMsg({ ok: false, text: err.message }); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (tab === 'eligibility') { loadEligibility(); loadConsent(); }
    if (tab === 'logs') { loadLogs(); }
  }, [tab]);

  if (config.loading || health.loading) return <LoadingState label="WhatsApp module load ho raha hai..." />;
  if (config.error) return <ErrorState message={config.error} onRetry={config.reload} />;

  const providerStatus = config.data?.providerStatus || config.data?.provider || {};
  const healthData = health.data || {};

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-extrabold text-[var(--text)]">WhatsApp Attendance Messaging</h2>
          <p className="text-[11px] text-[var(--muted)] mt-0.5">HR-only. FREE_MANUAL preview/export + gated Cloud API sending.</p>
        </div>
        <div className="text-right">
          <span className={`badge ${healthData.canSendReal ? 'badge--present' : 'badge--neutral'}`}>{healthData.canSendReal ? 'Cloud API: real send ARMED' : 'Real send OFF'}</span>
          <p className="text-[10px] text-[var(--muted)] mt-1 max-w-xs">{healthData.hint || ''}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-3 py-2 rounded-xl text-xs font-bold border transition ${tab === t.id ? 'bg-[var(--accent)]/15 border-[var(--accent)] text-[var(--accent)]' : 'bg-white/5 border-white/5 text-[var(--muted)] hover:text-[var(--text)]'}`}>
            <i className={`fas ${t.icon} mr-1.5 ${t.color}`}></i>{t.label}
          </button>
        ))}
      </div>

      {msg ? <Notice ok={msg.ok}>{msg.text}</Notice> : null}

      {tab === 'provider' && (
        <div className="glass-card rounded-2xl p-5">
          <h3 className="text-sm font-bold text-[var(--text)] mb-3">Cloud API Provider (secrets server-side encrypted)</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <div><span className={labelCls}>Status</span><p className="text-xs text-[var(--text)] mt-1">{providerStatus.configured ? 'Configured' : 'Not configured'}</p></div>
            <div><span className={labelCls}>Source</span><p className="text-xs text-[var(--text)] mt-1">{providerStatus.source || 'none'}</p></div>
            <div><span className={labelCls}>Phone Number ID</span><p className="text-xs text-[var(--text)] mt-1">{providerStatus.phoneNumberId || '—'}</p></div>
            <div><span className={labelCls}>API Version</span><p className="text-xs text-[var(--text)] mt-1">{providerStatus.apiVersion || 'v21.0'}</p></div>
          </div>
          {providerStatus.hint ? <div className="mb-3"><Notice ok={false}>{providerStatus.hint}</Notice></div> : null}
          <form onSubmit={saveProvider} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Access Token {providerStatus.hasAccessToken ? '(saved)' : ''}</label><input className={inputCls} type="password" value={prov.accessToken} onChange={(e) => setProv({ ...prov, accessToken: e.target.value })} placeholder="Leave blank to keep saved" /></div>
              <div><label className={labelCls}>App Secret {providerStatus.hasAppSecret ? '(saved)' : ''}</label><input className={inputCls} type="password" value={prov.appSecret} onChange={(e) => setProv({ ...prov, appSecret: e.target.value })} placeholder="Webhook HMAC secret" /></div>
              <div><label className={labelCls}>Phone Number ID</label><input className={inputCls} value={prov.phoneNumberId} onChange={(e) => setProv({ ...prov, phoneNumberId: e.target.value })} /></div>
              <div><label className={labelCls}>Business Account ID</label><input className={inputCls} value={prov.businessAccountId} onChange={(e) => setProv({ ...prov, businessAccountId: e.target.value })} /></div>
              <div><label className={labelCls}>API Version</label><input className={inputCls} value={prov.apiVersion} onChange={(e) => setProv({ ...prov, apiVersion: e.target.value })} /></div>
              <div><label className={labelCls}>Webhook Verify Token</label><input className={inputCls} value={prov.webhookVerifyToken} onChange={(e) => setProv({ ...prov, webhookVerifyToken: e.target.value })} /></div>
            </div>
            {provMsg ? <Notice ok={provMsg.ok}>{provMsg.text}</Notice> : null}
            <button disabled={provBusy} className="px-4 py-2 rounded-xl bg-[var(--accent)] text-white text-xs font-bold disabled:opacity-50">{provBusy ? 'Saving...' : 'Save Provider'}</button>
          </form>
        </div>
      )}

      {tab === 'template' && (
        <div className="glass-card rounded-2xl p-5">
          <h3 className="text-sm font-bold text-[var(--text)] mb-3">Template & Schedule</h3>
          <form onSubmit={saveConfig} className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <label className="flex items-center gap-2 text-xs text-[var(--text)]"><input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} className="accent-[var(--accent)]" /> Enabled</label>
              <div><label className={labelCls}>Mode</label><select className={inputCls} value={cfg.mode} onChange={(e) => setCfg({ ...cfg, mode: e.target.value })}><option value="FREE_MANUAL">FREE_MANUAL</option><option value="CLOUD_API">CLOUD_API</option></select></div>
              <div><label className={labelCls}>Send Time</label><input className={inputCls} value={cfg.sendtime} onChange={(e) => setCfg({ ...cfg, sendtime: e.target.value })} placeholder="21:00" /></div>
              <div><label className={labelCls}>Time Zone</label><input className={inputCls} value={cfg.timezone} onChange={(e) => setCfg({ ...cfg, timezone: e.target.value })} /></div>
              <div><label className={labelCls}>Eligible Category (empty = staff)</label><input className={inputCls} value={cfg.eligiblecategory} onChange={(e) => setCfg({ ...cfg, eligiblecategory: e.target.value })} placeholder="e.g. STF" /></div>
              <div><label className={labelCls}>Template Name</label><input className={inputCls} value={cfg.templatename} onChange={(e) => setCfg({ ...cfg, templatename: e.target.value })} placeholder="attendance_update" /></div>
              <div><label className={labelCls}>Language</label><input className={inputCls} value={cfg.templatelanguage} onChange={(e) => setCfg({ ...cfg, templatelanguage: e.target.value })} /></div>
              <label className="flex items-center gap-2 text-xs text-[var(--text)]"><input type="checkbox" checked={cfg.dryrun} onChange={(e) => setCfg({ ...cfg, dryrun: e.target.checked })} className="accent-[var(--accent)]" /> Dry-run</label>
              <label className="flex items-center gap-2 text-xs text-[var(--text)]"><input type="checkbox" checked={cfg.approved} onChange={(e) => setCfg({ ...cfg, approved: e.target.checked })} className="accent-[var(--accent)]" /> Approved (Cloud API)</label>
            </div>
            <div><label className={labelCls}>Message Template</label><textarea className={inputCls} rows="6" value={cfg.templatebody} onChange={(e) => setCfg({ ...cfg, templatebody: e.target.value })} placeholder="Use {{EmployeeName}}, {{Paycode}}, {{AttendanceDate}}, {{InTime}}, {{OutTime}}, {{PunchStatus}}, {{Status}}, {{GraceUsed}}, {{GraceRemaining}}" /></div>
            {cfgMsg ? <Notice ok={cfgMsg.ok}>{cfgMsg.text}</Notice> : null}
            <button disabled={cfgBusy} className="px-4 py-2 rounded-xl bg-[var(--accent)] text-white text-xs font-bold disabled:opacity-50">{cfgBusy ? 'Saving...' : 'Save Configuration'}</button>
          </form>
        </div>
      )}

      {tab === 'eligibility' && (
        <div className="glass-card rounded-2xl p-5">
          <h3 className="text-sm font-bold text-[var(--text)] mb-3">Eligibility & Consent</h3>
          <div className="flex flex-wrap gap-2 mb-3">
            {elig?.counts ? Object.entries(elig.counts).map(([k, v]) => (
              <div key={k} className="px-3 py-2 rounded-xl bg-white/5 border border-white/5"><span className="text-[10px] uppercase font-bold text-[var(--muted)]">{k}</span><p className="text-sm font-bold text-[var(--text)]">{v}</p></div>
            )) : null}
          </div>
          <div className="flex flex-wrap items-end gap-2 mb-3">
            <div className="w-40"><label className={labelCls}>Paycode</label><input className={inputCls} value={consentPaycode} onChange={(e) => setConsentPaycode(e.target.value)} placeholder="e.g. 0328" /></div>
            <div className="w-32"><label className={labelCls}>Action</label><select className={inputCls} value={consentAction} onChange={(e) => setConsentAction(e.target.value)}><option value="Granted">Grant</option><option value="Revoked">Revoke</option></select></div>
            <button disabled={busy} onClick={() => consentPaycode && setConsentFor(consentPaycode.trim(), consentAction)} className="px-4 py-2 rounded-xl bg-[var(--accent)] text-white text-xs font-bold disabled:opacity-50">Apply</button>
          </div>
          <p className="text-[10px] text-[var(--muted)] mb-2">Eligible = staff category + valid E.164 number + consent Granted (no opt-out). A number on file does NOT imply consent.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-[var(--muted)] uppercase text-[10px]"><th className="p-2">Paycode</th><th className="p-2">Name</th><th className="p-2">Number</th><th className="p-2">Status</th><th className="p-2"></th></tr></thead>
              <tbody>
                {(consent?.rows || []).map((r) => (
                  <tr key={r.paycode} className="border-t border-white/5">
                    <td className="p-2 text-[var(--text)]">{r.paycode}</td>
                    <td className="p-2 text-[var(--text)]">{r.employeename}</td>
                    <td className="p-2 text-[var(--text)]">{r.whatsappnumber || '—'}</td>
                    <td className="p-2">{statusBadge(r.consentstatus)}</td>
                    <td className="p-2 text-right"><button onClick={() => setConsentFor(r.paycode, 'Revoked')} className="text-[10px] font-bold text-rose-400 hover:underline">Revoke</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'preview' && (
        <div className="glass-card rounded-2xl p-5">
          <h3 className="text-sm font-bold text-[var(--text)] mb-3">Preview / Export (FREE_MANUAL — never sends)</h3>
          <div className="flex flex-wrap items-end gap-2 mb-3">
            <div><label className={labelCls}>Date</label><input type="date" className={inputCls} value={previewDate} onChange={(e) => setPreviewDate(e.target.value)} /></div>
            <div><label className={labelCls}>Paycode (optional)</label><input className={inputCls} value={previewPaycode} onChange={(e) => setPreviewPaycode(e.target.value)} /></div>
            <button disabled={previewBusy} onClick={generatePreview} className="px-4 py-2 rounded-xl bg-[var(--accent)] text-white text-xs font-bold disabled:opacity-50">Generate Preview</button>
            <button disabled={previewBusy} onClick={exportCsv} className="px-4 py-2 rounded-xl bg-white/10 border border-white/10 text-[var(--text)] text-xs font-bold disabled:opacity-50">Export CSV</button>
            <button disabled={sendBusy} onClick={() => runSend(true)} className="px-4 py-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-bold disabled:opacity-50">Run Dry-run</button>
            <button disabled={sendBusy || !healthData.canSendReal} onClick={() => runSend(false)} title={healthData.canSendReal ? '' : 'Real send is OFF until Cloud API is configured, enabled, approved and dry-run=false'} className="px-4 py-2 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed">Send Real</button>
          </div>
          {sendResult ? (
            <div className="flex flex-wrap gap-2 mb-3">
              {[['Total', sendResult.total], ['Sent', sendResult.sent], ['Failed', sendResult.failed], ['Skipped', sendResult.skipped], ['Dry-run', sendResult.dryRun]].map(([k, v]) => (
                <div key={k} className="px-3 py-2 rounded-xl bg-white/5 border border-white/5"><span className="text-[10px] uppercase font-bold text-[var(--muted)]">{k}</span><p className="text-sm font-bold text-[var(--text)]">{v ?? '—'}</p></div>
              ))}
            </div>
          ) : null}
          {previews && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-[var(--muted)] uppercase text-[10px]"><th className="p-2">Paycode</th><th className="p-2">Name</th><th className="p-2">Date</th><th className="p-2">In</th><th className="p-2">Out</th><th className="p-2">Punch</th><th className="p-2">Status</th><th className="p-2">Grace Used</th><th className="p-2">Message</th></tr></thead>
                <tbody>
                  {previews.map((p, i) => (
                    <tr key={i} className="border-t border-white/5">
                      <td className="p-2 text-[var(--text)]">{p.paycode}</td>
                      <td className="p-2 text-[var(--text)]">{p.empname}</td>
                      <td className="p-2 text-[var(--text)]">{p.dateIso}</td>
                      <td className="p-2 text-[var(--text)]">{p.inTime || '—'}</td>
                      <td className="p-2 text-[var(--text)]">{p.outTime || '—'}</td>
                      <td className="p-2 text-[var(--text)]">{p.punchStatus}</td>
                      <td className="p-2">{statusBadge(p.status)}</td>
                      <td className="p-2 text-[var(--text)]">{p.graceUsed || '—'}</td>
                      <td className="p-2 text-[var(--muted)] whitespace-pre-wrap max-w-xs">{p.text}</td>
                    </tr>
                  ))}
                  {previews.length === 0 ? <tr><td colSpan="9" className="p-4 text-center text-[var(--muted)]">No eligible staff for this date (check category, number and consent).</td></tr> : null}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'logs' && (
        <div className="glass-card rounded-2xl p-5">
          <h3 className="text-sm font-bold text-[var(--text)] mb-3">Message Logs</h3>
          <div className="flex flex-wrap items-end gap-2 mb-3">
            <div><label className={labelCls}>Date</label><input type="date" className={inputCls} value={logDate} onChange={(e) => setLogDate(e.target.value)} /></div>
            <div><label className={labelCls}>Paycode</label><input className={inputCls} value={logPaycode} onChange={(e) => setLogPaycode(e.target.value)} /></div>
            <div className="w-32"><label className={labelCls}>Status</label><input className={inputCls} value={logStatus} onChange={(e) => setLogStatus(e.target.value)} placeholder="Sent/Failed..." /></div>
            <button disabled={busy} onClick={loadLogs} className="px-4 py-2 rounded-xl bg-[var(--accent)] text-white text-xs font-bold disabled:opacity-50">Load</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-[var(--muted)] uppercase text-[10px]"><th className="p-2">Date</th><th className="p-2">Paycode</th><th className="p-2">Name</th><th className="p-2">Number</th><th className="p-2">Status</th><th className="p-2">Provider ID</th><th className="p-2">Attempts</th><th className="p-2">Error</th></tr></thead>
              <tbody>
                {(logRows || []).map((r) => (
                  <tr key={r.id} className="border-t border-white/5">
                    <td className="p-2 text-[var(--text)]">{r.attendancedate || '—'}</td>
                    <td className="p-2 text-[var(--text)]">{r.paycode}</td>
                    <td className="p-2 text-[var(--text)]">{r.employeename}</td>
                    <td className="p-2 text-[var(--text)]">{r.recipientnumber || '—'}</td>
                    <td className="p-2">{statusBadge(r.status)}</td>
                    <td className="p-2 text-[var(--muted)]">{r.providermessageid || '—'}</td>
                    <td className="p-2 text-[var(--text)]">{r.attemptcount}</td>
                    <td className="p-2 text-[var(--muted)] max-w-xs truncate">{r.errormessage || '—'}</td>
                  </tr>
                ))}
                {(logRows || []).length === 0 ? <tr><td colSpan="8" className="p-4 text-center text-[var(--muted)]">No messages logged yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}


