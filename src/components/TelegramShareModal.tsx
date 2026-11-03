import React, { useState, useMemo } from 'react';
import { Send, Copy, Check, QrCode, X, ExternalLink, KeyRound } from 'lucide-react';
import { CollectionPeriod } from '../types/edupay';
import { generateQrCodeMatrix } from '../utils/qrCode';

interface TelegramShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  activePeriod: CollectionPeriod | null;
  studentAccessCode?: string;
}

export const TelegramShareModal: React.FC<TelegramShareModalProps> = ({
  isOpen,
  onClose,
  activePeriod,
  studentAccessCode = 'EDU-2026',
}) => {
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [embedCodeInUrl, setEmbedCodeInUrl] = useState(true);

  const basePublicUrl = useMemo(() => {
    if (typeof window === 'undefined') return 'http://localhost:3000/';
    return `${window.location.origin}/`;
  }, []);

  const publicUrl = useMemo(() => {
    if (embedCodeInUrl && studentAccessCode) {
      return `${basePublicUrl}?code=${encodeURIComponent(studentAccessCode)}`;
    }
    return basePublicUrl;
  }, [basePublicUrl, embedCodeInUrl, studentAccessCode]);

  const qrMatrix = useMemo(() => generateQrCodeMatrix(publicUrl), [publicUrl]);
  const qrSize = qrMatrix.length;

  if (!isOpen) return null;

  const shareText = activePeriod
    ? `Hurmatli o'quvchilar! ${activePeriod.title} oyi uchun oylik to'lov sanangizni quyidagi havola orqali kiriting (O'quvchi kirish kodi: ${studentAccessCode}):`
    : `Hurmatli o'quvchilar! Oylik to'lov sanangizni quyidagi havola orqali kiriting (O'quvchi kirish kodi: ${studentAccessCode}):`;

  const telegramShareUrl = `https://t.me/share/url?url=${encodeURIComponent(
    publicUrl
  )}&text=${encodeURIComponent(shareText)}`;

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2500);
    } catch {
      const input = document.createElement('input');
      input.value = publicUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2500);
    }
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(studentAccessCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2500);
    } catch {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2500);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="telegram-share-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
    >
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-xl">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center">
              <Send className="w-4 h-4" />
            </div>
            <div>
              <h2 id="telegram-share-title" className="text-base font-bold text-slate-900">
                Telegramga ulashish va QR kod
              </h2>
              <p className="text-xs text-slate-500">
                Haqiqiy skanerlanadigan ISO/IEC 18004 QR kod va o&apos;quvchi kirish kodi
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Oynani yopish"
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Active Student Access Code Box */}
        <div className="p-3 bg-sky-50/70 border border-sky-200 rounded-xl flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <KeyRound className="w-4 h-4 text-sky-700 shrink-0" />
            <div>
              <div className="text-[11px] text-slate-500">O&apos;quvchi kirish kodi:</div>
              <div className="text-sm font-mono font-bold text-slate-900 tracking-wider">
                {studentAccessCode}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCopyCode}
            className="px-3 py-1.5 bg-white border border-sky-200 hover:bg-sky-50 text-sky-900 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
          >
            {copiedCode ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span>Nusxalandi</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Kodni nusxalash</span>
              </>
            )}
          </button>
        </div>

        {/* Public Link Copy Box */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-semibold text-slate-700">
              O&apos;quvchilar uchun umumiy havola:
            </label>
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={embedCodeInUrl}
                onChange={(e) => setEmbedCodeInUrl(e.target.checked)}
                className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
              />
              <span>Havolaga kodni qo&apos;shish</span>
            </label>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={publicUrl}
              aria-label="Umumiy havola"
              className="flex-1 px-3 py-2.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-xl text-slate-700"
            />
            <button
              type="button"
              onClick={handleCopyUrl}
              className="px-3.5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
            >
              {copiedUrl ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Nusxalandi!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Nusxa olish</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Real ISO/IEC 18004 QR Code SVG with 4-module quiet zone */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col items-center space-y-2.5">
          <div className="bg-white p-3 rounded-xl border border-slate-200">
            <svg
              viewBox={`-2 -2 ${qrSize + 4} ${qrSize + 4}`}
              className="w-40 h-40 text-slate-900"
              shapeRendering="crispEdges"
              role="img"
              aria-label="O'quvchilar sahifasi QR kodi"
            >
              <rect x={-2} y={-2} width={qrSize + 4} height={qrSize + 4} fill="#ffffff" />
              {qrMatrix.map((row, rIdx) =>
                row.map((cell, cIdx) =>
                  cell ? (
                    <rect
                      key={`${rIdx}-${cIdx}`}
                      x={cIdx}
                      y={rIdx}
                      width={1}
                      height={1}
                      fill="currentColor"
                    />
                  ) : null
                )
              )}
            </svg>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-600 text-center">
            <QrCode className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span>O&apos;quvchilar telefon kamerasi orqali skanerlashi uchun haqiqiy QR kod</span>
          </div>
        </div>

        {/* Direct Telegram Share Action */}
        <div className="flex flex-col sm:flex-row items-center gap-2.5 pt-1">
          <a
            href={telegramShareUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full py-2.5 px-4 bg-sky-600 hover:bg-sky-700 text-white text-xs sm:text-sm font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors"
          >
            <Send className="w-4 h-4" />
            <span>Telegram guruhlarga yuborish</span>
            <ExternalLink className="w-3.5 h-3.5 opacity-80" />
          </a>
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto py-2.5 px-4 border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs sm:text-sm font-medium rounded-xl transition-colors"
          >
            Yopish
          </button>
        </div>
      </div>
    </div>
  );
};
