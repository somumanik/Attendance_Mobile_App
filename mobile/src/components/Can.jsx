// ============================================================================
// FILE: mobile/src/components/Can.jsx
// PURPOSE: Shared action-level permission gate for the UI
// ============================================================================

/**
 * `Can` renders its children ONLY when the signed-in user is permitted to run
 * the given (module, action).
 *
 * IMPORTANT — this is UI convenience, never security:
 *   The server independently enforces the same permission on every request
 *   (see server/index.js `HR_PERMISSION_RULES` + `enforceHrModulePermission`),
 *   so hiding a button can never grant access and a stale screen still gets a
 *   403 from the API.
 *
 * Backward compatibility:
 *   - SuperAdmin always passes (full management access).
 *   - An HR session with no permissions payload (e.g. the store was
 *     unavailable) passes, exactly like before this gate existed.
 *   - An HR account with stored permissions sees only what it was granted.
 *
 * Usage:
 *   <Can module="holidays" action="create"><Button title="Add Holiday" ... /></Can>
 */

import React from 'react';
import { useAuth } from '../hooks/useAuth';

export const Can = ({ module, action = 'view', children }) => {
  const { can } = useAuth();
  if (!module) return children;
  return can(module, action) ? children : null;
};

/** Imperative form for cases where a boolean is more convenient than a wrapper. */
export const useCan = () => {
  const { can } = useAuth();
  return can;
};

export default Can;
