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

const themeInitScript = `(function(){try{var t=localStorage.getItem('attendance_theme');if(t){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="purple">
      <body>
        {/* Theme preference paint se pehle apply karo (FOUC avoid karne ke liye). */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {children}
      </body>
    </html>
  );
}

