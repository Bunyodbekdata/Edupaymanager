import React, { useState } from 'react';
import {
  Shield,
  KeyRound,
  User,
  History,
  CheckCircle2,
  AlertTriangle,
  Smartphone,
  ShieldCheck,
} from 'lucide-react';
import { AdminUser, AuditLog } from '../types/edupay';
import { formatDateTimeUz } from '../utils/edupayLogic';

interface SettingsViewProps {
  token: string;
  admin: AdminUser;
  auditLogs: AuditLog[];
  onRefresh: () => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  token,
  admin,
  auditLogs,
  onRefresh,
}) => {
  const [fullName, setFullName] = useState(admin.full_name);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Optional TOTP MFA state
  const [mfaSecret, setMfaSecret] = useState<string | null>(null);
  const [mfaDemoCode, setMfaDemoCode] = useState<string | null>(null);
  const [mfaVerifyCode, setMfaVerifyCode] = useState<string>('');
  const [mfaLoading, setMfaLoading] = useState<boolean>(false);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      const payload: Record<string, string> = {
        full_name: fullName.trim(),
      };
      if (currentPassword) payload.current_password = currentPassword;
      if (newPassword) payload.new_password = newPassword;

      const res = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Saqlashda xatolik yuz berdi.');
        setSaving(false);
        return;
      }

      setCurrentPassword('');
      setNewPassword('');
      setMessage("Administrator profil ma'lumotlari muvaffaqiyatli yangilandi.");
      await onRefresh();
    } catch {
      setError("Server bilan bog'lanishda xatolik yuz berdi.");
    } finally {
      setSaving(false);
    }
  };

  const handleStartMfaSetup = async () => {
    setMfaLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/auth/mfa/setup', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '2FA sozlashda xatolik.');
        return;
      }
      setMfaSecret(data.secret);
      setMfaDemoCode(data.currentCode);
      setMfaVerifyCode(data.currentCode || '');
    } catch {
      setError("Server bilan bog'lanishda xatolik.");
    } finally {
      setMfaLoading(false);
    }
  };

  const handleEnableMfa = async () => {
    if (!mfaVerifyCode.trim()) return;
    setMfaLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/mfa/enable', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code: mfaVerifyCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Tasdiqlash kodi noto'g'ri.");
        return;
      }
      setMfaSecret(null);
      setMfaDemoCode(null);
      setMfaVerifyCode('');
      setMessage('2-bosqichli himoya (TOTP MFA) muvaffaqiyatli yoqildi.');
      await onRefresh();
    } catch {
      setError("Server bilan bog'lanishda xatolik.");
    } finally {
      setMfaLoading(false);
    }
  };

  const handleDisableMfa = async () => {
    setMfaLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/mfa/disable', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setMfaSecret(null);
        setMessage("2-bosqichli himoya (TOTP MFA) o'chirildi.");
        await onRefresh();
      }
    } catch {
      setError("Server bilan bog'lanishda xatolik.");
    } finally {
      setMfaLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
          Tizim sozlamalari va xavfsizlik auditi
        </h1>
        <p className="text-sm text-slate-500">
          Administrator profilini yangilash, parol va 2FA himoyasi hamda barcha tizim amallari tarixi (Audit Log)
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Profile & Security Column */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-slate-800 shrink-0" />
                <h2 className="text-base font-bold text-slate-900">Administrator hisobi</h2>
              </div>
              <span className="text-[11px] font-mono font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                role: {admin.app_metadata?.role || 'admin'}
              </span>
            </div>

            {message && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{message}</span>
              </div>
            )}

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-600">
                  Elektron pochta (Login)
                </label>
                <input
                  type="email"
                  readOnly
                  value={admin.email}
                  className="w-full px-3.5 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-sm text-slate-600 font-mono"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="admin-fullname-input"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Administrator F.I.Sh.
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="admin-fullname-input"
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full pl-10 pr-3.5 py-2.5 border border-slate-300 rounded-xl text-sm"
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 space-y-3">
                <div className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-slate-500" />
                  <span>Parolni yangilash (ixtiyoriy)</span>
                </div>

                <div className="space-y-1">
                  <label htmlFor="current-pass" className="block text-xs text-slate-600">
                    Joriy parol
                  </label>
                  <input
                    id="current-pass"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-sm"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="new-pass" className="block text-xs text-slate-600">
                    Yangi parol (kamida 8 ta belgi)
                  </label>
                  <input
                    id="new-pass"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-sm"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={saving}
                className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold rounded-xl transition-colors cursor-pointer"
              >
                {saving ? 'Saqlanmoqda...' : "O'zgarishlarni saqlash"}
              </button>
            </form>
          </div>

          {/* Optional TOTP 2FA Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-slate-700" />
                <h2 className="text-sm font-bold text-slate-900">
                  Ikki bosqichli himoya (TOTP 2FA)
                </h2>
              </div>
              <span
                className={`text-xs font-semibold px-2.5 py-0.5 rounded-md border ${
                  admin.mfa_enabled
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-slate-100 text-slate-600 border-slate-200'
                }`}
              >
                {admin.mfa_enabled ? 'Yoqilgan' : "O'chirilgan"}
              </span>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Google Authenticator yoki boshqa TOTP ilovasi orqali administrator hisobini qo&apos;shimcha 6 xonali kod bilan himoyalash.
            </p>

            {admin.mfa_enabled ? (
              <button
                type="button"
                disabled={mfaLoading}
                onClick={handleDisableMfa}
                className="w-full py-2 px-4 border border-red-200 text-red-700 hover:bg-red-50 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                2-bosqichli himoyani o&apos;chirish
              </button>
            ) : mfaSecret ? (
              <div className="space-y-3 bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs">
                <div>
                  <span className="text-slate-500 block">Maxfiy kalit (Base32):</span>
                  <code className="font-mono font-bold text-slate-900 break-all">{mfaSecret}</code>
                </div>
                {mfaDemoCode && (
                  <div>
                    <span className="text-slate-500 block">Joriy vaqt kodi (TOTP):</span>
                    <code className="font-mono font-bold text-sky-700">{mfaDemoCode}</code>
                  </div>
                )}
                <div className="space-y-1">
                  <label htmlFor="mfa-verify-input" className="block font-semibold text-slate-700">
                    6 xonali tasdiqlash kodi
                  </label>
                  <input
                    id="mfa-verify-input"
                    type="text"
                    maxLength={6}
                    value={mfaVerifyCode}
                    onChange={(e) => setMfaVerifyCode(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg font-mono text-sm"
                  />
                </div>
                <button
                  type="button"
                  disabled={mfaLoading}
                  onClick={handleEnableMfa}
                  className="w-full py-2 px-4 bg-sky-600 hover:bg-sky-700 text-white font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  Tasdiqlash va yoqish
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={mfaLoading}
                onClick={handleStartMfaSetup}
                className="w-full py-2 px-4 border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-semibold rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <ShieldCheck className="w-4 h-4 text-sky-600" />
                <span>2FA (TOTP) himoyani sozlash</span>
              </button>
            )}
          </div>
        </div>

        {/* Audit Logs Table */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <History className="w-5 h-5 text-slate-700" />
              <h2 className="text-base font-bold text-slate-900">
                Xavfsizlik va administrator amallari tarixi (Audit Log)
              </h2>
            </div>
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              Oxirgi {auditLogs.length} ta yozuv
            </span>
          </div>

          <div className="max-h-[540px] overflow-y-auto border border-slate-200 rounded-xl">
            <table className="w-full text-left border-collapse text-xs table-fixed">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                  <th className="py-2.5 px-3 w-32">Vaqt</th>
                  <th className="py-2.5 px-3 w-36">Admin</th>
                  <th className="py-2.5 px-3 w-48">Amal turi / Obyekt</th>
                  <th className="py-2.5 px-3">Tafsilotlar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50 align-top">
                    <td className="py-2.5 px-3 font-mono text-slate-500 tabular-nums whitespace-nowrap">
                      {formatDateTimeUz(log.created_at)}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-600 truncate">
                      <div className="font-semibold text-slate-800 truncate">{log.admin_user_id}</div>
                      <div className="text-[11px] text-slate-400 truncate">{log.admin_email}</div>
                    </td>
                    <td className="py-2.5 px-3 font-mono">
                      <div className="font-semibold text-slate-800 break-all">{log.action}</div>
                      {log.affected_record_id && (
                        <div className="text-[11px] text-slate-400 truncate">
                          ID: {log.affected_record_id}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-slate-700 break-words">{log.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
