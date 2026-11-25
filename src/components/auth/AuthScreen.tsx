import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  ExternalLink,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Globe,
  KeyRound,
  Loader2,
  Lock,
  Play,
  QrCode,
  Smartphone,
  Trash2,
} from 'lucide-react';
import type {
  ApiCredentials,
  AuthStep,
  LanguageCode,
  NetworkConfig,
  SessionPersistenceMode,
} from '../../types/analytics';
import { getTranslations } from '../../i18n/translations';
import { MIN_VAULT_PIN_LENGTH, normalizePinDigits } from '../../utils/cryptoVault';
import { BrandLogo } from '../common/BrandLogo';
import { PasswordField } from '../common/PasswordField';

interface AuthScreenProps {
  lang: LanguageCode;
  onToggleLang: () => void;
  network: NetworkConfig;
  onOpenNetworkModal: () => void;
  apiCreds: ApiCredentials;
  onChangeApiCreds: (creds: ApiCredentials) => void;
  persistenceMode: SessionPersistenceMode;
  vaultPin: string;
  onChangePersistence: (mode: SessionPersistenceMode, pin: string) => void;
  savedSessionMeta: { exists: boolean; hasPin: boolean };
  onUnlockSavedSession: (pin?: string) => Promise<void>;
  onDiscardSavedSession: () => Promise<void>;
  authStep: AuthStep;
  authError: string | null;
  forceShowApiBox?: boolean;
  qrUrl: string | null;
  qrExpiresAt?: number | null;
  onStartQr: () => Promise<void>;
  onSendCode: (phone: string) => Promise<void>;
  onVerifyCode: (code: string) => Promise<void>;
  onCheckPassword: (password: string) => Promise<void>;
  onResetAuth: () => void;
  onEnterSampleMode: () => void;
}

const PREVIEW_DAYS = [
  {
    totalShares: 13,
    totalViews: 1010,
    rows: [
      { id: 529, shares: 7, pct: 54, pub: 0, priv: 7 },
      { id: 514, shares: 4, pct: 31, pub: 1, priv: 3 },
      { id: 498, shares: 2, pct: 15, pub: 0, priv: 2 },
    ],
  },
  {
    totalShares: 24,
    totalViews: 1430,
    rows: [
      { id: 514, shares: 14, pct: 58, pub: 2, priv: 12 },
      { id: 498, shares: 7, pct: 29, pub: 1, priv: 6 },
      { id: 480, shares: 2, pct: 8, pub: 0, priv: 2 },
      { id: 529, shares: 1, pct: 4, pub: 0, priv: 1 },
    ],
  },
  {
    totalShares: 23,
    totalViews: 1872,
    rows: [
      { id: 540, shares: 16, pct: 70, pub: 2, priv: 14 },
      { id: 514, shares: 5, pct: 22, pub: 0, priv: 5 },
      { id: 498, shares: 2, pct: 9, pub: 0, priv: 2 },
    ],
  },
] as const;

export const AuthScreen: React.FC<AuthScreenProps> = React.memo(({
  lang,
  onToggleLang,
  network,
  onOpenNetworkModal,
  apiCreds,
  onChangeApiCreds,
  persistenceMode,
  vaultPin,
  onChangePersistence,
  savedSessionMeta,
  onUnlockSavedSession,
  onDiscardSavedSession,
  authStep,
  authError,
  forceShowApiBox = false,
  qrUrl,
  qrExpiresAt = null,
  onStartQr,
  onSendCode,
  onVerifyCode,
  onCheckPassword,
  onResetAuth,
  onEnterSampleMode,
}) => {
  const t = getTranslations(lang);
  const [loginMethod, setLoginMethod] = useState<'qr' | 'phone'>('qr');
  const [showApiBox, setShowApiBox] = useState(() => !Boolean(apiCreds.apiId && apiCreds.apiHash));
  const [phoneInput, setPhoneInput] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [unlockPinInput, setUnlockPinInput] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewDayIdx, setPreviewDayIdx] = useState(1);
  const [qrSecondsLeft, setQrSecondsLeft] = useState<number | null>(null);
  const [apiCredsMissingAttempt, setApiCredsMissingAttempt] = useState(false);
  const apiIdRef = useRef<HTMLInputElement | null>(null);
  const focusTimeoutRef = useRef<number | null>(null);

  const scheduleApiIdFocus = () => {
    if (focusTimeoutRef.current !== null) {
      window.clearTimeout(focusTimeoutRef.current);
    }
    focusTimeoutRef.current = window.setTimeout(() => {
      focusTimeoutRef.current = null;
      apiIdRef.current?.focus();
    }, 60);
  };

  useEffect(() => {
    return () => {
      if (focusTimeoutRef.current !== null) {
        window.clearTimeout(focusTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (forceShowApiBox) {
      setShowApiBox(true);
      scheduleApiIdFocus();
    }
  }, [forceShowApiBox]);

  useEffect(() => {
    if (!qrExpiresAt || !qrUrl) {
      setQrSecondsLeft(null);
      return;
    }
    const updateLeft = () => {
      setQrSecondsLeft(Math.max(0, Math.ceil((qrExpiresAt - Date.now()) / 1000)));
    };
    updateLeft();
    const timer = setInterval(updateLeft, 1000);
    return () => clearInterval(timer);
  }, [qrExpiresAt, qrUrl]);

  useEffect(() => {
    if (!qrUrl) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    import('qrcode')
      .then((mod) =>
        mod.default.toDataURL(qrUrl, {
          width: 212,
          margin: 2,
          color: { dark: '#090C10', light: '#FFFFFF' },
        }),
      )
      .then((dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [qrUrl]);

  const networkLabel =
    network.mode === 'direct'
      ? t.modeDirect
      : network.mode === 'socks5-bridge'
        ? `${t.modeSocks5} (${network.socks5.host}:${network.socks5.port})`
        : t.modeCfRelay;

  const hasApiCreds = Boolean(apiCreds.apiId > 0 && apiCreds.apiHash && apiCreds.apiHash.trim().length >= 16);
  const activePreview = PREVIEW_DAYS[previewDayIdx];
  const activePreviewLabel = t.previewCard.previewDaysLabels[previewDayIdx];
  const normalizedVaultPin = normalizePinDigits(vaultPin);
  const isPinTooShort =
    normalizedVaultPin.length > 0 && normalizedVaultPin.length < MIN_VAULT_PIN_LENGTH;
  const isPinTooWeak =
    normalizedVaultPin.length >= MIN_VAULT_PIN_LENGTH &&
    new Set(Array.from(normalizedVaultPin)).size <= 1;

  const apiCredsFallbackError =
    apiCredsMissingAttempt && !hasApiCreds
      ? apiCreds.apiId > 0 && apiCreds.apiHash.trim().length > 0
        ? t.apiIdInvalidError
        : t.apiCredsRequiredError
      : null;

  const handleAction = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen telescope-canvas text-[#F0F4F8] flex flex-col">
      {/* Frosted Sticky Header Bar (Strict 3-zone top bar) */}
      <header className="sticky top-0 z-30 tg-chrome-glass border-b">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-14 flex items-center justify-between gap-6">
          <div className="flex items-center gap-2.5 shrink-0">
            <BrandLogo size={28} />
            <span className="text-[15px] font-semibold tracking-tight whitespace-nowrap shrink-0">
              {t.appName}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onOpenNetworkModal}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#11161D]/80 px-3 py-1.5 text-xs font-medium text-[#8B9BB0] hover:text-[#F0F4F8] hover:border-white/20 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5 text-[#2AABEE]" aria-hidden="true" />
              <span>{t.networkSettingsBtn}</span>
            </button>

            <button
              type="button"
              onClick={onToggleLang}
              className="rounded-lg border border-white/10 bg-[#11161D]/80 px-3 py-1.5 text-xs font-medium text-[#F0F4F8] hover:bg-white/[0.08] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {t.switchLang}
            </button>
          </div>
        </div>
      </header>

      {/* 1440px Asymmetric Telemetry Workbench */}
      <main className="flex-1 flex items-center px-4 sm:px-6 py-6 lg:py-8">
        <div className="mx-auto w-full max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center">
          {/* Column 1: TeleScope Identity & Interactive Attribution Lens */}
          <div className="lg:col-span-7 space-y-5 order-2 lg:order-1">
            <div className="space-y-2.5 max-w-xl">
              <h1 className="text-2xl sm:text-[28px] font-bold tracking-tight text-[#F0F4F8] leading-snug text-balance">
                {t.authHeadline}
              </h1>
              <p className="text-sm text-[#8B9BB0] leading-relaxed">{t.authSubhead}</p>
            </div>

            {/* Interactive Attribution Lens Preview */}
            <div className="tg-panel rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-3 bg-[#0D1218]/70">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-[#F0F4F8]">
                    {t.previewCard.previewTitle}
                  </span>
                  <span className="rounded-md bg-[#2AABEE]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#5EC2F6]">
                    {t.previewCard.previewBadge}
                  </span>
                </div>
                <div className="flex items-center gap-1 rounded-lg bg-[#090C10] p-1 border border-white/[0.08]">
                  {PREVIEW_DAYS.map((_, idx) => {
                    const dayLabel = t.previewCard.previewDaysLabels[idx];
                    return (
                      <button
                        key={idx}
                        type="button"
                        aria-pressed={idx === previewDayIdx}
                        onClick={() => setPreviewDayIdx(idx)}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-mono-num font-medium transition-colors whitespace-nowrap cursor-pointer ${
                          idx === previewDayIdx
                            ? 'bg-[#2AABEE] text-[#090C10] font-semibold'
                            : 'text-[#8B9BB0] hover:text-[#F0F4F8]'
                        }`}
                      >
                        {dayLabel}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="px-4 py-2.5 border-b border-white/[0.07] flex items-center justify-between text-xs font-mono-num bg-[#0B0F14]/60">
                <span className="text-[#8B9BB0]">
                  {t.previewCard.previewChannel} ({activePreviewLabel})
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-[#22C55E]">
                    {activePreview.totalViews.toLocaleString('en-US')} {t.viewsWord}
                  </span>
                  <span className="text-[#F59E0B] font-semibold">
                    +{activePreview.totalShares} {t.sharesWord}
                  </span>
                </div>
              </div>

              <div className="divide-y divide-white/[0.06]">
                {activePreview.rows.map((row) => (
                  <div
                    key={row.id}
                    className="px-4 py-2.5 flex items-center justify-between gap-4 text-xs hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <span dir="ltr" className="font-mono-num text-[11px] text-[#2AABEE] shrink-0">
                          #{row.id}
                        </span>
                        <span className="text-[#F0F4F8] truncate">
                          {t.previewCard.previewCaption[row.id]}
                        </span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <div className="h-1 flex-1 max-w-[160px] rounded-full bg-white/[0.08] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-[#F59E0B]"
                            style={{ width: `${row.pct}%` }}
                          />
                        </div>
                        <span className="font-mono-num text-[11px] text-[#8B9BB0]">
                          {row.pct}%
                        </span>
                      </div>
                    </div>

                    <div className="text-end font-mono-num shrink-0">
                      <div className="text-[#F59E0B] font-semibold">
                        +{row.shares} {t.previewCard.previewShortShares}
                      </div>
                      <div className="text-[11px] text-[#8596AA]">
                        {t.publicShort} {row.pub} / {t.privateShort} {row.priv}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="px-4 py-3 border-t border-white/[0.08] bg-[#0B0F14]/70 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-[#8B9BB0]">{t.demoExplain}</span>
                <button
                  type="button"
                  onClick={onEnterSampleMode}
                  className="inline-flex items-center gap-2 rounded-lg border border-[#2AABEE]/35 bg-[#2AABEE]/12 px-3.5 py-2 text-xs font-semibold text-[#5EC2F6] hover:bg-[#2AABEE]/20 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{t.exploreSampleBtn}</span>
                  <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-xs text-[#8596AA] flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>{t.zeroBackendBadge}</span>
                <span aria-hidden="true">·</span>
                <span>{t.ephemeralVaultSummary}</span>
              </div>
              <p className="text-[11px] text-[#8596AA] leading-relaxed">{t.mtprotoE2eNote}</p>
            </div>
          </div>

          {/* Column 2: Focused Telegram Sign-In Console */}
          <div className="lg:col-span-5 order-1 lg:order-2 w-full max-w-[460px] mx-auto lg:ms-auto">
            <div className="tg-panel rounded-xl overflow-hidden divide-y divide-white/[0.07]">
              {/* Saved Encrypted Session Unlock Panel */}
              {savedSessionMeta.exists && authStep === 'idle' && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleAction(() => onUnlockSavedSession(unlockPinInput));
                  }}
                  className="p-4 bg-[#2AABEE]/[0.08] space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-[#5EC2F6]">
                      <Lock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>{t.savedSessionFound}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleAction(onDiscardSavedSession)}
                      aria-label={t.discardSavedBtn}
                      className="inline-flex items-center gap-1 text-[11px] text-[#EF4444] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" aria-hidden="true" />
                      <span>{t.discardSavedBtn}</span>
                    </button>
                  </div>

                  {savedSessionMeta.hasPin && (
                    <PasswordField
                      id="unlock-vault-pin"
                      value={unlockPinInput}
                      onChange={(e) => setUnlockPinInput(e.target.value)}
                      placeholder={t.vaultPinPlaceholder}
                      aria-label={t.vaultPinLabel}
                      aria-invalid={Boolean(authError)}
                      aria-describedby={authError ? 'auth-error-msg' : undefined}
                      autoComplete="current-password"
                      showLabel={t.showPasswordLabel}
                      hideLabel={t.hidePasswordLabel}
                      inputClassName="text-xs font-mono-num"
                    />
                  )}

                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#2AABEE] px-4 py-2 text-xs font-semibold text-[#090C10] hover:bg-[#3CB7F5] disabled:opacity-60 transition-colors cursor-pointer"
                  >
                    {busy ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                        <span>{t.connectingLabel}</span>
                      </>
                    ) : (
                      t.unlockSessionBtn
                    )}
                  </button>
                </form>
              )}

              {/* Transport & API Settings Rows */}
              <div className="divide-y divide-white/[0.06]">
                <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                  <div className="text-xs text-[#8B9BB0] truncate">
                    <span>{t.networkModeLabel}: </span>
                    <span className="text-[#F0F4F8] font-medium">{networkLabel}</span>
                  </div>
                  <button
                    type="button"
                    onClick={onOpenNetworkModal}
                    className="text-xs font-medium text-[#5EC2F6] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {t.configureBtn}
                  </button>
                </div>

                <div>
                  <button
                    type="button"
                    onClick={() => setShowApiBox((v) => !v)}
                    aria-expanded={showApiBox}
                    className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium text-[#8B9BB0] hover:text-[#F0F4F8] hover:bg-white/[0.02] transition-colors cursor-pointer"
                  >
                    <span className="inline-flex items-center gap-2 min-w-0">
                      <KeyRound className="w-3.5 h-3.5 text-[#5EC2F6] shrink-0" aria-hidden="true" />
                      <span className="truncate">{t.apiCredsTitle}</span>
                      {hasApiCreds && (
                        <span className="text-[11px] text-[#22C55E] font-mono-num shrink-0">
                          · #{apiCreds.apiId}
                        </span>
                      )}
                    </span>
                    {showApiBox ? (
                      <ChevronUp className="w-4 h-4 shrink-0" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="w-4 h-4 shrink-0" aria-hidden="true" />
                    )}
                  </button>

                  {showApiBox && (
                    <div className="px-4 pb-3.5 pt-2.5 space-y-3 bg-[#0B0F14]/80 border-t border-white/[0.06]">
                      {/* 3-Step Guided Walkthrough */}
                      <div className="p-3 rounded-lg bg-[#2AABEE]/[0.08] border border-[#2AABEE]/20 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-[#5EC2F6]">
                            {t.apiGuideTitle}
                          </span>
                          <a
                            href="https://my.telegram.org"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#2AABEE] hover:underline shrink-0"
                          >
                            <span>my.telegram.org</span>
                            <ExternalLink className="w-3 h-3" aria-hidden="true" />
                          </a>
                        </div>
                        <ol className="text-[11px] text-[#8B9BB0] space-y-1 list-decimal list-inside leading-relaxed">
                          <li>{t.apiGuideStep1}</li>
                          <li>{t.apiGuideStep2}</li>
                          <li>{t.apiGuideStep3}</li>
                        </ol>
                      </div>

                      {/* Inputs Grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div>
                          <label htmlFor="api-id-input" className="block text-[11px] text-[#8B9BB0] mb-1">
                            {t.apiIdLabel} <span className="text-[#EF4444]">*</span>
                          </label>
                          <input
                            ref={apiIdRef}
                            id="api-id-input"
                            type="text"
                            inputMode="numeric"
                            value={apiCreds.apiId ? String(apiCreds.apiId) : ''}
                            onChange={(e) => {
                              const cleanDigits = normalizePinDigits(e.target.value).replace(/\D/g, '');
                              onChangeApiCreds({ ...apiCreds, apiId: cleanDigits ? parseInt(cleanDigits, 10) : 0 });
                            }}
                            placeholder="e.g. 12345678"
                            dir="ltr"
                            aria-invalid={Boolean(apiCredsFallbackError)}
                            aria-describedby={apiCredsFallbackError ? 'api-creds-error-msg' : undefined}
                            className="w-full rounded-lg border border-white/12 bg-[#0B0F14] px-3 py-2 text-xs text-[#F0F4F8] font-mono-num focus:border-[#2AABEE] focus:outline-none focus:ring-2 focus:ring-[#2AABEE]/25"
                          />
                        </div>
                        <div>
                          <label htmlFor="api-hash-input" className="block text-[11px] text-[#8B9BB0] mb-1">
                            {t.apiHashLabel} <span className="text-[#EF4444]">*</span>
                          </label>
                          <PasswordField
                            id="api-hash-input"
                            value={apiCreds.apiHash}
                            onChange={(e) =>
                              onChangeApiCreds({ ...apiCreds, apiHash: e.target.value.trim() })
                            }
                            placeholder="32-char hex api_hash"
                            autoComplete="off"
                            aria-invalid={Boolean(apiCredsFallbackError)}
                            aria-describedby={apiCredsFallbackError ? 'api-creds-error-msg' : undefined}
                            showLabel={t.showPasswordLabel}
                            hideLabel={t.hidePasswordLabel}
                            inputClassName="text-xs font-mono-num"
                          />
                        </div>
                      </div>

                      {hasApiCreds ? (
                        <div className="flex items-center gap-1.5 text-xs text-[#22C55E] pt-1 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span>{t.apiCredsReadyLabel}</span>
                        </div>
                      ) : apiCredsFallbackError ? (
                        <p id="api-creds-error-msg" role="alert" className="text-[11px] text-[#FCA5A5] pt-0.5">
                          {apiCredsFallbackError}
                        </p>
                      ) : (
                        <p className="text-[11px] text-[#8596AA] pt-0.5">
                          {t.apiCredsLocalOnlyLabel}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Login Method Body */}
              <div className="p-4 space-y-3.5">
                <div
                  role="tablist"
                  aria-label={`${t.tabQrLogin} / ${t.tabPhoneLogin}`}
                  className="grid grid-cols-2 gap-1 rounded-lg bg-[#090C10] p-1 border border-white/[0.07]"
                >
                  <button
                    id="auth-tab-qr"
                    type="button"
                    role="tab"
                    aria-selected={loginMethod === 'qr'}
                    aria-controls="auth-tabpanel-qr"
                    onClick={() => {
                      setLoginMethod('qr');
                      onResetAuth();
                    }}
                    className={`flex items-center justify-center gap-2 rounded-md py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                      loginMethod === 'qr'
                        ? 'bg-[#171D26] text-[#F0F4F8]'
                        : 'text-[#8B9BB0] hover:text-[#F0F4F8]'
                    }`}
                  >
                    <QrCode className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{t.tabQrLogin}</span>
                  </button>
                  <button
                    id="auth-tab-phone"
                    type="button"
                    role="tab"
                    aria-selected={loginMethod === 'phone'}
                    aria-controls="auth-tabpanel-phone"
                    onClick={() => {
                      setLoginMethod('phone');
                      onResetAuth();
                    }}
                    className={`flex items-center justify-center gap-2 rounded-md py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                      loginMethod === 'phone'
                        ? 'bg-[#171D26] text-[#F0F4F8]'
                        : 'text-[#8B9BB0] hover:text-[#F0F4F8]'
                    }`}
                  >
                    <Smartphone className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{t.tabPhoneLogin}</span>
                  </button>
                </div>

                {loginMethod === 'qr' ? (
                  <div
                    id="auth-tabpanel-qr"
                    role="tabpanel"
                    aria-labelledby="auth-tab-qr"
                    className="space-y-3"
                  >
                    {authStep === 'password_needed' ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          handleAction(() => onCheckPassword(passwordInput));
                        }}
                        className="space-y-3"
                      >
                        <label htmlFor="qr-2fa-pwd" className="block text-xs font-medium text-[#8B9BB0]">
                          {t.twoFaLabel}
                        </label>
                        <PasswordField
                          id="qr-2fa-pwd"
                          required
                          autoFocus
                          autoComplete="current-password"
                          value={passwordInput}
                          onChange={(e) => setPasswordInput(e.target.value)}
                          placeholder={t.twoFaPlaceholder}
                          aria-invalid={Boolean(authError)}
                          aria-describedby={authError ? 'auth-error-msg' : undefined}
                          showLabel={t.showPasswordLabel}
                          hideLabel={t.hidePasswordLabel}
                        />
                        <button
                          type="submit"
                          disabled={busy}
                          className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#2AABEE] py-2.5 text-xs font-semibold text-[#090C10] hover:bg-[#3CB7F5] disabled:opacity-60 transition-colors cursor-pointer"
                        >
                          {busy ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                              <span>{t.connectingLabel}</span>
                            </>
                          ) : (
                            t.submit2FaBtn
                          )}
                        </button>
                      </form>
                    ) : (
                      <div className="flex flex-col items-center text-center space-y-2.5">
                        {qrDataUrl ? (
                          <div className="space-y-2 flex flex-col items-center">
                            <div className="rounded-xl bg-white p-2 relative">
                              <img
                                src={qrDataUrl}
                                alt={t.qrAltText}
                                className={`w-44 h-44 block ${qrSecondsLeft === 0 ? 'opacity-30' : ''}`}
                                referrerPolicy="no-referrer"
                              />
                            </div>
                            <div className="flex items-center gap-2 text-[11px] font-mono-num">
                              {qrSecondsLeft !== null && (
                                <span className={qrSecondsLeft === 0 ? 'text-[#EF4444]' : 'text-[#8B9BB0]'}>
                                  {qrSecondsLeft === 0 ? t.qrExpiredLabel : `${qrSecondsLeft}s`}
                                </span>
                              )}
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleAction(onStartQr)}
                                className="text-[#5EC2F6] hover:underline cursor-pointer"
                              >
                                {t.refreshQrBtn}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div
                            className={`w-44 rounded-xl border border-dashed border-white/15 bg-[#0B0F14] flex flex-col items-center justify-center p-4 gap-2.5 ${
                              savedSessionMeta.exists ? 'h-32' : 'h-40'
                            }`}
                          >
                            <QrCode className="w-8 h-8 text-[#5EC2F6]" aria-hidden="true" />
                            <button
                              type="button"
                              disabled={busy || authStep === 'connecting'}
                              onClick={() => {
                                if (!hasApiCreds) {
                                  setApiCredsMissingAttempt(true);
                                  setShowApiBox(true);
                                  scheduleApiIdFocus();
                                  return;
                                }
                                setApiCredsMissingAttempt(false);
                                handleAction(onStartQr);
                              }}
                              className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                                hasApiCreds
                                  ? 'bg-[#2AABEE] text-[#090C10] hover:bg-[#3CB7F5]'
                                  : 'bg-white/10 text-[#8B9BB0] hover:bg-white/15'
                              }`}
                            >
                              {busy || authStep === 'connecting' ? (
                                <>
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                                  <span>{t.connectingLabel}</span>
                                </>
                              ) : hasApiCreds ? (
                                t.generateQrBtn
                              ) : (
                                t.enterApiIdFirstBtn
                              )}
                            </button>
                          </div>
                        )}

                        <p className="text-xs text-[#8B9BB0] max-w-xs leading-relaxed">
                          {authStep === 'qr_scanned' ? t.qrScannedFinishing : t.qrWaitingScan}
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div
                    id="auth-tabpanel-phone"
                    role="tabpanel"
                    aria-labelledby="auth-tab-phone"
                    className="space-y-3"
                  >
                    {authStep === 'idle' || authStep === 'connecting' ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          handleAction(() => onSendCode(phoneInput));
                        }}
                        className="space-y-3"
                      >
                        <label htmlFor="phone-input" className="block text-xs font-medium text-[#8B9BB0]">
                          {t.phoneLabel}
                        </label>
                        <input
                          id="phone-input"
                          type="tel"
                          required
                          autoFocus
                          autoComplete="tel"
                          value={phoneInput}
                          onChange={(e) => setPhoneInput(e.target.value)}
                          placeholder={t.phonePlaceholder}
                          dir="ltr"
                          aria-invalid={Boolean(authError)}
                          aria-describedby={authError ? 'auth-error-msg' : undefined}
                          className="w-full rounded-lg border border-white/12 bg-[#0B0F14] px-3.5 py-2 text-sm text-[#F0F4F8] font-mono-num focus:border-[#2AABEE] focus:outline-none focus:ring-2 focus:ring-[#2AABEE]/25"
                        />
                        <button
                          type="submit"
                          disabled={busy}
                          onClick={(e) => {
                            if (!hasApiCreds) {
                              e.preventDefault();
                              setApiCredsMissingAttempt(true);
                              setShowApiBox(true);
                              scheduleApiIdFocus();
                            } else {
                              setApiCredsMissingAttempt(false);
                            }
                          }}
                          className={`w-full inline-flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-xs font-semibold transition-colors cursor-pointer ${
                            hasApiCreds
                              ? 'bg-[#2AABEE] text-[#090C10] hover:bg-[#3CB7F5]'
                              : 'bg-white/10 text-[#8B9BB0] hover:bg-white/15'
                          }`}
                        >
                          {busy ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                              <span>{t.connectingLabel}</span>
                            </>
                          ) : hasApiCreds ? (
                            t.sendCodeBtn
                          ) : (
                            t.enterApiIdFirstBtn
                          )}
                        </button>
                      </form>
                    ) : authStep === 'code_sent' ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          handleAction(() => onVerifyCode(codeInput));
                        }}
                        className="space-y-3"
                      >
                        <label htmlFor="otp-input" className="block text-xs font-medium text-[#8B9BB0]">
                          {t.otpLabel}
                        </label>
                        <input
                          id="otp-input"
                          type="text"
                          inputMode="numeric"
                          required
                          autoFocus
                          autoComplete="one-time-code"
                          value={codeInput}
                          onChange={(e) => setCodeInput(e.target.value)}
                          placeholder="12345"
                          dir="ltr"
                          aria-invalid={Boolean(authError)}
                          aria-describedby={authError ? 'auth-error-msg' : undefined}
                          className="w-full rounded-lg border border-white/12 bg-[#0B0F14] px-3.5 py-2 text-sm text-[#F0F4F8] font-mono-num tracking-widest focus:border-[#2AABEE] focus:outline-none focus:ring-2 focus:ring-[#2AABEE]/25"
                        />
                        <button
                          type="submit"
                          disabled={busy}
                          className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#2AABEE] py-2.5 text-xs font-semibold text-[#090C10] hover:bg-[#3CB7F5] disabled:opacity-60 transition-colors cursor-pointer"
                        >
                          {busy ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                              <span>{t.connectingLabel}</span>
                            </>
                          ) : (
                            t.verifyCodeBtn
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={onResetAuth}
                          className="w-full text-center text-[11px] text-[#8B9BB0] hover:text-[#F0F4F8] hover:underline cursor-pointer"
                        >
                          {t.editPhoneBtn}
                        </button>
                      </form>
                    ) : (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          handleAction(() => onCheckPassword(passwordInput));
                        }}
                        className="space-y-3"
                      >
                        <label htmlFor="phone-2fa-pwd" className="block text-xs font-medium text-[#8B9BB0]">
                          {t.twoFaLabel}
                        </label>
                        <PasswordField
                          id="phone-2fa-pwd"
                          required
                          autoFocus
                          autoComplete="current-password"
                          value={passwordInput}
                          onChange={(e) => setPasswordInput(e.target.value)}
                          placeholder={t.twoFaPlaceholder}
                          aria-invalid={Boolean(authError)}
                          aria-describedby={authError ? 'auth-error-msg' : undefined}
                          showLabel={t.showPasswordLabel}
                          hideLabel={t.hidePasswordLabel}
                        />
                        <button
                          type="submit"
                          disabled={busy}
                          className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#2AABEE] py-2.5 text-xs font-semibold text-[#090C10] hover:bg-[#3CB7F5] disabled:opacity-60 transition-colors cursor-pointer"
                        >
                          {busy ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                              <span>{t.connectingLabel}</span>
                            </>
                          ) : (
                            t.submit2FaBtn
                          )}
                        </button>
                      </form>
                    )}
                  </div>
                )}

                {authError && (
                  <div
                    id="auth-error-msg"
                    role="alert"
                    className="rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/10 px-3 py-2 text-xs text-[#FCA5A5] leading-relaxed"
                  >
                    {authError}
                  </div>
                )}
              </div>

              {/* Session Persistence Consent Footer Row */}
              <div className="px-4 py-3 bg-[#0B0F14]/70 space-y-2.5">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={persistenceMode === 'vault'}
                    onChange={(e) =>
                      onChangePersistence(e.target.checked ? 'vault' : 'ephemeral', vaultPin)
                    }
                    className="mt-0.5 rounded border-white/20 accent-[#2AABEE] cursor-pointer"
                  />
                  <span>
                    <span className="block text-xs font-medium text-[#F0F4F8]">
                      {t.vaultConsentLabel}
                    </span>
                    <span className="block text-[11px] text-[#8B9BB0] mt-0.5">
                      {t.vaultConsentSub}
                    </span>
                  </span>
                </label>

                {persistenceMode === 'vault' && (
                  <div className="space-y-1.5">
                    <label htmlFor="vault-pin" className="block text-[11px] text-[#8B9BB0] mb-1">
                      {t.vaultPinLabel}
                    </label>
                    <PasswordField
                      id="vault-pin"
                      value={vaultPin}
                      onChange={(e) => onChangePersistence('vault', e.target.value)}
                      placeholder={t.vaultPinPlaceholder}
                      minLength={MIN_VAULT_PIN_LENGTH}
                      aria-invalid={isPinTooShort || isPinTooWeak || undefined}
                      aria-describedby={
                        isPinTooShort || isPinTooWeak || normalizedVaultPin.length === 0
                          ? 'vault-pin-hint'
                          : undefined
                      }
                      autoComplete="new-password"
                      showLabel={t.showPasswordLabel}
                      hideLabel={t.hidePasswordLabel}
                      inputClassName="text-xs font-mono-num"
                    />
                    {isPinTooShort ? (
                      <p id="vault-pin-hint" role="alert" className="text-[11px] text-[#FCA5A5]">
                        {t.errPinTooShort}
                      </p>
                    ) : isPinTooWeak ? (
                      <p id="vault-pin-hint" role="alert" className="text-[11px] text-[#FCA5A5]">
                        {t.errPinTooWeak}
                      </p>
                    ) : normalizedVaultPin.length === 0 ? (
                      <p id="vault-pin-hint" className="text-[11px] text-[#F59E0B]">
                        {t.noPinWarning}
                      </p>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
});
