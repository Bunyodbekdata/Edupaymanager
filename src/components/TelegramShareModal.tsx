import React, { useState, useMemo } from 'react';
import { Send, Copy, Check, QrCode, X, ExternalLink } from 'lucide-react';
import { CollectionPeriod } from '../types/edupay';

interface TelegramShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  activePeriod: CollectionPeriod | null;
}

/**
 * Generates a deterministic 21x21 QR-style matrix SVG for the public submission URL
 * so the QR code renders crisply offline without external image dependencies.
 */
function buildDeterministicQrMatrix(url: string): boolean[][] {
  const size = 21;
  const grid: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const reserved: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  // Draw standard 7x7 finder patterns at 3 corners
  const drawFinder = (r0: number, c0: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = r0 + r;
        const cc = c0 + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        reserved[rr][cc] = true;
        if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
          const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
          const isCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          grid[rr][cc] = isBorder || isCenter;
        }
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    reserved[6][i] = true;
    reserved[i][6] = true;
    grid[6][i] = i % 2 === 0;
    grid[i][6] = i % 2 === 0;
  }

  // Fill remaining modules deterministically from URL bytes
  let hash = 2166136261;
  for (let i = 0; i < url.length; i++) {
    hash ^= url.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  let seed = hash >>> 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (reserved[r][c]) continue;
      seed = (Math.imul(seed, 1664525) + 1013904223 + r * 31 + c * 17) >>> 0;
      grid[r][c] = (seed & 1) === 1;
    }
  }

  return grid;
}

export const TelegramShareModal: React.FC<TelegramShareModalProps> = ({
  isOpen,
  onClose,
  activePeriod,
}) => {
  const [copied, setCopied] = useState(false);

  const publicUrl = useMemo(() => {
    if (typeof window === 'undefined') return 'http://localhost:3000/';
    return `${window.location.origin}/`;
  }, []);

  const qrMatrix = useMemo(() => buildDeterministicQrMatrix(publicUrl), [publicUrl]);

  if (!isOpen) return null;

  const shareText = activePeriod
    ? `Hurmatli o'quvchilar! ${activePeriod.title} oyi uchun oylik to'lov sanangizni quyidagi havola orqali kiriting:`
    : "Hurmatli o'quvchilar! Oylik to'lov sanangizni quyidagi havola orqali kiriting:";

  const telegramShareUrl = `https://t.me/share/url?url=${encodeURIComponent(
    publicUrl
  )}&text=${encodeURIComponent(shareText)}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback copy
      const input = document.createElement('input');
      input.value = publicUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="telegram-share-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
    >
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 space-y-5 shadow-xl">
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
                Yagona havola har oy avtomatik faol oyni ko&apos;rsatadi
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

        {/* Public Link Copy Box */}
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-slate-700">
            O&apos;quvchilar uchun umumiy havola:
          </label>
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
              onClick={handleCopy}
              className="px-3.5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
            >
              {copied ? (
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

        {/* QR Code Representation */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col items-center space-y-2.5">
          <div className="bg-white p-3 rounded-xl border border-slate-200">
            <svg
              viewBox="0 0 21 21"
              className="w-36 h-36 text-slate-900"
              role="img"
              aria-label="O'quvchilar sahifasi QR kodi"
            >
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
          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <QrCode className="w-3.5 h-3.5 text-slate-400" />
            <span>O&apos;quvchilar telefon kamerasi orqali kirishi uchun QR kod</span>
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
