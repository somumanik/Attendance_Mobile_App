'use client';

// web-next/components/employee/ProfileSection.jsx — authenticated employee's own profile.

import useApiData from './useApiData';
import AsyncBox from './AsyncBox';
import { prettyDate } from '../../lib/format';

export default function ProfileSection() {
  const { data, error, loading, reload } = useApiData('/employee/profile');

  const p = data?.profile;

  const rows = p
    ? [
        ['Employee Name', p.empname],
        ['Employee ID / Paycode', p.paycode],
        ['Biometric Card No', p.presentcardno],
        ['Department', p.departmentname],
        ['Designation', p.designation],
        ['Company', p.companyname],
        ['Date of Joining', prettyDate(p.dateofjoin)],
        ['Date of Birth', prettyDate(p.dateofbirth)],
        ['Gender', p.sex],
        ['Marital Status', p.ismarried === 'Y' ? 'Married' : p.ismarried === 'N' ? 'Single' : ''],
        ['Category', p.cat],
        ['Qualification', p.qualification],
        ['Experience', p.experience],
        ['Blood Group', p.bloodgroup],
        ['Email', p.email],
        ['Mobile', p.mobile],
      ]
    : [];

  return (
    <AsyncBox loading={loading} error={error} onRetry={reload} label="Profile load ho raha hai...">
      {p ? (
        <div className="card">
          <h3 className="card__title">My Profile</h3>
          <dl className="kv">
            {rows.filter(([, v]) => v).map(([k, v]) => (
              <div className="kv__row" key={k}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        </div>
      ) : null}
    </AsyncBox>
  );
}
