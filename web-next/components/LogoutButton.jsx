'use client';

// web-next/components/LogoutButton.jsx
// auth_token httpOnly cookie clear karta hai (server route handler) aur login par le jata hai.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // cookie clear na bhi ho to bhi client ko login par bhej dete hain.
    }
    router.replace('/login');
    router.refresh();
  }

  return (
    <button className="btn btn--ghost" type="button" onClick={logout} disabled={busy}>
      Logout
    </button>
  );
}
