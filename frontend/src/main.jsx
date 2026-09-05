import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './auth/AuthContext.jsx';
import { ToastProvider } from './components/ui/Toast.jsx';
import { restore } from './theme.js';
import './index.css';

restore(); // html.dark / html.light from localStorage, before the first render

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
