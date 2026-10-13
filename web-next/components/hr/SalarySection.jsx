'use client';

// web-next/components/hr/SalarySection.jsx — Salary / Payroll (read-only list if imported).

import useApiData from '../useApiData';
import AsyncBox from '../employee/AsyncBox';

export default function SalarySection() {
  const { data, error, loading, reload } = useApiData('/hr/salary/master');
  const rows = data?.rows || [];

  return (
    <AsyncBox loading={loading} error={error} onRetry={reload} label="Salary data load ho raha hai...">
      <div className="card">
        <h3 className="card__title">Salary Master</h3>
        {rows.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Paycode</th><th>Name</th><th>Basic</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}><td>{r.paycode}</td><td>{r.empname || r.employeename || ''}</td><td>{r.basic ?? r.basicsalary ?? ''}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">Salary data import nahi hui (HR Excel import ke baad dikhega).</p>
        )}
      </div>
    </AsyncBox>
  );
}
