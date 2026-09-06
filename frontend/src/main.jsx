import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './auth/AuthContext.jsx';
import { ToastProvider } from './components/ui/Toast.jsx';
import { restore } from './theme.js';
import { picklists } from './utils/picklists.js';
import './index.css';

restore(); // html.dark / html.light from localStorage, before the first render

// Warm the picklists the moment the app opens: the response also carries the company's timezone,
// which every rendered punch time needs — without this, a page that renders before any form has
// asked for picklists (Attendance first thing after login) would format times in the viewer's
// own zone instead of the company's.
picklists().catch(() => {});

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* the two v7 flags are opted into now so the console stays clean and the upgrade is a version bump */}
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ToastProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
