import React, { useState, useEffect, useCallback } from 'react';
import { ShieldAlert, ArrowLeft } from 'lucide-react';
import { AdminUser } from './types/edupay';
import { PublicStudentForm } from './components/PublicStudentForm';
import { AdminLogin } from './components/AdminLogin';
import {
  ADMIN_SECTION_PATHS,
  AdminDashboardShell,
  AdminSectionId,
  resolveAdminSectionFromPath,
} from './components/AdminDashboardShell';

function normalizePath(pathname: string): string {
  const cleaned = pathname.replace(/\/+$/, '');
  return cleaned || '/';
}

function isProtectedAdminRoute(pathname: string): boolean {
  const p = normalizePath(pathname);
  return p === '/admin' || (p.startsWith('/admin/') && p !== '/admin/login');
}

export default function App() {
  const [currentPath, setCurrentPath] = useState<string>(() =>
    typeof window !== 'undefined' ? normalizePath(window.location.pathname) : '/'
  );
  const [redirectedFrom, setRedirectedFrom] = useState<string | null>(null);

  const [authToken, setAuthToken] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return window.sessionStorage.getItem('edupay_admin_token');
    }
    return null;
  });

  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [verifyingAuth, setVerifyingAuth] = useState<boolean>(() => Boolean(authToken));

  const navigateTo = useCallback((path: string, replace = false) => {
    const normalized = normalizePath(path);
    if (typeof window !== 'undefined') {
      if (replace) {
        window.history.replaceState({}, '', normalized);
      } else {
        window.history.pushState({}, '', normalized);
      }
    }
    setCurrentPath(normalized);
  }, []);

  // Listen to browser back/forward navigation and Ctrl+Shift+A / Alt+A admin shortcut
  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(normalizePath(window.location.pathname));
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a') || (e.altKey && e.key.toLowerCase() === 'a')) {
        e.preventDefault();
        navigateTo('/admin/login');
      }
    };
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [navigateTo]);

  // Verify stored token against authoritative server endpoint (/api/auth/me)
  useEffect(() => {
    if (!authToken) {
      setAdminUser(null);
      setVerifyingAuth(false);
      return;
    }

    let cancelled = false;
    setVerifyingAuth(true);
    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Unauthorized'))))
      .then((data) => {
        if (cancelled) return;
        if (data?.admin) {
          setAdminUser(data.admin);
        } else {
          throw new Error('No admin');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setAuthToken(null);
        setAdminUser(null);
        if (typeof window !== 'undefined') {
          window.sessionStorage.removeItem('edupay_admin_token');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setVerifyingAuth(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authToken]);

  // Enforce route guard: unauthenticated visits to /admin* must redirect to /admin/login
  useEffect(() => {
    if (verifyingAuth) return;
    if (isProtectedAdminRoute(currentPath) && (!authToken || !adminUser)) {
      setRedirectedFrom(currentPath);
      navigateTo('/admin/login', true);
    }
  }, [currentPath, authToken, adminUser, verifyingAuth, navigateTo]);

  const handleLoginSuccess = (token: string, admin: AdminUser) => {
    setAuthToken(token);
    setAdminUser(admin);
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem('edupay_admin_token', token);
    }
    const destination =
      redirectedFrom && isProtectedAdminRoute(redirectedFrom) ? redirectedFrom : '/admin';
    setRedirectedFrom(null);
    navigateTo(destination, true);
  };

  const handleLogout = async () => {
    if (authToken) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
        });
      } catch {
        // ignore network error on logout
      }
    }
    setAuthToken(null);
    setAdminUser(null);
    setRedirectedFrom(null);
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem('edupay_admin_token');
    }
    navigateTo('/', true);
  };

  const handleNavigateAdminSection = (section: AdminSectionId) => {
    const targetPath = ADMIN_SECTION_PATHS[section] || '/admin';
    navigateTo(targetPath);
  };

  // While verifying an existing session token on a protected route, render a minimal neutral check screen (never confidential data)
  if (verifyingAuth && (currentPath.startsWith('/admin') || isProtectedAdminRoute(currentPath))) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-600 text-sm">
        <span>Xavfsizlik sessiyasi tekshirilmoqda...</span>
      </div>
    );
  }

  // Route: /admin/login (or unauthenticated access to any /admin* route prior to effect redirect)
  if (currentPath === '/admin/login' || (isProtectedAdminRoute(currentPath) && (!authToken || !adminUser))) {
    if (authToken && adminUser && adminUser.app_metadata?.role === 'admin' && currentPath === '/admin/login') {
      const activeSection = resolveAdminSectionFromPath('/admin');
      return (
        <AdminDashboardShell
          token={authToken}
          initialAdmin={adminUser}
          activeSection={activeSection}
          onNavigateSection={handleNavigateAdminSection}
          onLogout={handleLogout}
          onSwitchToPublicView={() => navigateTo('/')}
        />
      );
    }

    return (
      <AdminLogin
        onLoginSuccess={handleLoginSuccess}
        onBackToPublic={() => {
          setRedirectedFrom(null);
          navigateTo('/');
        }}
        redirectedFrom={redirectedFrom || (isProtectedAdminRoute(currentPath) ? currentPath : null)}
      />
    );
  }

  // Protected Admin Routes: /admin, /admin/students, /admin/teachers, /admin/groups, /admin/collections, /admin/reports, /admin/settings
  if (isProtectedAdminRoute(currentPath) && authToken && adminUser) {
    // Strict server-controlled role check: app_metadata.role MUST equal 'admin'
    if (adminUser.app_metadata?.role !== 'admin') {
      return (
        <div
          data-testid="access-denied-screen"
          className="min-h-screen flex items-center justify-center bg-slate-50 px-4"
        >
          <div className="max-w-md w-full bg-white border border-red-200 rounded-2xl p-6 sm:p-8 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold text-slate-900">Kirish rad etildi (403)</h1>
            <p className="text-sm text-slate-600">
              Sizning hisobingizda server tomonidan tasdiqlangan administrator huquqi mavjud emas.
            </p>
            <button
              type="button"
              onClick={() => navigateTo('/')}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white text-sm font-semibold rounded-xl hover:bg-slate-800 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Bosh sahifaga qaytish</span>
            </button>
          </div>
        </div>
      );
    }

    const activeSection = resolveAdminSectionFromPath(currentPath);
    return (
      <AdminDashboardShell
        token={authToken}
        initialAdmin={adminUser}
        activeSection={activeSection}
        onNavigateSection={handleNavigateAdminSection}
        onLogout={handleLogout}
        onSwitchToPublicView={() => navigateTo('/')}
      />
    );
  }

  // Public Student Submission Route: /
  return <PublicStudentForm onSecretTrigger={() => navigateTo('/admin/login')} />;
}
