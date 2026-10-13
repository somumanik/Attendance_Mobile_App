// web-next/components/employee/EmployeeShell.jsx — protected employee portal shell (server component).

import LogoutButton from '../LogoutButton';
import EmployeeNav from './EmployeeNav';

export default function EmployeeShell({ employee, children }) {
  const name = String(employee?.empname || employee?.paycode || 'Employee');
  const code = String(employee?.paycode || '');

  return (
    <div className="emp-shell">
      <header className="emp-header">
        <div className="emp-header__id">
          <span className="emp-header__name">{name}</span>
          {code ? <span className="emp-header__code">{code}</span> : null}
        </div>
        <LogoutButton />
      </header>
      <EmployeeNav />
      <main className="emp-content">{children}</main>
    </div>
  );
}
