import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, Globe, Loader2, Shield, Terminal, X } from 'lucide-react';
import type { LanguageCode, NetworkConfig, NetworkMode } from '../../types/analytics';
import { getTranslations } from '../../i18n/translations';
import { testBridgeReachability } from '../../services/telegramBridge';
import { useDialogAccessibility } from '../../utils/dialogA11y';
import { PasswordField } from '../common/PasswordField';

interface NetworkModalProps {
  open: boolean;
  config: NetworkConfig;
  lang: LanguageCode;
  onClose: () => void;
  onSave: (next: NetworkConfig) => void;
}

export const NetworkModal: React.FC<NetworkModalProps> = ({
  open,
  config,
  lang,
  onClose,
  onSave,
}) => {
  const t = getTranslations(lang);
  const dialogRef = useRef<HTMLFormElement | null>(null);
  const copyTimeoutRef = useRef<number | null>(null);
  const [draft, setDraft] = useState<NetworkConfig>(config);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [copiedCmd, setCopiedCmd] = useState(false);

  useDialogAccessibility(open, dialogRef);

  useEffect(() => {
    if (open) {
      setDraft(config);
      setTestResult(null);
    }
  }, [open, config]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  if (!open) return null;

  const setMode = (mode: NetworkMode) => {
    setDraft((prev) => ({ ...prev, mode }));
    setTestResult(null);
  };

  const handleTestBridge = async () => {
    setTesting(true);
    setTestResult(null);
    const res = await testBridgeReachability(draft.socks5.bridgeUrl, draft.socks5.bridgeToken);
    setTestResult(res);
    setTesting(false);
  };

  const handleCopyCommand = async () => {
    const cmd = 'cd packages/socks-bridge && npm install && node index.mjs';
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedCmd(true);
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => {
        copyTimeoutRef.current = null;
        setCopiedCmd(false);
      }, 1800);
    } catch {
      // clipboard unavailable
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(draft);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="network-modal-title"
    >
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />
      <form
        ref={dialogRef}
        tabIndex={-1}
        onSubmit={handleSubmit}
        className="relative z-10 w-full max-w-xl tg-sheet-glass rounded-2xl overflow-hidden focus:outline-none"
      >
        <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <Globe className="w-4 h-4 text-[#5EC2F6]" aria-hidden="true" />
            <h2 id="network-modal-title" className="text-sm font-semibold text-[#F0F4F8]">
              {t.netModalTitle}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.closeBtn}
            className="inline-flex items-center justify-center min-w-[40px] min-h-[40px] rounded-lg p-2 text-[#8B9BB0] hover:bg-white/10 hover:text-[#F0F4F8] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          <p className="text-xs leading-relaxed text-[#8B9BB0]">{t.netModalDesc}</p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 rounded-lg bg-[#090C10] p-1 border border-white/[0.06]">
            {(
              [
                { id: 'direct', label: t.modeDirect },
                { id: 'socks5-bridge', label: t.modeSocks5 },
                { id: 'cf-relay', label: t.modeCfRelay },
              ] as const
            ).map((opt) => {
              const active = draft.mode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setMode(opt.id)}
                  className={`rounded-md px-3 py-2 text-xs font-medium text-start transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#2AABEE] text-[#090C10] font-semibold'
                      : 'text-[#8B9BB0] hover:text-[#F0F4F8]'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {draft.mode === 'socks5-bridge' && (
            <div className="space-y-3 pt-1 border-t border-white/[0.06]">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                <div className="sm:col-span-2">
                  <label htmlFor="socks-host" className="block text-xs font-medium text-[#8B9BB0] mb-1">
                    {t.socksHost}
                  </label>
                  <input
                    id="socks-host"
                    type="text"
                    value={draft.socks5.host}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, socks5: { ...p.socks5, host: e.target.value } }))
                    }
                    placeholder="127.0.0.1"
                    dir="ltr"
                    className="w-full rounded-lg border border-white/10 bg-[#0B0F14] px-3 py-2 text-sm text-[#F0F4F8] font-mono-num focus:border-[#2AABEE] focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="socks-port" className="block text-xs font-medium text-[#8B9BB0] mb-1">
                    {t.socksPort}
                  </label>
                  <input
                    id="socks-port"
                    type="number"
                    min={1}
                    max={65535}
                    value={draft.socks5.port}
                    onChange={(e) =>
                      setDraft((p) => ({
                        ...p,
                        socks5: { ...p.socks5, port: Number(e.target.value) || 1080 },
                      }))
                    }
                    placeholder="1080"
                    dir="ltr"
                    className="w-full rounded-lg border border-white/10 bg-[#0B0F14] px-3 py-2 text-sm text-[#F0F4F8] font-mono-num focus:border-[#2AABEE] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="socks-user" className="block text-xs font-medium text-[#8B9BB0] mb-1">
                    {t.socksUser}
                  </label>
                  <input
                    id="socks-user"
                    type="text"
                    value={draft.socks5.username}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, socks5: { ...p.socks5, username: e.target.value } }))
                    }
                    autoComplete="off"
                    dir="ltr"
                    className="w-full rounded-lg border border-white/10 bg-[#0B0F14] px-3 py-2 text-sm text-[#F0F4F8] focus:border-[#2AABEE] focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="socks-pass" className="block text-xs font-medium text-[#8B9BB0] mb-1">
                    {t.socksPass}
                  </label>
                  <PasswordField
                    id="socks-pass"
                    value={draft.socks5.password}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, socks5: { ...p.socks5, password: e.target.value } }))
                    }
                    autoComplete="off"
                    showLabel={t.showPasswordLabel}
                    hideLabel={t.hidePasswordLabel}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="bridge-url" className="block text-xs font-medium text-[#8B9BB0] mb-1">
                    {t.bridgeUrl}
                  </label>
                  <input
                    id="bridge-url"
                    type="text"
                    value={draft.socks5.bridgeUrl}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, socks5: { ...p.socks5, bridgeUrl: e.target.value } }))
                    }
                    placeholder="ws://127.0.0.1:8787"
                    dir="ltr"
                    className="w-full rounded-lg border border-white/12 bg-[#0B0F14] px-3 py-2 text-sm text-[#F0F4F8] font-mono-num focus:border-[#2AABEE] focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="bridge-token" className="block text-xs font-medium text-[#8B9BB0] mb-1">
                    {t.bridgeTokenLabel}
                  </label>
                  <PasswordField
                    id="bridge-token"
                    value={draft.socks5.bridgeToken ?? ''}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, socks5: { ...p.socks5, bridgeToken: e.target.value } }))
                    }
                    placeholder={t.bridgeTokenPlaceholder}
                    autoComplete="off"
                    showLabel={t.showPasswordLabel}
                    hideLabel={t.hidePasswordLabel}
                    inputClassName="text-xs font-mono-num"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-white/[0.06] bg-[#0B0F14] p-3">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#8B9BB0]">
                    <Terminal className="w-3.5 h-3.5 text-[#5EC2F6]" aria-hidden="true" />
                    {t.bridgeCommandTitle}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyCommand}
                    className="inline-flex items-center gap-1 text-xs text-[#5EC2F6] hover:underline cursor-pointer"
                  >
                    {copiedCmd ? (
                      <Check className="w-3.5 h-3.5" aria-hidden="true" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                    {copiedCmd ? t.copiedBtn : t.copyBtn}
                  </button>
                </div>
                <code dir="ltr" className="block text-xs text-[#F0F4F8] font-mono-num break-all">
                  cd packages/socks-bridge && npm install && node index.mjs
                </code>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleTestBridge}
                  disabled={testing}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-3.5 py-2 text-xs font-medium text-[#F0F4F8] hover:bg-white/[0.09] disabled:opacity-60 cursor-pointer"
                >
                  {testing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                      <span>{t.connectingLabel}</span>
                    </>
                  ) : (
                    t.testBridgeBtn
                  )}
                </button>
                {testResult && (
                  <span
                    role={testResult.ok ? 'status' : 'alert'}
                    className={`text-xs ${testResult.ok ? 'text-[#22C55E]' : 'text-[#EF4444]'}`}
                  >
                    {testResult.message}
                  </span>
                )}
              </div>
            </div>
          )}

          {draft.mode === 'cf-relay' && (
            <div className="space-y-2.5 pt-2 border-t border-white/[0.06]">
              <label htmlFor="cf-relay-url" className="block text-xs font-medium text-[#8B9BB0]">
                {t.cfRelayUrl}
              </label>
              <input
                id="cf-relay-url"
                type="url"
                value={draft.cfRelayUrl}
                onChange={(e) => setDraft((p) => ({ ...p, cfRelayUrl: e.target.value }))}
                placeholder="wss://tg-relay.your-subdomain.workers.dev"
                dir="ltr"
                className="w-full rounded-lg border border-white/10 bg-[#0B0F14] px-3 py-2 text-sm text-[#F0F4F8] font-mono-num focus:border-[#2AABEE] focus:outline-none"
              />
              <div className="pt-1">
                <label htmlFor="cf-relay-token" className="block text-xs font-medium text-[#8B9BB0] mb-1">
                  {t.cfRelayTokenLabel}
                </label>
                <PasswordField
                  id="cf-relay-token"
                  value={draft.cfRelayToken ?? ''}
                  onChange={(e) => setDraft((p) => ({ ...p, cfRelayToken: e.target.value }))}
                  placeholder={t.cfRelayTokenPlaceholder}
                  autoComplete="off"
                  showLabel={t.showPasswordLabel}
                  hideLabel={t.hidePasswordLabel}
                  inputClassName="text-xs font-mono-num"
                />
              </div>
              <p className="text-xs text-[#8B9BB0]">{t.cfDeployHint}</p>
            </div>
          )}

          <div className="flex items-start gap-2.5 pt-3 border-t border-white/[0.06] text-xs text-[#8B9BB0]">
            <Shield className="w-4 h-4 text-[#22C55E] shrink-0 mt-0.5" aria-hidden="true" />
            <span>{t.mtprotoE2eNote}</span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/[0.08] px-5 py-3 bg-[#0B0F14]/40">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 px-3.5 py-1.5 text-xs font-medium text-[#8B9BB0] hover:text-[#F0F4F8] hover:bg-white/[0.05] cursor-pointer"
          >
            {t.closeBtn}
          </button>
          <button
            type="submit"
            className="rounded-lg bg-[#2AABEE] px-4 py-1.5 text-xs font-semibold text-[#090C10] hover:bg-[#3CB7F5] transition-colors cursor-pointer"
          >
            {t.saveNetworkBtn}
          </button>
        </div>
      </form>
    </div>
  );
};
