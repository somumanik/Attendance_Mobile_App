import PortalBranding from '../../components/PortalBranding';
import ThemeSelector from '../../components/ThemeSelector';
import RoleCard from '../../components/RoleCard';
import { ShieldIcon, PersonIcon, SecurityIcon } from '../../components/icons';

export default function LoginPage() {
  return (
    <main className="login-shell">
      <PortalBranding />

      <div className="role-grid">
        <RoleCard
          href="/login/hr"
          icon={<ShieldIcon />}
          title="HR Admin"
          description="Manage attendance, employees and HR operations."
          cta="Continue as HR Admin"
        />
        <RoleCard
          href="/login/employee"
          icon={<PersonIcon />}
          title="Employee"
          description="View personal attendance, leave, reports and profile."
          cta="Continue as Employee"
        />
        <RoleCard
          href="/login/superadmin"
          icon={<SecurityIcon />}
          title="SuperAdmin"
          description="Access authorized system-level administration."
          cta="Continue as SuperAdmin"
        />
      </div>

      <ThemeSelector />
    </main>
  );
}
