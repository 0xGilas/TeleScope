import React, { useMemo, useRef, useState } from 'react';
import { Lock, LogOut, Radio, Search, Shield, X } from 'lucide-react';
import type {
  ChannelSummary,
  LanguageCode,
  SessionPersistenceMode,
} from '../../types/analytics';
import { getTranslations } from '../../i18n/translations';
import { formatCompactNumber } from '../../utils/analyticsMath';
import { useDialogAccessibility } from '../../utils/dialogA11y';
import { BrandLogo } from '../common/BrandLogo';
import { ChannelAvatar } from '../common/ChannelAvatar';

interface SidebarProps {
  lang: LanguageCode;
  channels: ChannelSummary[];
  activeChannelId: number | null;
  onSelectChannel: (channelId: number) => void;
  isSampleMode: boolean;
  persistenceMode: SessionPersistenceMode;
  onToggleLang: () => void;
  onOpenVaultModal?: () => void;
  onLockSession?: () => void;
  onLogout: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = React.memo(({
  lang,
  channels,
  activeChannelId,
  onSelectChannel,
  isSampleMode,
  persistenceMode,
  onToggleLang,
  onOpenVaultModal,
  onLockSession,
  onLogout,
  mobileOpen,
  onCloseMobile,
}) => {
  const t = getTranslations(lang);
  const mobileAsideRef = useRef<HTMLElement | null>(null);
  const [channelQuery, setChannelQuery] = useState('');
  const [confirmLogout, setConfirmLogout] = useState(false);

  useDialogAccessibility(mobileOpen, mobileAsideRef);

  const filteredChannels = useMemo(() => {
    const q = channelQuery.trim().toLowerCase();
    if (!q) return channels;
    return channels.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        (c.username && c.username.toLowerCase().includes(q)),
    );
  }, [channels, channelQuery]);

  const renderSidebarBody = (isMobile: boolean) => (
    <div className="flex flex-col h-full bg-[#0D1117]/95 border-e border-white/[0.08] w-[264px] shrink-0">
      {/* Brand Row */}
      <div className="h-14 px-4 flex items-center justify-between border-b border-white/[0.08]">
        <div className="flex items-center gap-2.5 min-w-0">
          <BrandLogo size={28} />
          <span className="font-semibold text-[15px] text-[#F0F4F8] truncate">{t.appName}</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onToggleLang}
            className="rounded-lg border border-white/10 bg-[#11161D] px-2.5 py-1.5 text-[11px] font-medium text-[#8B9BB0] hover:text-[#F0F4F8] hover:bg-white/[0.08] transition-colors cursor-pointer"
          >
            {t.switchLang}
          </button>
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label={t.closeBtn}
            className="lg:hidden inline-flex items-center justify-center min-w-[40px] min-h-[40px] rounded-lg p-2 text-[#8B9BB0] hover:bg-white/10 hover:text-[#F0F4F8] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Mode & Vault Status Row */}
      <div className="px-4 py-2.5 border-b border-white/[0.07] bg-[#0B0F14]/70 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] text-[#8B9BB0] min-w-0">
          {isSampleMode ? (
            <>
              <Radio className="w-3.5 h-3.5 text-[#5EC2F6] shrink-0" aria-hidden="true" />
              <span className="truncate">{t.sampleModeLabel}</span>
            </>
          ) : (
            <>
              <Shield className="w-3.5 h-3.5 text-[#22C55E] shrink-0" aria-hidden="true" />
              <span className="truncate">
                {persistenceMode === 'vault' ? t.sessionVault : t.sessionEphemeral}
              </span>
            </>
          )}
        </div>
        {!isSampleMode && persistenceMode === 'ephemeral' && onOpenVaultModal && (
          <button
            type="button"
            onClick={onOpenVaultModal}
            title={t.saveVaultPostLoginBtn}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 -my-1 text-[11px] text-[#5EC2F6] hover:bg-[#2AABEE]/10 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Lock className="w-3 h-3" aria-hidden="true" />
            <span>{lang === 'fa' ? 'ذخیره' : 'Save'}</span>
          </button>
        )}
      </div>

      {/* Channels List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        <div
          id={isMobile ? 'mobile-sidebar-title' : undefined}
          className="px-2.5 py-1.5 text-[11px] font-medium text-[#8596AA]"
        >
          {t.channelsHeader}
        </div>

        {channels.length > 5 && (
          <div className="px-1.5 pb-1.5">
            <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#0B0F14] px-2.5 py-1.5">
              <Search className="w-3.5 h-3.5 text-[#8596AA] shrink-0" aria-hidden="true" />
              <input
                type="search"
                value={channelQuery}
                onChange={(e) => setChannelQuery(e.target.value)}
                placeholder={t.searchChannelsPlaceholder}
                aria-label={t.searchChannelsPlaceholder}
                className="w-full min-w-0 bg-transparent text-xs text-[#F0F4F8] placeholder:text-[#8596AA] focus:outline-none"
              />
            </div>
          </div>
        )}

        {filteredChannels.length === 0 ? (
          <div className="px-2.5 py-4 text-xs text-[#8B9BB0]">{t.noChannels}</div>
        ) : (
          filteredChannels.map((ch) => {
            const active = ch.id === activeChannelId;
            return (
              <button
                key={ch.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => {
                  onSelectChannel(ch.id);
                  onCloseMobile();
                }}
                className={`w-full flex items-center gap-3 rounded-xl px-2.5 py-2 text-start border transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#2AABEE]/12 border-[#2AABEE]/30 text-[#F0F4F8]'
                    : 'border-transparent text-[#8B9BB0] hover:bg-white/[0.04] hover:text-[#F0F4F8]'
                }`}
              >
                <ChannelAvatar channel={ch} size={36} />
                <div className="min-w-0 flex-1">
                  <div title={ch.title} className="text-[13px] font-semibold truncate text-[#F0F4F8]">
                    {ch.title}
                  </div>
                  <div className="text-[11px] text-[#8B9BB0] flex items-center gap-1.5 font-mono-num truncate">
                    <span>
                      {formatCompactNumber(ch.membersCount)} {t.membersLabel}
                    </span>
                    {ch.username && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span dir="ltr" className="truncate inline-block">
                          @{ch.username}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Footer Lock & Logout Actions */}
      <div className="p-3 border-t border-white/[0.08] space-y-2">
        {!isSampleMode && persistenceMode === 'vault' && onLockSession && (
          <button
            type="button"
            onClick={onLockSession}
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-[#2AABEE]/30 bg-[#2AABEE]/10 px-3 py-2 text-xs font-medium text-[#5EC2F6] hover:bg-[#2AABEE]/20 transition-colors cursor-pointer"
          >
            <Lock className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{t.lockVaultBtn}</span>
          </button>
        )}

        {!confirmLogout ? (
          <button
            type="button"
            onClick={() => (isSampleMode ? onLogout() : setConfirmLogout(true))}
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-[#0B0F14] px-3 py-2 text-xs font-medium text-[#EF4444] hover:bg-[#EF4444]/10 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{t.logoutWipeBtn}</span>
          </button>
        ) : (
          <div className="rounded-lg border border-[#EF4444]/35 bg-[#EF4444]/10 p-2.5 space-y-2">
            <p className="text-[11px] text-[#FCA5A5] leading-relaxed">{t.confirmLogoutWipe}</p>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setConfirmLogout(false)}
                className="flex-1 rounded-md border border-white/10 py-1.5 text-[11px] text-[#F0F4F8] hover:bg-white/10 cursor-pointer"
              >
                {t.cancelActionBtn}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmLogout(false);
                  onLogout();
                }}
                className="flex-1 rounded-md bg-[#B91C1C] py-1.5 text-[11px] font-semibold text-white hover:bg-[#DC2626] cursor-pointer"
              >
                {t.confirmActionBtn}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block h-screen sticky top-0">{renderSidebarBody(false)}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside
            ref={mobileAsideRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-sidebar-title"
            className="relative z-10 h-full focus:outline-none"
          >
            {renderSidebarBody(true)}
          </aside>
        </div>
      )}
    </>
  );
});
