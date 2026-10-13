// web-next/components/RoleCard.jsx — reusable role selection card (server-safe).

import Link from 'next/link';

export default function RoleCard({ href, icon, title, description, cta }) {
  return (
    <Link className="role-card" href={href}>
      <span className="role-card__icon">{icon}</span>
      <h2 className="role-card__title">{title}</h2>
      <p className="role-card__desc">{description}</p>
      <span className="role-card__cta">
        {cta} <span aria-hidden="true">→</span>
      </span>
    </Link>
  );
}
