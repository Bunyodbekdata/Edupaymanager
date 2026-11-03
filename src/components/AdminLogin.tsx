import React, { useState } from 'react';
import { Lock, Mail, ArrowLeft, AlertTriangle, Eye, EyeOff, KeyRound, ShieldAlert } from 'lucide-react';
import { AdminUser } from '../types/edupay';

interface AdminLoginProps {
  onLoginSuccess: (token: string, admin: AdminUser) => void;
  onBackToPublic: () => void;
  redirectedFrom?: string | null;
}

export const AdminLogin: React.FC<AdminLoginProps> = ({
  onLoginSuccess,
  onBackToPublic,
  redirectedFrom,
}) => {
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [mfaCode, setMfaCode] = useState<string>('');
  const [mfaRequired, setMfaRequired] = useState<boolean>(false);
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);

    if (!email.trim() || !password) {
      setError('Iltimos, elektron pochta va parolni kiriting.');
      return;
    }

    if (mfaRequired && !/^\d{6}$/.test(mfaCode.trim())) {
      setError('Iltimos, 6 xonali ikki bosqichli tasdiqlash (2FA) kodini kiriting.');
      return;
    }

    setLoading(true);
    try {
      const payload: Record<string, string> = {
        email: email.trim(),
        password,
      };
      if (mfaRequired && mfaCode.trim()) {
        payload.mfa_code = mfaCode.trim();
      }

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (res.ok && data.mfaRequired) {
        setMfaRequired(true);
        setLoading(false);
        return;
      }

      if (!res.ok) {
        setError(data.error || "Elektron pochta yoki parol noto'g'ri.");
        setLoading(false);
        return;
      }

      onLoginSuccess(data.token, data.admin);
    } catch {
      setError("Server bilan bog'lanishda xatolik yuz berdi.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <header className="w-full bg-white border-b border-slate-200 px-4 sm:px-8 py-3.5 flex items-center justify-between">
        <button
          type="button"
          onClick={onBackToPublic}
          className="text-sm font-medium text-slate-600 hover:text-slate-900 flex items-center gap-2 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>O&apos;quvchi sahifasiga qaytish</span>
        </button>

        <span className="text-sm font-bold text-slate-900">EduPay Manager</span>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="space-y-2 text-center">
            <div className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center mx-auto">
              <Lock className="w-5 h-5" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
              Administrator tizimga kirishi
            </h1>
            <p className="text-xs sm:text-sm text-slate-500">
              Boshqaruv paneliga kirish faqat vakolatli o&apos;quv markazi administratori uchun ruxsat etilgan.
            </p>
          </div>

          {redirectedFrom && !error && (
            <div
              role="alert"
              data-testid="protected-route-notice"
              className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs sm:text-sm flex items-start gap-2.5"
            >
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
              <span>
                Himoyalangan bo&apos;limga ({redirectedFrom}) kirish rad etildi. Davom etish uchun administrator sifatida tizimga kiring.
              </span>
            </div>
          )}

          {error && (
            <div
              role="alert"
              data-testid="login-error-alert"
              className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs sm:text-sm flex items-start gap-2.5"
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <label htmlFor="admin-email" className="block text-sm font-semibold text-slate-800">
                Elektron pochta (Login)
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="admin-email"
                  type="email"
                  required
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Masalan: admin@markaz.uz"
                  className="w-full pl-10 pr-4 py-3 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="admin-password" className="block text-sm font-semibold text-slate-800">
                Maxfiy parol
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="admin-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-10 py-3 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Parolni yashirish' : "Parolni ko'rsatish"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {mfaRequired && (
              <div className="space-y-1.5 pt-1">
                <label htmlFor="admin-mfa-code" className="block text-sm font-semibold text-slate-800">
                  2-bosqichli himoya kodi (6 xonali TOTP)
                </label>
                <input
                  id="admin-mfa-code"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  placeholder="000000"
                  className="w-full px-4 py-3 bg-white border border-slate-300 rounded-xl text-sm font-mono tracking-widest text-center text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-5 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white font-semibold text-sm rounded-xl transition-colors cursor-pointer"
            >
              {loading ? 'Tekshirilmoqda...' : 'Tizimga kirish'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
};
