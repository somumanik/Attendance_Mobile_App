// web-next/components/hr/execStatusBadge.js — Executive Overview ONLY helper.
// Phase 1D.2: colourful, distinguishable status badges for the Executive
// Overview tables and its Audit / Late Employees modals.
//
// The shared statusBadgeClass (lib/hr.js) is intentionally NOT modified so all
// other tabs keep their existing look. The only addition here: a raw Holiday
// label gets its own purple badge instead of sharing the Week Off badge.
// NOTE: the server classifyRow() already folds H/HOLIDAY into 'Week Off', so
// this only fires when a raw holiday label reaches the UI.

import { statusBadgeClass } from '../../lib/hr';

export function execStatusBadgeClass(status) {
  const c = String(status || '').toLowerCase();
  if (c.includes('holiday')) return 'badge--holiday';
  return statusBadgeClass(status);
}