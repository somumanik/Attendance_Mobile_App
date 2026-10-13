'use client';

// web-next/components/employee/CelebrationsSection.jsx — real org celebrations (self excluded by backend).

import useApiData from './useApiData';
import AsyncBox from './AsyncBox';
import { prettyDate } from '../../lib/format';

const BUCKETS = [
  ['today', 'Today'],
  ['thisWeek', 'This Week'],
  ['thisMonth', 'This Month'],
  ['upcoming', 'Upcoming'],
];

function Group({ title, group }) {
  const has = BUCKETS.some(([k]) => (group?.[k] || []).length > 0);
  if (!has) return null;
  return (
    <div className="card">
      <h3 className="card__title">{title}</h3>
      {BUCKETS.map(([k, label]) => (
        (group?.[k] || []).length ? (
          <div key={k} className="cel-bucket">
            <p className="cel-bucket__label">{label}</p>
            <ul className="list">
              {(group[k] || []).map((c, i) => (
                <li key={i} className="list__item">
                  <strong>{c.name}</strong>
                  {c.department ? <span className="muted"> · {c.department}</span> : null}
                  <span className="muted"> · {prettyDate(c.date)}</span>
                  {c.age != null ? <span className="muted"> · {c.age} yrs</span> : null}
                  {c.years != null ? <span className="muted"> · {c.years} yrs</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null
      ))}
    </div>
  );
}

export default function CelebrationsSection() {
  const { data, error, loading, reload } = useApiData('/employee/celebrations');

  return (
    <AsyncBox loading={loading} error={error} onRetry={reload} label="Celebrations load ho rahe hain...">
      {data ? (
        <>
          <Group title="Birthdays" group={data.birthdays} />
          <Group title="Work Anniversaries" group={data.workAnniversaries} />
          {data.marriageAvailable ? <Group title="Marriage Anniversaries" group={data.marriageAnniversaries} /> : null}
          {!data.birthdays && !data.workAnniversaries ? (
            <p className="empty">Koi celebration data nahi hai.</p>
          ) : null}
        </>
      ) : null}
    </AsyncBox>
  );
}
