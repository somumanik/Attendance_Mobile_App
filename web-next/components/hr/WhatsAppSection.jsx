'use client';

// web-next/components/hr/WhatsAppSection.jsx — WhatsApp Attendance Messaging (V1).
// HR-only. FREE_MANUAL preview/export + gated Cloud API sending (real send stays OFF
// unless Cloud API is configured, enabled, dry-run=false and HR-approved).

import { useEffect, useState } from 'react';
import useApiData from '../useApiData';
import apiFetch from '../../lib/api';
import { HrCan } from './HrAccess';
import { isoToday } from '../../lib/format';
import { manualChatUrl, buildManualQueue, queueNeighborIndex, queueProgressLabel, matchSearch, paginate, togglePaycodeSelection, mergePaycodeSelection, PAGE_SIZES, hasRiskyTemplateSymbols } from '../../lib/whatsapp';
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

// Eligibility counters + rejection reason labels (server keys stay unchanged).
const COUNT_LABELS = { total: 'Total', eligible: 'Eligible', noNumber: 'Missing number', invalidNumber: 'Invalid number', noConsent: 'No consent', optedOut: 'Opted out', notStaff: 'Category mismatch', inactive: 'Inactive', outOfScope: 'Out of scope' };
const REASON_LABELS = { ELIGIBLE: 'Eligible', NO_NUMBER: 'Missing number', INVALID_NUMBER: 'Invalid number', NO_CONSENT: 'No consent', OPTED_OUT: 'Opted out', CATEGORY_MISMATCH: 'Category mismatch', INACTIVE: 'Inactive', OUT_OF_SCOPE: 'Out of scope' };

function Notice({ ok, children }) {
  return <div className={`rounded-xl px-3 py-2 text-[11px] font-semibold leading-relaxed ${ok ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-200' : 'bg-rose-500/10 border border-rose-500/20 text-rose-200'}`}>{children}</div>;
}

function statusBadge(status) {
  if (status === 'Sent' || status === 'Delivered' || status === 'Read' || status === 'Granted') return <span className="badge badge--present">{status}</span>;
  if (status === 'Failed' || status === 'Revoked') return <span className="badge badge--absent">{status}</span>;
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

  // Eligibility extras: real category filter + recipient-number management.
  const [categories, setCategories] = useState([]);
  const [eligCategory, setEligCategory] = useState('STAFF'); // display filter only — never changes eligibility
  const [numPaycode, setNumPaycode] = useState('');
  const [numValue, setNumValue] = useState('');
  const [numBusy, setNumBusy] = useState(false);

  // Multi-select manual queue (Preview tab) — client-side only, wa.me links only.
  const [selectedPaycodes, setSelectedPaycodes] = useState([]);
  const [queue, setQueue] = useState([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [queueMsg, setQueueMsg] = useState(null);

  // Search / filter / pagination (display-only, client-side over the FULL loaded
  // result sets — no DB call per keystroke, so no debounce is needed). Filters are
  // independent of consent/eligibility state and never change what is eligible.
  const [eligSearch, setEligSearch] = useState('');
  const [eligStatus, setEligStatus] = useState('(All)');
  const [eligPage, setEligPage] = useState(1);
  const [eligPageSize, setEligPageSize] = useState(25);
  const [prevSearch, setPrevSearch] = useState('');
  const [prevStatus, setPrevStatus] = useState('(All)');
  const [prevCategory, setPrevCategory] = useState('(All)');
  const [prevPage, setPrevPage] = useState(1);
  const [prevPageSize, setPrevPageSize] = useState(25);
  const [consSearch, setConsSearch] = useState('');
  const [consPage, setConsPage] = useState(1);
  const [consPageSize, setConsPageSize] = useState(25);

  useEffect(() => {
    if (config.data?.config) {
      const c = config.data.config;
      setCfg({ enabled: !!c.enabled, mode: c.mode || 'FREE_MANUAL', sendtime: c.sendtime || '21:00', timezone: c.timezone || 'Asia/Kolkata', eligiblecategory: c.eligiblecategory || '', dryrun: !!c.dryrun, templatename: c.templatename || '', templatelanguage: c.templatelanguage || 'en', templatebody: c.templatebody || '', approved: !!c.approved });
    }
  }, [config.data]);

  // Prefill the provider form with the SAVED non-secret values (Phone Number ID,
  // Business Account ID, API version) so HR edits the real current configuration —
  // Phone Number ID is an editable input, never a hardcoded constant. Secrets are
  // never returned by the API and are never prefilled (blank = keep saved secret).
  useEffect(() => {
    const ps = config.data?.providerStatus;
    if (!ps) return;
    setProv((p) => ({ ...p, phoneNumberId: ps.phoneNumberId || '', businessAccountId: ps.businessAccountId || '', apiVersion: ps.apiVersion || 'v21.0' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.data?.providerStatus]);

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

  async function loadCategories() {
    // Real category data (dbo.tblcategory lookup) — never a hardcoded list.
    try { const d = await apiFetch('/whatsapp/categories'); setCategories(d.categories || []); } catch (err) { /* non-fatal */ }
  }

  /** Save/update a recipient's WhatsApp number against a Paycode. Stored in the
      WhatsApp-specific table only; NEVER grants consent and never changes the
      employee's category or active status. */
  async function saveRecipientNumber(e) {
    e.preventDefault();
    if (!numPaycode.trim() || !numValue.trim()) { setMsg({ ok: false, text: 'Paycode aur WhatsApp number dono bharein.' }); return; }
    setNumBusy(true); setMsg(null);
    try {
      const res = await apiFetch('/whatsapp/recipient-number', { method: 'PUT', body: { paycode: numPaycode.trim(), whatsappnumber: numValue.trim() } });
      setMsg({ ok: true, text: `Number saved for ${res.paycode}: +${res.whatsappnumber} (E.164). Consent unchanged — alag se Grant karein.` });
      setNumValue('');
      // Refresh recipient list, eligibility counters and preview data so the new
      // number can qualify if all other rules pass.
      await Promise.all([loadEligibility(), loadConsent()]);
      if (previews) generatePreview().catch(() => {});
    } catch (err) { setMsg({ ok: false, text: err.message }); }
    finally { setNumBusy(false); }
  }

  /* ---- Multi-select manual queue (FREE_MANUAL click-to-chat, one by one) ----
     Pure client-side: wa.me links only — never the Meta Cloud API, never
     auto-clicks Send, never opens more than one chat at a time, and nothing is
     ever marked sent/delivered just because a chat was opened. */
  /* ---- Preview list display pipeline (display-only) ----
     FULL loaded result set -> search/status/category filter -> current page.
     Selection is keyed by paycode and survives paging/filtering. The manual queue
     is always rebuilt against the FULL eligible preview rows + selection via
     buildManualQueue (which re-validates each number), so a hidden, filtered-out,
     ineligible or invalid-number row can never enter the queue. */
  const filteredPreviews = (previews || []).filter((p) => {
    if (!matchSearch(prevSearch, p.paycode, p.empname)) return false;
    if (prevStatus !== '(All)' && String(p.status || '') !== prevStatus) return false;
    if (prevCategory === '(All)') return true;
    const f = String(prevCategory || '').trim().toUpperCase();
    return String(p.cat || '').trim().toUpperCase() === f || String(p.catname || '').trim().toUpperCase() === f;
  });
  const previewPager = paginate(filteredPreviews, prevPage, prevPageSize);
  const filteredPreviewKeys = new Set(filteredPreviews.map((p) => String(p.paycode)));
  // Eligible = rows with a usable wa.me link, within the CURRENT filtered results.
  const selectablePaycodes = (previews || []).filter((p) => filteredPreviewKeys.has(String(p.paycode)) && manualChatUrl(p.whatsappnumber, p.text)).map((p) => String(p.paycode));
  const pageSelectablePaycodes = previewPager.pageRows.filter((p) => manualChatUrl(p.whatsappnumber, p.text)).map((p) => String(p.paycode));
  function toggleSelect(paycode) {
    setSelectedPaycodes((prev) => togglePaycodeSelection(prev, paycode));
    setQueueMsg(null);
  }
  function selectPageEligible() { setSelectedPaycodes((prev) => mergePaycodeSelection(prev, pageSelectablePaycodes)); setQueueMsg(null); }
  function selectAllEligible() { setSelectedPaycodes(selectablePaycodes); setQueueMsg(null); }
  function clearSelection() { setSelectedPaycodes([]); setQueueMsg(null); }

  function openQueueChat(entry) {
    // window.open WITHOUT 'noopener' so a blocked popup is detectable (returns null).
    const win = window.open(entry.chatUrl, '_blank');
    if (win) { try { win.opener = null; } catch (_) { /* ignore */ } return true; }
    setQueueMsg({ ok: false, text: 'WhatsApp chat open nahi ho paya — browser ne popup block kiya hai. Neeche "Retry Open Chat" dabayein.' });
    return false;
  }

  function startManualQueue() {
    const q = buildManualQueue(previews || [], selectedPaycodes);
    if (!q.length) { setQueueMsg({ ok: false, text: 'Queue khaali hai — pehle eligible employees select karein.' }); return; }
    setQueue(q); setQueueIndex(0); setQueueMsg(null);
    openQueueChat(q[0]);
  }

  function gotoQueue(step) {
    const i = queueNeighborIndex(queueIndex, queue.length, step);
    if (i < 0 || i === queueIndex) return;
    setQueueIndex(i); setQueueMsg(null);
    openQueueChat(queue[i]);
  }

  async function generatePreview() {
    setPreviewBusy(true); setPreviews(null);
    setSelectedPaycodes([]); setQueue([]); setQueueMsg(null); // selection follows the displayed results only
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
    if (dryRun === false && !window.confirm('Send REAL WhatsApp attendance messages? This contacts Meta and MAY INCUR per-message charges (business-initiated template — not free). Continue?')) return;
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
    if (tab === 'eligibility') { loadEligibility(); loadConsent(); loadCategories(); }
    if (tab === 'logs') { loadLogs(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          <div className="flex items-center gap-2 justify-end">
            <span className={`badge ${cfg.mode === 'CLOUD_API' ? 'badge--absent' : 'badge--neutral'}`}>{cfg.mode === 'CLOUD_API' ? 'Mode: Cloud API' : 'Mode: Free Manual'}</span>
            <span className={`badge ${healthData.canSendReal ? 'badge--present' : 'badge--neutral'}`}>{healthData.canSendReal ? 'Cloud API: real send ARMED' : 'Real send OFF'}</span>
          </div>
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
            <div><span className={labelCls}>Status</span><p className="text-xs text-[var(--text)] mt-1">{providerStatus.configured ? 'Saved — not verified with Meta' : 'Not configured'}</p></div>
            <div><span className={labelCls}>Source</span><p className="text-xs text-[var(--text)] mt-1">{providerStatus.source || 'none'}</p></div>
            <div><span className={labelCls}>Phone Number ID</span><p className="text-xs text-[var(--text)] mt-1">{providerStatus.phoneNumberId || '—'}</p></div>
            <div><span className={labelCls}>API Version</span><p className="text-xs text-[var(--text)] mt-1">{providerStatus.apiVersion || 'v21.0'}</p></div>
          </div>
          <p className="text-[10px] text-[var(--muted)] mb-3 leading-relaxed">
            <i className="fas fa-circle-info mr-1"></i>Saved values are used as-is for Cloud API calls — saving <span className="font-bold">never contacts Meta</span> and does <span className="font-bold">not</span> verify credentials, template approval, or that sending works. Sending stays OFF until Enabled + Approved + dry-run=false + Cloud API mode are all set (Template &amp; Schedule tab).
          </p>
          {providerStatus.hint ? <div className="mb-3"><Notice ok={false}>{providerStatus.hint}</Notice></div> : null}
          <form onSubmit={saveProvider} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Access Token {providerStatus.hasAccessToken ? '(saved — leave blank to keep)' : ''}</label><input className={inputCls} type="password" value={prov.accessToken} onChange={(e) => setProv({ ...prov, accessToken: e.target.value })} placeholder="Leave blank to keep saved" /><p className="text-[9px] text-[var(--muted)] mt-1 leading-tight">Meta WhatsApp Cloud API access token. Encrypted at rest; never echoed back.</p></div>
              <div><label className={labelCls}>App Secret {providerStatus.hasAppSecret ? '(saved — leave blank to keep)' : ''}</label><input className={inputCls} type="password" value={prov.appSecret} onChange={(e) => setProv({ ...prov, appSecret: e.target.value })} placeholder="Webhook HMAC secret" /><p className="text-[9px] text-[var(--muted)] mt-1 leading-tight">Meta App Secret — used only to verify webhook HMAC signatures (X-Hub-Signature-256).</p></div>
              <div>
                <label className={labelCls}>Phone Number ID (editable)</label>
                <div className="flex gap-1.5"><input className={inputCls} value={prov.phoneNumberId} onChange={(e) => setProv({ ...prov, phoneNumberId: e.target.value })} placeholder="e.g. 1234567890" /><button type="button" title="Remove the saved Phone Number ID" onClick={() => setProv({ ...prov, phoneNumberId: '*Clear' })} className="px-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[10px] font-bold">Clear</button></div>
                <p className="text-[9px] text-[var(--muted)] mt-1 leading-tight">The Meta WhatsApp <b>phone-number id</b> (numeric) — NOT the visible telephone number. Naya WhatsApp number lene par yahan naya ID daal kar Save karein.</p>
              </div>
              <div>
                <label className={labelCls}>Business Account ID (editable)</label>
                <div className="flex gap-1.5"><input className={inputCls} value={prov.businessAccountId} onChange={(e) => setProv({ ...prov, businessAccountId: e.target.value })} placeholder="e.g. 1098765432109876" /><button type="button" title="Remove the saved Business Account ID" onClick={() => setProv({ ...prov, businessAccountId: '*Clear' })} className="px-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[10px] font-bold">Clear</button></div>
                <p className="text-[9px] text-[var(--muted)] mt-1 leading-tight">The actual Meta WhatsApp Business Account ID (numeric) — NEVER the HR login id (e.g. HR001).</p>
              </div>
              <div>
                <label className={labelCls}>API Version</label>
                <div className="flex gap-1.5"><input className={inputCls} value={prov.apiVersion} onChange={(e) => setProv({ ...prov, apiVersion: e.target.value })} placeholder="v21.0" /><button type="button" title="Remove the saved API version" onClick={() => setProv({ ...prov, apiVersion: '*Clear' })} className="px-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[10px] font-bold">Clear</button></div>
                <p className="text-[9px] text-[var(--muted)] mt-1 leading-tight">Graph API version used by this implementation (format: v21.0).</p>
              </div>
              <div>
                <label className={labelCls}>Webhook Verify Token {providerStatus.hasWebhookVerifyToken ? '(saved — leave blank to keep)' : ''}</label>
                <div className="flex gap-1.5"><input className={inputCls} value={prov.webhookVerifyToken} onChange={(e) => setProv({ ...prov, webhookVerifyToken: e.target.value })} placeholder="Set to match Meta webhook config" /><button type="button" title="Remove the saved webhook verify token" onClick={() => setProv({ ...prov, webhookVerifyToken: '*Clear' })} className="px-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[10px] font-bold">Clear</button></div>
                <p className="text-[9px] text-[var(--muted)] mt-1 leading-tight">Token Meta sends in the webhook verification challenge (hub.verify_token). Saved value masked ({providerStatus.webhookVerifyTokenHint || '—'}).</p>
              </div>
            </div>
            <p className="text-[9px] text-[var(--muted)] leading-tight">Blank field = pehle saved value as-is rehti hai (kabhi auto-clear nahi hoti). Hatane ke liye <b>Clear</b> button dabayein (ya value me <b>*Clear</b> type karein).</p>
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
              <div><label className={labelCls}>Sending Mode</label><select className={inputCls} value={cfg.mode} onChange={(e) => setCfg({ ...cfg, mode: e.target.value })}><option value="FREE_MANUAL">Free Manual (opens WhatsApp chat)</option><option value="CLOUD_API">Cloud API (scheduled, may bill)</option></select><p className="text-[9px] text-[var(--muted)] mt-1 leading-tight">Free Manual never contacts Meta. Cloud API sends automated templates and may incur per-message charges.</p></div>
              <div><label className={labelCls}>Send Time</label><input className={inputCls} value={cfg.sendtime} onChange={(e) => setCfg({ ...cfg, sendtime: e.target.value })} placeholder="21:00" /></div>
              <div><label className={labelCls}>Time Zone</label><input className={inputCls} value={cfg.timezone} onChange={(e) => setCfg({ ...cfg, timezone: e.target.value })} /></div>
              <div><label className={labelCls}>Eligible Category (code or name, empty = staff)</label><input className={inputCls} value={cfg.eligiblecategory} onChange={(e) => setCfg({ ...cfg, eligiblecategory: e.target.value })} placeholder="e.g. STAFF or 001" /></div>
              <div><label className={labelCls}>Template Name</label><input className={inputCls} value={cfg.templatename} onChange={(e) => setCfg({ ...cfg, templatename: e.target.value })} placeholder="attendance_update" /></div>
              <div><label className={labelCls}>Language</label><input className={inputCls} value={cfg.templatelanguage} onChange={(e) => setCfg({ ...cfg, templatelanguage: e.target.value })} /></div>
              <label className="flex items-center gap-2 text-xs text-[var(--text)]"><input type="checkbox" checked={cfg.dryrun} onChange={(e) => setCfg({ ...cfg, dryrun: e.target.checked })} className="accent-[var(--accent)]" /> Dry-run</label>
              <label className="flex items-center gap-2 text-xs text-[var(--text)]"><input type="checkbox" checked={cfg.approved} onChange={(e) => setCfg({ ...cfg, approved: e.target.checked })} className="accent-[var(--accent)]" /> Approved (Cloud API)</label>
            </div>
            <div>
              <label className={labelCls}>Message Template</label>
              <textarea className={inputCls} rows="9" value={cfg.templatebody} onChange={(e) => setCfg({ ...cfg, templatebody: e.target.value })} placeholder="Use {{EmployeeName}}, {{Paycode}}, {{AttendanceDate}}, {{InTime}}, {{OutTime}}, {{PunchStatus}}, {{Status}}, {{GraceUsed}}, {{GraceRemaining}}" />
              <div className="flex items-center gap-2 mt-1.5">
                <button type="button" disabled={!config.data?.defaulttemplate} onClick={() => config.data?.defaulttemplate && setCfg({ ...cfg, templatebody: config.data.defaulttemplate })} className="px-3 py-1.5 rounded-xl bg-white/10 border border-white/10 text-[var(--text)] text-[10px] font-bold disabled:opacity-50">Use formatted default</button>
                <p className="text-[9px] text-[var(--muted)] leading-tight">WhatsApp text formatting: *bold* supported hai; colored fonts supported NAHI hain. Emojis + line breaks se message readable banta hai.</p>
              </div>
              {hasRiskyTemplateSymbols(cfg.templatebody) ? (
                <div className="mt-2"><Notice ok={false}>Is template me decorative emoji/icon ya replacement (�) characters hain jo kuch phones par diamond/box banakar dikhte hain. Generated message se ye symbols <b>automatically hata diye jaate hain</b> (plain-text labels use hote hain) — template ko clean karne ke liye neeche <b>Use formatted default</b> dabayein aur phir Save karein.</Notice></div>
              ) : null}
            </div>
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
              <div key={k} className="px-3 py-2 rounded-xl bg-white/5 border border-white/5"><span className="text-[10px] uppercase font-bold text-[var(--muted)]">{COUNT_LABELS[k] || k}</span><p className="text-sm font-bold text-[var(--text)]">{v}</p></div>
            )) : null}
          </div>
          <div className="flex flex-wrap items-end gap-2 mb-3">
            <div className="w-56">
              <label className={labelCls}>Category filter (display only)</label>
              <select className={inputCls} value={eligCategory} onChange={(e) => setEligCategory(e.target.value)}>
                <option value="STAFF">STAFF (default)</option>
                {(categories || []).map((c) => {
                  const val = String(c.name || c.code || '').trim().toUpperCase();
                  return <option key={c.code} value={val}>{c.name || c.code}{c.name && c.name !== c.code ? ` (${c.code})` : ''}</option>;
                })}
                <option value="(All)">(All categories)</option>
              </select>
            </div>
            <p className="text-[9px] text-[var(--muted)] max-w-xs leading-tight">Real category data (tblcategory lookup). Sirf list filter hota hai — eligibility, consent ya category kabhi change nahi hoti.</p>
          </div>
          <form onSubmit={saveRecipientNumber} className="flex flex-wrap items-end gap-2 mb-3 rounded-xl border border-white/5 bg-white/5 p-3">
            <div className="w-40"><label className={labelCls}>Paycode</label><input className={inputCls} value={numPaycode} onChange={(e) => setNumPaycode(e.target.value)} placeholder="e.g. 1053" /></div>
            <div className="w-56"><label className={labelCls}>WhatsApp number (E.164)</label><input className={inputCls} value={numValue} onChange={(e) => setNumValue(e.target.value)} placeholder="e.g. +91 98765 43210" /></div>
            <button disabled={numBusy} className="px-4 py-2 rounded-xl bg-[var(--accent)] text-white text-xs font-bold disabled:opacity-50">{numBusy ? 'Saving...' : 'Save Number'}</button>
            <p className="text-[9px] text-[var(--muted)] max-w-sm leading-tight">Number WhatsApp-specific table me save hota hai (Savior master kabhi change nahi hoti). Number save karne se consent <b>nahi</b> milta — consent alag se Grant karein. Valid international (E.164) number hi accept hota hai.</p>
          </form>
          {(() => {
            const recipients = (elig?.recipients || []);
            const filtered = recipients.filter((r) => {
              if (!matchSearch(eligSearch, r.paycode, r.empname)) return false;
              if (eligStatus !== '(All)' && String(r.reason || '') !== eligStatus) return false;
              if (eligCategory === '(All)') return true;
              const f = String(eligCategory || '').trim().toUpperCase();
              return String(r.cat || '').trim().toUpperCase() === f || String(r.catname || '').trim().toUpperCase() === f;
            });
            const pager = paginate(filtered, eligPage, eligPageSize);
            const statusOptions = [...new Set(recipients.map((r) => String(r.reason || '')).filter(Boolean))];
            return (
              <div className="mb-3">
                <div className="flex flex-wrap items-end gap-2 mb-2">
                  <div className="w-48"><label className={labelCls}>Search (Paycode / Name)</label><input className={inputCls} value={eligSearch} onChange={(e) => { setEligSearch(e.target.value); setEligPage(1); }} placeholder="Type to filter..." /></div>
                  <div className="w-44"><label className={labelCls}>Status / Reason</label><select className={inputCls} value={eligStatus} onChange={(e) => { setEligStatus(e.target.value); setEligPage(1); }}><option value="(All)">(All statuses)</option>{statusOptions.map((s) => <option key={s} value={s}>{REASON_LABELS[s] || s}</option>)}</select></div>
                  <div className="w-28"><label className={labelCls}>Page size</label><select className={inputCls} value={eligPageSize} onChange={(e) => { setEligPageSize(Number(e.target.value)); setEligPage(1); }}>{PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
                  <div className="flex items-center gap-2">
                    <button type="button" disabled={pager.page <= 1} onClick={() => setEligPage((p) => Math.max(1, p - 1))} className="px-3 py-2 rounded-xl bg-white/10 border border-white/10 text-[var(--text)] text-[10px] font-bold disabled:opacity-40"><i className="fas fa-chevron-left"></i></button>
                    <span className="text-[10px] text-[var(--muted)]">Page <span className="font-bold text-[var(--text)]">{pager.page}</span> of {pager.totalPages} · {pager.total} matching records</span>
                    <button type="button" disabled={pager.page >= pager.totalPages} onClick={() => setEligPage((p) => p + 1)} className="px-3 py-2 rounded-xl bg-white/10 border border-white/10 text-[var(--text)] text-[10px] font-bold disabled:opacity-40"><i className="fas fa-chevron-right"></i></button>
                  </div>
                </div>
                <p className="text-[10px] text-[var(--muted)] mb-2">Search + filters poore loaded list par chalte hain (sirf dikhne ke liye) — eligibility, consent aur counters kabhi nahi badlte.</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-left text-[var(--muted)] uppercase text-[10px]"><th className="p-2">Paycode</th><th className="p-2">Name</th><th className="p-2">Category</th><th className="p-2">Active</th><th className="p-2">Number</th><th className="p-2">Consent</th><th className="p-2">Status / Reason</th></tr></thead>
                    <tbody>
                      {pager.pageRows.map((r) => (
                        <tr key={r.paycode} className="border-t border-white/5">
                          <td className="p-2 text-[var(--text)]">{r.paycode}</td>
                          <td className="p-2 text-[var(--text)]">{r.empname || '—'}</td>
                          <td className="p-2 text-[var(--text)]">{r.catname || r.cat || '—'}{r.catname && r.cat && r.catname !== r.cat ? ` (${r.cat})` : ''}</td>
                          <td className="p-2 text-[var(--text)]">{r.active ? 'Yes' : 'No'}</td>
                          <td className="p-2 text-[var(--text)]">{r.whatsappnumber ? `+${r.whatsappnumber}` : (r.rawphone || '—')}<span className="text-[var(--muted)]"> {r.numbersource === 'whatsapp' ? '(managed)' : r.numbersource === 'telephone1' ? '(master)' : ''}</span></td>
                          <td className="p-2">{statusBadge(r.consentstatus)}</td>
                          <td className="p-2 text-[var(--muted)]">{REASON_LABELS[r.reason] || r.reason || '—'}</td>
                        </tr>
                      ))}
                      {pager.pageRows.length === 0 ? <tr><td colSpan="7" className="p-4 text-center text-[var(--muted)]">Is filter ke liye koi recipient nahi.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
          {Array.isArray(elig?.rejected) && elig.rejected.length ? (
            <details className="mb-3 rounded-xl border border-white/5 bg-white/5 p-3">
              <summary className="text-[11px] font-bold text-[var(--text)] cursor-pointer">Rejection reasons ({elig.rejected.length})</summary>
              <div className="overflow-x-auto mt-2">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-[var(--muted)] uppercase text-[10px]"><th className="p-2">Paycode</th><th className="p-2">Reason</th></tr></thead>
                  <tbody>
                    {elig.rejected.map((r) => (
                      <tr key={r.paycode} className="border-t border-white/5">
                        <td className="p-2 text-[var(--text)]">{r.paycode}</td>
                        <td className="p-2 text-[var(--muted)]">{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
          <div className="flex flex-wrap items-end gap-2 mb-3">
            <div className="w-40"><label className={labelCls}>Paycode</label><input className={inputCls} value={consentPaycode} onChange={(e) => setConsentPaycode(e.target.value)} placeholder="e.g. 0328" /></div>
            <div className="w-32"><label className={labelCls}>Action</label><select className={inputCls} value={consentAction} onChange={(e) => setConsentAction(e.target.value)}><option value="Granted">Grant</option><option value="Revoked">Revoke</option></select></div>
            <button disabled={busy} onClick={() => consentPaycode && setConsentFor(consentPaycode.trim(), consentAction)} className="px-4 py-2 rounded-xl bg-[var(--accent)] text-white text-xs font-bold disabled:opacity-50">Apply</button>
          </div>
          <p className="text-[10px] text-[var(--muted)] mb-2">Eligible = staff category + valid E.164 number + consent Granted (no opt-out). A number on file does NOT imply consent.</p>
          {(() => {
            const rows = (consent?.rows || []).filter((r) => matchSearch(consSearch, r.paycode, r.employeename));
            const pager = paginate(rows, consPage, consPageSize);
            return (
              <div>
                <div className="flex flex-wrap items-end gap-2 mb-2">
                  <div className="w-48"><label className={labelCls}>Search (Paycode / Name)</label><input className={inputCls} value={consSearch} onChange={(e) => { setConsSearch(e.target.value); setConsPage(1); }} placeholder="Type to filter..." /></div>
                  <div className="w-28"><label className={labelCls}>Page size</label><select className={inputCls} value={consPageSize} onChange={(e) => { setConsPageSize(Number(e.target.value)); setConsPage(1); }}>{PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
                  <div className="flex items-center gap-2">
                    <button type="button" disabled={pager.page <= 1} onClick={() => setConsPage((p) => Math.max(1, p - 1))} className="px-3 py-2 rounded-xl bg-white/10 border border-white/10 text-[var(--text)] text-[10px] font-bold disabled:opacity-40"><i className="fas fa-chevron-left"></i></button>
                    <span className="text-[10px] text-[var(--muted)]">Page <span className="font-bold text-[var(--text)]">{pager.page}</span> of {pager.totalPages} · {pager.total} matching records</span>
                    <button type="button" disabled={pager.page >= pager.totalPages} onClick={() => setConsPage((p) => p + 1)} className="px-3 py-2 rounded-xl bg-white/10 border border-white/10 text-[var(--text)] text-[10px] font-bold disabled:opacity-40"><i className="fas fa-chevron-right"></i></button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-left text-[var(--muted)] uppercase text-[10px]"><th className="p-2">Paycode</th><th className="p-2">Name</th><th className="p-2">Number</th><th className="p-2">Status</th><th className="p-2"></th></tr></thead>
                    <tbody>
                      {pager.pageRows.map((r) => (
                        <tr key={r.paycode} className="border-t border-white/5">
                          <td className="p-2 text-[var(--text)]">{r.paycode}</td>
                          <td className="p-2 text-[var(--text)]">{r.employeename}</td>
                          <td className="p-2 text-[var(--text)]">{r.whatsappnumber || '—'}</td>
                          <td className="p-2">{statusBadge(r.consentstatus)}</td>
                          <td className="p-2 text-right"><button onClick={() => setConsentFor(r.paycode, 'Revoked')} className="text-[10px] font-bold text-rose-400 hover:underline">Revoke</button></td>
                        </tr>
                      ))}
                      {pager.pageRows.length === 0 ? <tr><td colSpan="5" className="p-4 text-center text-[var(--muted)]">Koi consent record nahi.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
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
          <p className="text-[10px] text-[var(--muted)] mb-3 leading-relaxed">
            <i className="fas fa-circle-info mr-1"></i>Scheduled attendance updates are business-initiated template messages and MAY INCUR per-message charges per Meta's current pricing. There is no free automated attendance route — free replies are only permitted for a user-initiated conversation within Meta's customer-service window. Dry-run and preview never contact Meta and never incur charges.
          </p>
          <p className="text-[10px] text-emerald-300/80 mb-3 leading-relaxed">
            <i className="fab fa-whatsapp mr-1"></i><span className="font-bold">Free manual sending:</span> "Open WhatsApp" opens the employee's chat (WhatsApp app or Web) with the message prefilled — the message is <span className="font-bold">not sent until you press Send in WhatsApp</span>. No Cloud API credentials are needed, and this never contacts Meta or incurs charges.
          </p>
          {previews && previews.length > 0 ? (
            <div className="flex flex-wrap items-end gap-2 mb-2">
              <div className="w-48"><label className={labelCls}>Search (Paycode / Name)</label><input className={inputCls} value={prevSearch} onChange={(e) => { setPrevSearch(e.target.value); setPrevPage(1); }} placeholder="Type to filter..." /></div>
              <div className="w-40"><label className={labelCls}>Category</label><select className={inputCls} value={prevCategory} onChange={(e) => { setPrevCategory(e.target.value); setPrevPage(1); }}><option value="(All)">(All categories)</option>{[...new Set((previews || []).map((p) => String(p.catname || p.cat || '').trim().toUpperCase()).filter(Boolean))].map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
              <div className="w-36"><label className={labelCls}>Status</label><select className={inputCls} value={prevStatus} onChange={(e) => { setPrevStatus(e.target.value); setPrevPage(1); }}><option value="(All)">(All statuses)</option>{[...new Set((previews || []).map((p) => String(p.status || '')).filter(Boolean))].map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
              <div className="w-28"><label className={labelCls}>Page size</label><select className={inputCls} value={prevPageSize} onChange={(e) => { setPrevPageSize(Number(e.target.value)); setPrevPage(1); }}>{PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
              <div className="flex items-center gap-2">
                <button type="button" disabled={previewPager.page <= 1} onClick={() => setPrevPage((p) => Math.max(1, p - 1))} className="px-3 py-2 rounded-xl bg-white/10 border border-white/10 text-[var(--text)] text-[10px] font-bold disabled:opacity-40"><i className="fas fa-chevron-left"></i></button>
                <span className="text-[10px] text-[var(--muted)]">Page <span className="font-bold text-[var(--text)]">{previewPager.page}</span> of {previewPager.totalPages} · {previewPager.total} matching records</span>
                <button type="button" disabled={previewPager.page >= previewPager.totalPages} onClick={() => setPrevPage((p) => p + 1)} className="px-3 py-2 rounded-xl bg-white/10 border border-white/10 text-[var(--text)] text-[10px] font-bold disabled:opacity-40"><i className="fas fa-chevron-right"></i></button>
              </div>
            </div>
          ) : null}
          {previews && previews.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 mb-3 rounded-xl border border-white/5 bg-white/5 p-3">
              <button type="button" onClick={selectPageEligible} className="px-3 py-1.5 rounded-xl bg-white/10 border border-white/10 text-[var(--text)] text-[10px] font-bold">Select This Page ({pageSelectablePaycodes.length})</button>
              <button type="button" onClick={selectAllEligible} className="px-3 py-1.5 rounded-xl bg-white/10 border border-white/10 text-[var(--text)] text-[10px] font-bold">Select All Eligible — filtered ({selectablePaycodes.length})</button>
              <button type="button" onClick={clearSelection} className="px-3 py-1.5 rounded-xl bg-white/10 border border-white/10 text-[var(--text)] text-[10px] font-bold">Clear Selection</button>
              <span className="text-[10px] text-[var(--muted)]"><span className="font-bold text-[var(--text)]">{selectedPaycodes.length}</span> selected (all pages — sirf eligible + valid number)</span>
              <button type="button" onClick={startManualQueue} disabled={!selectedPaycodes.length} className="px-4 py-2 rounded-xl bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 text-xs font-bold disabled:opacity-40"><i className="fab fa-whatsapp mr-1"></i>Start Manual WhatsApp Queue</button>
              <p className="text-[9px] text-[var(--muted)] w-full leading-tight">"Select This Page" sirf is page ke eligible rows chunta hai; "Select All Eligible — filtered" current search/filter ke SAARE eligible rows (har page se) chunta hai. Selection paging/filtering ke baad bhi bani rehti hai. Manual queue ek-ek karke WhatsApp chat kholti hai — har recipient ke liye WhatsApp me <b>Send khud dabana</b> hota hai, phir Next Recipient dabayein. Chat khulna = sent NAHI hota; kuch bhi automatically send/delivered mark nahi hota. Yeh Cloud API use nahi karta aur Send kabhi auto-click nahi hota.</p>
            </div>
          ) : null}
          {queueMsg ? <Notice ok={queueMsg.ok}>{queueMsg.text}</Notice> : null}
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
                <thead><tr className="text-left text-[var(--muted)] uppercase text-[10px]"><th className="p-2">Queue</th><th className="p-2">Paycode</th><th className="p-2">Name</th><th className="p-2">Date</th><th className="p-2">In</th><th className="p-2">Out</th><th className="p-2">Punch</th><th className="p-2">Status</th><th className="p-2">Grace Used</th><th className="p-2">Message</th><th className="p-2">Manual Send</th></tr></thead>
                <tbody>
                  {previewPager.pageRows.map((p, i) => {
                    const chatUrl = manualChatUrl(p.whatsappnumber, p.text);
                    return (
                      <tr key={i} className="border-t border-white/5">
                        <td className="p-2">
                          <input type="checkbox" className="accent-[var(--accent)]" disabled={!chatUrl} checked={selectedPaycodes.includes(String(p.paycode))} onChange={() => toggleSelect(p.paycode)} title={chatUrl ? 'Manual queue me shamil karein' : 'Invalid number — queue me nahi ja sakta'} />
                        </td>
                        <td className="p-2 text-[var(--text)]">{p.paycode}</td>
                        <td className="p-2 text-[var(--text)]">{p.empname}</td>
                        <td className="p-2 text-[var(--text)]">{p.dateIso}</td>
                        <td className="p-2 text-[var(--text)]">{p.inTime || '—'}</td>
                        <td className="p-2 text-[var(--text)]">{p.outTime || '—'}</td>
                        <td className="p-2 text-[var(--text)]">{p.punchStatus}</td>
                        <td className="p-2">{statusBadge(p.status)}</td>
                        <td className="p-2 text-[var(--text)]">{p.graceUsed || '—'}</td>
                        <td className="p-2 text-[var(--muted)] whitespace-pre-wrap max-w-xs">{p.text}</td>
                        <td className="p-2">
                          {chatUrl ? (
                            <a href={chatUrl} target="_blank" rel="noopener noreferrer" title="Free manual send — opens WhatsApp with the message prefilled; you must press Send" className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 text-[10px] font-bold hover:bg-emerald-600/30 transition">
                              <i className="fab fa-whatsapp"></i> Open WhatsApp
                            </a>
                          ) : <span className="text-[var(--muted)]">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {previewPager.pageRows.length === 0 ? <tr><td colSpan="11" className="p-4 text-center text-[var(--muted)]">In filters ke liye koi recipient nahi (ya is date ke liye koi eligible staff nahi — category, number aur consent check karein).</td></tr> : null}
                </tbody>
              </table>
            </div>
          )}
          {queue.length > 0 ? (() => {
            const cur = queue[queueIndex] || queue[0];
            return (
              <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="badge badge--present">Manual Queue: {queueProgressLabel(queueIndex, queue.length)}</span>
                  <span className="text-xs font-bold text-[var(--text)]">{cur.empname} ({cur.paycode})</span>
                  <span className="text-[10px] text-[var(--muted)]">+{cur.whatsappnumber}</span>
                </div>
                <p className="text-[9px] text-[var(--muted)] mb-2 leading-tight">Har recipient ke liye WhatsApp me <b>Send khud dabayein</b> — uske baad hi Next Recipient dabayein. Chat open hone ko sent/delivered NAHI mana jata; is queue se koi message log me sent mark nahi hota.</p>
                <label className={labelCls}>Message preview (WhatsApp me exactly yehi message jayega)</label>
                <pre className="mt-1 mb-3 p-3 rounded-xl bg-[var(--input-bg)] border border-[var(--border)] text-[11px] text-[var(--text)] whitespace-pre-wrap">{cur.text}</pre>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => gotoQueue(-1)} disabled={queueIndex === 0} className="px-3 py-1.5 rounded-xl bg-white/10 border border-white/10 text-[var(--text)] text-[10px] font-bold disabled:opacity-40"><i className="fas fa-chevron-left mr-1"></i>Previous Recipient</button>
                  <button type="button" onClick={() => openQueueChat(cur)} className="px-3 py-1.5 rounded-xl bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 text-[10px] font-bold"><i className="fab fa-whatsapp mr-1"></i>Retry Open Chat</button>
                  <button type="button" onClick={() => gotoQueue(1)} disabled={queueIndex >= queue.length - 1} className="px-3 py-1.5 rounded-xl bg-white/10 border border-white/10 text-[var(--text)] text-[10px] font-bold disabled:opacity-40">Next Recipient<i className="fas fa-chevron-right ml-1"></i></button>
                  <button type="button" onClick={() => { setQueue([]); setQueueIndex(0); setQueueMsg(null); }} className="px-3 py-1.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[10px] font-bold">End Queue</button>
                </div>
              </div>
            );
          })() : null}
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


