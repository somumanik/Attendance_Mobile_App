import Link from 'next/link';
import ApiHealthCheck from '../../components/ApiHealthCheck';

export default function HealthPage() {
  return (
    <main className="page">
      <header className="hero">
        <h1 className="hero__title">Backend status</h1>
        <p className="hero__sub">
          <Link className="auth__back" href="/login">← Back to login</Link>
        </p>
      </header>
      <section className="panel">
        <ApiHealthCheck />
      </section>
    </main>
  );
}
