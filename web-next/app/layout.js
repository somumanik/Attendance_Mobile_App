import './globals.css';
import ThemeSync from '../components/ThemeSync';
import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/plus-jakarta-sans/800.css';
import '@fortawesome/fontawesome-free/css/all.min.css';

export const metadata = {
  title: 'Attendance Website',
  description: 'Savior Attendance website (Next.js). Existing Express backend aur mobile app unchanged hain.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {/* Theme preference hydration-safe apply: data-theme deliberately React ke
            JSX me NAHI hai aur koi pre-hydration inline <script> bhi nahi — isse
            server HTML aur pehla client render bilkul match karte hain (koi
            hydration mismatch nahi). Saved theme ko hydration ke BAAD ThemeSync
            apply karta hai (localStorage, fallback: purple), aur :root default se
            pehla paint styled rehta hai. */}
        <ThemeSync />
        {children}
      </body>
    </html>
  );
}

