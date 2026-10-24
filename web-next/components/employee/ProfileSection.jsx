'use client';

// web-next/components/employee/ProfileSection.jsx — authenticated employee's own
// profile, functionally aligned with the Mobile App reference
// (mobile/src/screens/employee/EmployeeProfileScreen.jsx).
//
// Data flow (same as mobile): GET /api/employee/profile (read) +
// PUT /api/employee/profile (self-service save). Identity comes ONLY from the
// verified JWT (cookie -> middleware Bearer) — the client never sends a paycode,
// so one employee can never see or edit another employee's profile.
//
// Read-only (HR master — the server refuses to write them): name, paycode,
// biometric card, designation, department, company, date of joining, date of
// birth, gender, marital status, category, qualification, experience, blood
// group, active status.
// Self-service (server whitelist EMPLOYEE_SELF_SERVICE_FIELDS): mobile, personal
// email, address, pin code, emergency contact name, emergency contact number.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import useApiData from './useApiData';
import AsyncBox from './AsyncBox';
import apiFetch from '../../lib/api';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const clean = (v) => String(v == null ? '' : v).trim();
const DASH = '—';

/** Calendar dates only — never parsed through UTC, so a date cannot shift. */
const fmtDate = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(clean(v));
  if (!m) return '';
  return `${m[3]}-${MONTHS[Number(m[2]) - 1]}-${m[1]}`;
};
const yearsSince = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(clean(v));
  if (!m) return null;
  const b = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(b.getTime())) return null;
  const n = new Date();
  let y = n.getFullYear() - b.getFullYear();
  const md = n.getMonth() - b.getMonth();
  if (md < 0 || (md === 0 && n.getDate() < b.getDate())) y -= 1;
  return y < 0 ? null : y;
};
const show = (v) => { const s = clean(v); return s ? s : DASH; };

/** Fields the employee may edit (mirrors the server whitelist). */
const EDITABLE = [
  { key: 'mobile', label: 'Mobile Number', placeholder: 'e.g. 9876543210', inputMode: 'tel' },
  { key: 'email', label: 'Personal Email', placeholder: 'name@example.com', type: 'email' },
  { key: 'address', label: 'Address', placeholder: 'House / street / city', type: 'text' },
  { key: 'pincode', label: 'PIN Code', placeholder: 'e.g. 560001', inputMode: 'numeric' },
  { key: 'emergencyName', label: 'Emergency Contact Name', placeholder: 'Contact name', type: 'text' },
  { key: 'emergencyNumber', label: 'Emergency Contact Number', placeholder: 'Contact number', inputMode: 'tel' },
];

const formFrom = (p) => ({
  mobile: clean(p?.mobile),
  email: clean(p?.email),
  address: clean(p?.address),
  pincode: clean(p?.pincode),
  emergencyName: clean(p?.emergencyName),
  emergencyNumber: clean(p?.emergencyNumber),
});

export default function ProfileSection() {
  const { data, error, loading, reload } = useApiData('/employee/profile');
  const p = data?.profile;

  // Edit / save state for the self-service fields only (mobile parity).
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formMessage, setFormMessage] = useState(null); // { kind, text }

  // PIN status (mobile parity): label = Create vs Change 4-Digit PIN.
  const [pinConfigured, setPinConfigured] = useState(false);
  useEffect(() => {
    let active = true;
    apiFetch('/employee/pin/status')
      .then((s) => { if (active) setPinConfigured(s?.pinConfigured === true); })
      .catch(() => { if (active) setPinConfigured(false); });
    return () => { active = false; };
  }, []);

  const startEdit = () => {
    setForm(formFrom(p));
    setFormMessage(null);
    setEditing(true);
  };
  const cancelEdit = () => {
    setForm(formFrom(p));
    setFormMessage(null);
    setEditing(false);
  };
  const setField = (key, value) => setForm((prev) => ({ ...(prev || {}), [key]: value }));

  const saveEdit = useCallback(async () => {
    if (saving || !form) return; // block duplicate submits
    setSaving(true);
    setFormMessage(null);
    try {
      const payload = {
        mobile: form.mobile || '',
        email: form.email || '',
        address: form.address || '',
        pincode: form.pincode || '',
        emergencyName: form.emergencyName || '',
        emergencyNumber: form.emergencyNumber || '',
      };
      const res = await apiFetch('/employee/profile', { method: 'PUT', body: payload });
      const updated = res?.profile || null;
      if (updated) setForm(formFrom(updated));
      setEditing(false);
      setFormMessage({ kind: 'ok', text: 'Profile saved successfully.' });
    } catch (e) {
      const msg = clean(e?.message) || 'Unable to save profile. Please try again.';
      setFormMessage({ kind: 'error', text: msg });
    } finally {
      setSaving(false);
    }
  }, [form, saving]);

  const age = p ? yearsSince(p.dateofbirth) : null;
  const serviceYears = p ? yearsSince(p.dateofjoin) : null;

  const readRow = (label, value) => (
    <div className="prof-row" key={label}>
      <span className="prof-row__label">{label}</span>
      <span className="prof-row__value">{show(value)}</span>
    </div>
  );

  return (
    <AsyncBox loading={loading} error={error} onRetry={reload} label="Loading your profile...">
      {p ? (
        <div className="prof">
          {/* Profile header + Employee ID card */}
          <section className="card prof-hero">
            <div className="prof-hero__id">
              <div className="prof-avatar" aria-hidden="true">{clean(p.empname).charAt(0) || 'E'}</div>
              <div className="prof-hero__meta">
                <h2 className="prof-hero__name">{show(p.empname)}</h2>
                <p className="prof-hero__role">{show(p.designation)}</p>
                <div className="prof-hero__badges">
                  <span className="prof-badge prof-badge--accent">{show(p.departmentname || p.departmentcode)}</span>
                  <span className={`prof-badge ${clean(p.active).toUpperCase() === 'Y' ? 'prof-badge--ok' : 'prof-badge--muted'}`}>
                    {clean(p.active).toUpperCase() === 'Y' ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
            </div>
            <div className="prof-idcard">
              <div className="prof-idcard__row">
                <span className="prof-idcard__label">Employee ID</span>
                <span className="prof-idcard__chip">{show(p.paycode)}</span>
              </div>
              <div className="prof-idcard__row prof-idcard__row--foot">
                <span className="prof-idcard__label">Biometric Card</span>
                <span className="prof-idcard__value">{show(p.presentcardno)}</span>
              </div>
            </div>
          </section>

          {/* Official information — READ ONLY (HR master) */}
          <section className="card">
            <div className="prof-sec-head">
              <h3 className="card__title prof-sec-title">Official Information</h3>
              <span className="prof-lock">READ ONLY</span>
            </div>
            <p className="prof-hint">Ye HR master fields hain — inhe employee change nahi kar sakta.</p>
            <div className="prof-grid">
              {readRow('Employee Name', p.empname)}
              {readRow('Paycode', p.paycode)}
              {readRow('Biometric Card', p.presentcardno)}
              {readRow('Designation', p.designation)}
              {readRow('Department', p.departmentname || p.departmentcode)}
              {readRow('Company', p.companyname || p.companycode)}
              {readRow('Date of Joining', fmtDate(p.dateofjoin))}
              {readRow('Date of Birth', fmtDate(p.dateofbirth))}
              {readRow('Gender', p.sex === 'M' ? 'Male' : p.sex === 'F' ? 'Female' : '')}
              {readRow('Marital Status', p.ismarried === 'Y' ? 'Married' : p.ismarried === 'N' ? 'Unmarried' : '')}
              {readRow('Category', p.cat)}
              {readRow('Qualification', p.qualification)}
              {readRow('Experience', p.experience)}
              {readRow('Blood Group', p.bloodgroup)}
            </div>
            {(age !== null || serviceYears !== null) ? (
              <p className="prof-hint prof-hint--foot">
                {age !== null ? `Age ${age} years` : ''}{age !== null && serviceYears !== null ? ' · ' : ''}
                {serviceYears !== null ? `${serviceYears} years service` : ''}
              </p>
            ) : null}
          </section>

          {/* Self-service details — EDITABLE (server whitelist) */}
          <section className="card">
            <div className="prof-sec-head">
              <h3 className="card__title prof-sec-title">My Details</h3>
              {!editing ? (
                <button type="button" className="prof-edit" onClick={startEdit}>Edit Profile</button>
              ) : null}
            </div>
            <p className="prof-hint">Ye details aap khud update kar sakte hain. Save ke baad turant reflect hote hain.</p>

            {formMessage ? (
              <div className={formMessage.kind === 'ok' ? 'prof-msg prof-msg--ok' : 'prof-msg prof-msg--error'} role="status">
                {formMessage.text}
              </div>
            ) : null}

            {editing ? (
              <div className="prof-form">
                {EDITABLE.map((f) => (
                  <div className="field" key={f.key}>
                    <label className="field__label" htmlFor={`prof-${f.key}`}>{f.label}</label>
                    <input
                      id={`prof-${f.key}`}
                      className="field__input"
                      type={f.type || 'text'}
                      inputMode={f.inputMode}
                      value={(form || {})[f.key] || ''}
                      onChange={(e) => setField(f.key, e.target.value)}
                      placeholder={f.placeholder}
                      autoCapitalize="off"
                      autoCorrect="off"
                      disabled={saving}
                    />
                  </div>
                ))}
                <div className="prof-actions">
                  <button type="button" className="btn btn--ghost" onClick={cancelEdit} disabled={saving}>Cancel</button>
                  <button type="button" className="btn btn--primary" onClick={saveEdit} disabled={saving}>
                    {saving ? 'Saving...' : 'Save Profile'}
                  </button>
                </div>
                {saving ? <p className="prof-hint prof-hint--foot">Saving your details...</p> : null}
              </div>
            ) : (
              <div className="prof-grid">
                {readRow('Mobile Number', p.mobile)}
                {readRow('Personal Email', p.email)}
                {readRow('Address', p.address)}
                {readRow('PIN Code', p.pincode)}
                {readRow('Emergency Contact Name', p.emergencyName)}
                {readRow('Emergency Contact Number', p.emergencyNumber)}
              </div>
            )}
          </section>

          {/* Security — Change Password + 4-Digit PIN */}
          <section className="card">
            <h3 className="card__title prof-sec-title">Security</h3>
            <div className="security-links prof-security">
              <Link className="prof-sec-row" href="/employee/password">
                <span className="prof-sec-row__icon prof-sec-row__icon--amber" aria-hidden="true"><i className="fas fa-key" /></span>
                <span className="prof-sec-row__text">
                  <span className="prof-sec-row__title">Change Password</span>
                  <span className="prof-sec-row__sub">Apna login password badlein</span>
                </span>
              </Link>
              <Link className="prof-sec-row" href="/employee/pin">
                <span className="prof-sec-row__icon prof-sec-row__icon--violet" aria-hidden="true"><i className="fas fa-lock" /></span>
                <span className="prof-sec-row__text">
                  <span className="prof-sec-row__title">{pinConfigured ? 'Change 4-Digit PIN' : 'Create 4-Digit PIN'}</span>
                  <span className="prof-sec-row__sub">{pinConfigured ? 'PIN set hai — badal sakte hain' : 'PIN abhi set nahi hai'}</span>
                </span>
              </Link>
            </div>
          </section>
        </div>
      ) : (
        <div className="card">
          <p className="empty">Profile not found.</p>
        </div>
      )}
    </AsyncBox>
  );
}
