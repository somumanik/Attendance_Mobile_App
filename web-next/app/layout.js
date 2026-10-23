import './globals.css';
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

const themeInitScript = `(function(){try{var t=localStorage.getItem('attendance_theme');document.documentElement.setAttribute('data-theme',t||'purple');}catch(e){document.documentElement.setAttribute('data-theme','purple');}})();`;

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {/* Theme preference ko paint se pehle apply karo (FOUC avoid). data-theme
            deliberately React ke JSX me NAHI hai — isse server HTML aur pehla client
            render match karte hain (hydration mismatch nahi), aur theme ka single
            source of truth localStorage (fallback: purple) rehta hai. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {children}
      </body>
    </html>
  );
}

