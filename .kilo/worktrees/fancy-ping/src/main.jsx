import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import '@fortawesome/fontawesome-free/css/all.min.css';
import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/plus-jakarta-sans/800.css';

createRoot(document.getElementById('react-root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);