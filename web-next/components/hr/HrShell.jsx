// web-next/components/hr/HrShell.jsx — protected HR admin shell (server component).

import LogoutButton from '../LogoutButton';
import HrNav from './HrNav';

export default function HrShell({ children }) {
  return (
    <div className="emp-shell">
      <header className="emp-header">
        <div className="emp-header__id">
          <span className="emp-header__name">HR Admin</span>
        </div>
        <LogoutButton />
      </header>
      <HrNav />
      <main className="emp-content">{children}</main>
    </div>
  );
}
