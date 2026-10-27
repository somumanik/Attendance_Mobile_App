'use client';

// web-next/components/employee/CelebrationsSection.jsx
// Employee "Celebrations" tab — full parity with the Mobile App reference
// (mobile/src/screens/employee/EmployeeBdayAnniversaryScreen.jsx).
//
// Data: GET /api/employee/celebrations — wahi existing shared backend endpoint
// jo mobile app use karta hai. Logged-in employee ki identity verified JWT se
// aati hai aur backend use SERVER-SIDE exclude karta hai (paycode <> @self) —
// client kabhi paycode bhejta nahi, isliye self-exclusion bypass nahi ho sakta.
//
// Sources (existing, read-only): dbo.tblemployee.dateofbirth / .dateofjoin aur
// dbo.HR_MarriageAnniversary (existing HR import). Koi dummy data generate nahi
// hota; missing/unavailable data par honest empty state dikhta hai.
// Date rendering local parts se hoti hai (celebrationUtils) — koi UTC parsing
// nahi, koi timezone day-shift nahi. Filter switching client-side hota hai —
// koi duplicate/refetch request nahi.

import { useCallback, useState } from 'react';
import useApiData from './useApiData';
import AsyncBox from './AsyncBox';
import {
  clean,
  PLACEHOLDER,
  dayName,
  joinedLabel,
  FILTERS,
  SECTIONS,
  sectionTotal,
  itemsFor,
} from './celebrationUtils';

function CelebrationCard({ section, item }) {
  const sub = section.sub(item);
  return (
    <article className="celv-card">
      <div className="celv-card__icon">
        <i className={section.icon} aria-hidden="true" />
      </div>
      <div className="celv-card__body">
        <p className="celv-card__name">{clean(item.name) || PLACEHOLDER}</p>
        <p className="celv-card__role">
          {[clean(item.designation), clean(item.department)].filter(Boolean).join(' · ') || PLACEHOLDER}
        </p>
        <div className="celv-card__foot">
          <span className="celv-card__chip">{section.line(item)}</span>
          {sub ? <span className="celv-card__sub">{sub}</span> : null}
          {section.id === 'workAnniversaries' && item.joinedOn ? (
            <span className="celv-card__sub">{joinedLabel(item.joinedOn)}</span>
          ) : null}
        </div>
      </div>
      <div className="celv-card__right">
        <span className="celv-card__day">{dayName(item.date)}</span>
        {item.daysUntil === 0 ? (
          <span className="celv-card__today">TODAY</span>
        ) : (
          <span className="celv-card__in">{`in ${item.daysUntil}d`}</span>
        )}
      </div>
    </article>
  );
}

export default function CelebrationsSection() {
  const { data, error, loading, reload } = useApiData('/employee/celebrations');
  // Mobile default filter 'today' — same initial state as the mobile tab.
  const [filter, setFilter] = useState('today');

  const items = useCallback((sectionId) => itemsFor(data, sectionId, filter), [data, filter]);

  const marriageUnavailable = data ? data.marriageAvailable === false : false;

  return (
    <AsyncBox loading={loading} error={error} onRetry={reload} label="Loading celebrations...">
      {data ? (
        <div className="celv">
          {/* Date filter — All / Today / This Week / This Month / Upcoming */}
          <div className="celv__filters" role="group" aria-label="Filter celebrations">
            {FILTERS.map((f) => {
              const active = filter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  className={active ? 'celv__chip celv__chip--active' : 'celv__chip'}
                  aria-pressed={active}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          {SECTIONS.map((section) => {
            const list = items(section.id);
            const unavailable = section.id === 'marriageAnniversaries' && marriageUnavailable;
            return (
              <section key={section.id} className="celv__section" style={{ '--celv-accent': section.accent }}>
                <header className="celv__sec-head">
                  <i className={`${section.icon} celv__sec-icon`} aria-hidden="true" />
                  <h3 className="celv__sec-title">{section.title}</h3>
                  <span className="celv__sec-count">{sectionTotal(data, section.id)}</span>
                </header>

                {list.length ? (
                  <div className="celv__grid">
                    {list.map((it, i) => (
                      <CelebrationCard key={`${section.id}-${it.date}-${i}`} section={section} item={it} />
                    ))}
                  </div>
                ) : (
                  <div className="celv__empty">
                    {unavailable ? 'Marriage anniversary data is currently unavailable.' : section.empty}
                  </div>
                )}
              </section>
            );
          })}

          <p className="celv__footnote">
            {`Organisation celebrations · your own events are excluded · ${clean(data.today)}`}
          </p>
        </div>
      ) : null}
    </AsyncBox>
  );
}
