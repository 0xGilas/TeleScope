import React from 'react';
import {
  BarChart3,
  FileText,
  Film,
  Image as ImageIcon,
  Layers,
  Link2,
  Mic,
  Music,
} from 'lucide-react';
import { getTranslations } from '../../i18n/translations';
import type {
  LanguageCode,
  PostMediaPreview,
  PostRecord,
} from '../../types/analytics';
import {
  formatFileSize,
  formatMediaDuration,
  getPostDisplayTitle,
} from '../../utils/analyticsMath';

interface PostPreviewCardProps {
  lang: LanguageCode;
  post: PostRecord;
  mediaPreview?: PostMediaPreview;
  loadingMediaPreview?: boolean;
}

export const PostPreviewCard: React.FC<PostPreviewCardProps> = React.memo(({
  lang,
  post,
  mediaPreview,
  loadingMediaPreview = false,
}) => {
  const primaryPreviewItem =
    mediaPreview?.items.find((i) => i.messageId === post.primaryId) ??
    mediaPreview?.items[0];
  const meta = primaryPreviewItem?.meta ?? post.mediaMeta;
  const previewSrc = primaryPreviewItem?.previewUrl ?? meta?.thumbUrl;
  const isBlurryThumbOnly = Boolean(!primaryPreviewItem?.previewUrl && meta?.thumbUrl && loadingMediaPreview);

  const t = getTranslations(lang);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#5EC2F6]">
          {t.previewHeader}
        </span>
        {loadingMediaPreview && (
          <span className="text-[11px] text-[#8B9BB0] animate-pulse">
            {t.loadingPreview}
          </span>
        )}
      </div>

      {/* PHOTO PREVIEW */}
      {post.mediaKind === 'photo' && (
        <div className="relative overflow-hidden rounded-xl border border-white/10 bg-[#0B0F14]">
          {previewSrc ? (
            <img
              src={previewSrc}
              alt={getPostDisplayTitle(post, lang)}
              decoding="async"
              className={`w-full max-h-72 object-contain bg-[#090C10] transition duration-300 ${
                isBlurryThumbOnly ? 'blur-sm scale-[1.02]' : ''
              }`}
            />
          ) : (
            <div className="h-36 flex flex-col items-center justify-center gap-2 text-[#8596AA]">
              <ImageIcon className="w-7 h-7" aria-hidden="true" />
              <span className="text-xs">
                {loadingMediaPreview ? t.loadingPreview : t.photoLabel}
              </span>
            </div>
          )}
          {meta?.width && meta?.height && (
            <span
              dir="ltr"
              className="absolute bottom-2 end-2 rounded-md bg-black/70 px-2 py-0.5 text-[10px] font-mono-num text-[#F0F4F8] border border-white/10"
            >
              {meta.width}×{meta.height}
            </span>
          )}
        </div>
      )}

      {/* AUDIO / MUSIC / VOICE PREVIEW */}
      {post.mediaKind === 'audio' && (
        <div className="rounded-xl border border-white/10 bg-[#0B0F14] p-3.5 flex items-center gap-3.5">
          <div className="relative w-16 h-16 rounded-lg overflow-hidden shrink-0 border border-white/10 bg-[#141A22] flex items-center justify-center">
            {previewSrc ? (
              <img
                src={previewSrc}
                alt={meta?.title ?? t.audioFallback}
                decoding="async"
                className={`w-full h-full object-cover ${isBlurryThumbOnly ? 'blur-xs' : ''}`}
              />
            ) : meta?.isVoice ? (
              <Mic className="w-6 h-6 text-[#2AABEE]" aria-hidden="true" />
            ) : (
              <Music className="w-6 h-6 text-[#2AABEE]" aria-hidden="true" />
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-1">
            <div dir="auto" className="text-[13px] font-semibold text-[#F0F4F8] break-words">
              {meta?.isVoice
                ? t.voiceMsg
                : meta?.title || meta?.fileName || t.audioFallback}
            </div>
            {meta?.performer && (
              <div dir="auto" className="text-xs text-[#8B9BB0] break-words">{meta.performer}</div>
            )}
            <div
              dir="ltr"
              className="flex flex-wrap items-center gap-2 text-[11px] font-mono-num text-[#5EC2F6] pt-0.5"
            >
              {meta?.durationSec ? <span>{formatMediaDuration(meta.durationSec)}</span> : null}
              {meta?.fileSizeBytes ? (
                <>
                  <span className="text-[#586778]">·</span>
                  <span className="text-[#8B9BB0]">{formatFileSize(meta.fileSizeBytes)}</span>
                </>
              ) : null}
              {meta?.mimeType ? (
                <>
                  <span className="text-[#8596AA]">·</span>
                  <span className="text-[#8596AA] uppercase">{meta.mimeType.split('/')[1] ?? meta.mimeType}</span>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* VIDEO / GIF PREVIEW */}
      {post.mediaKind === 'video' && (
        <div className="relative overflow-hidden rounded-xl border border-white/10 bg-[#0B0F14]">
          {previewSrc ? (
            <img
              src={previewSrc}
              alt={getPostDisplayTitle(post, lang)}
              decoding="async"
              className={`w-full max-h-64 object-contain bg-[#090C10] ${
                isBlurryThumbOnly ? 'blur-sm scale-[1.02]' : ''
              }`}
            />
          ) : (
            <div className="h-36 flex flex-col items-center justify-center gap-2 text-[#8596AA]">
              <Film className="w-7 h-7" aria-hidden="true" />
              <span className="text-xs break-words px-3 text-center">
                {meta?.fileName ?? t.videoLabel}
              </span>
            </div>
          )}

          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent pointer-events-none" />
          <div className="absolute top-2.5 start-2.5 inline-flex items-center gap-1 rounded bg-black/75 px-2 py-0.5 text-[10px] font-medium text-[#F0F4F8] border border-white/15 pointer-events-none">
            <Film className="w-3 h-3 text-[#5EC2F6]" aria-hidden="true" />
            <span>{meta?.isAnimation ? 'GIF' : t.videoPreviewTag}</span>
          </div>

          <div
            dir="ltr"
            className="absolute bottom-2.5 start-2.5 end-2.5 flex items-center justify-between text-[11px] font-mono-num text-[#F0F4F8]"
          >
            <div className="flex items-center gap-1.5">
              {meta?.isAnimation ? (
                <span className="rounded bg-black/75 px-1.5 py-0.5 border border-white/15">GIF</span>
              ) : meta?.durationSec ? (
                <span className="rounded bg-black/75 px-1.5 py-0.5 border border-white/15">
                  {formatMediaDuration(meta.durationSec)}
                </span>
              ) : null}
              {meta?.width && meta?.height && (
                <span className="rounded bg-black/75 px-1.5 py-0.5 border border-white/15 text-[#8B9BB0]">
                  {meta.width}×{meta.height}
                </span>
              )}
            </div>
            {meta?.fileSizeBytes ? (
              <span className="rounded bg-black/75 px-1.5 py-0.5 border border-white/15 text-[#8B9BB0]">
                {formatFileSize(meta.fileSizeBytes)}
              </span>
            ) : null}
          </div>
        </div>
      )}

      {/* DOCUMENT / FILE PREVIEW */}
      {post.mediaKind === 'document' && (
        <div className="rounded-xl border border-white/10 bg-[#0B0F14] p-3.5 flex items-center gap-3.5">
          {previewSrc ? (
            <img
              src={previewSrc}
              alt={meta?.fileName ?? t.documentFallback}
              className="w-14 h-14 rounded-lg object-cover border border-white/10 shrink-0"
            />
          ) : (
            <div className="w-12 h-12 rounded-lg bg-[#2AABEE]/12 border border-[#2AABEE]/25 flex items-center justify-center text-[#5EC2F6] shrink-0">
              <FileText className="w-5 h-5" aria-hidden="true" />
            </div>
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="text-[13px] font-semibold text-[#F0F4F8] break-words">
              {meta?.fileName || t.documentFallback}
            </div>
            <div dir="ltr" className="flex flex-wrap items-center gap-2 text-[11px] font-mono-num text-[#8B9BB0]">
              {meta?.fileSizeBytes ? <span>{formatFileSize(meta.fileSizeBytes)}</span> : null}
              {meta?.mimeType ? (
                <>
                  {meta?.fileSizeBytes && <span>·</span>}
                  <span className="break-all">{meta.mimeType}</span>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* POLL / QUIZ PREVIEW */}
      {post.mediaKind === 'poll' && meta?.pollQuestion && (
        <div className="rounded-xl border border-white/10 bg-[#0B0F14] p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2 min-w-0">
              <BarChart3 className="w-4 h-4 text-[#5EC2F6] shrink-0 mt-0.5" aria-hidden="true" />
              <div className="text-[13px] font-semibold text-[#F0F4F8] leading-snug break-words">
                {meta.pollQuestion}
              </div>
            </div>
            <span className="rounded-md bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-[#8B9BB0] shrink-0">
              {meta.pollIsQuiz ? t.quizTag : t.pollTag}
              {meta.pollIsClosed ? ` · ${t.closedTag}` : ''}
            </span>
          </div>

          {meta.pollOptions && meta.pollOptions.length > 0 && (
            <div className="space-y-2">
              {meta.pollOptions.map((opt, i) => {
                const total = Math.max(
                  1,
                  meta.pollVoters ?? meta.pollOptions!.reduce((s, o) => s + o.voters, 0),
                );
                const pct = Math.round((opt.voters / total) * 100);
                return (
                  <div key={`${i}-${opt.text}`} className="space-y-1">
                    <div className="flex items-start justify-between gap-2 text-xs">
                      <span className="text-[#F0F4F8] min-w-0 break-words">{opt.text}</span>
                      <span dir="ltr" className="font-mono-num text-[#5EC2F6] shrink-0">
                        {pct}% ({opt.voters})
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-white/[0.07] overflow-hidden" dir="ltr">
                      <div
                        className="h-full rounded-full bg-[#2AABEE]"
                        style={{ width: `${Math.max(3, pct)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {typeof meta.pollVoters === 'number' && (
            <div className="text-[11px] text-[#8B9BB0] font-mono-num">
              {meta.pollVoters.toLocaleString('en-US')} {t.votesLabel}
            </div>
          )}
        </div>
      )}

      {/* ALBUM GALLERY PREVIEW */}
      {post.isAlbum && (
        <div className="rounded-xl border border-white/10 bg-[#0B0F14] p-3 space-y-2.5">
          <div className="flex items-center gap-1.5 text-[11px] text-[#8B9BB0]">
            <Layers className="w-3.5 h-3.5 text-[#5EC2F6]" aria-hidden="true" />
            <span>
              {post.albumChildren.length} {t.itemsInAlbumLabel}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {post.albumChildren.map((child, idx) => {
              const fetchedItem = mediaPreview?.items.find((i) => i.messageId === child.id);
              const childThumb = fetchedItem?.previewUrl ?? child.mediaMeta?.thumbUrl;
              const childMeta = fetchedItem?.meta ?? child.mediaMeta;
              return (
                <div
                  key={child.id}
                  className="relative aspect-square rounded-lg overflow-hidden border border-white/10 bg-[#11161D] flex flex-col items-center justify-center p-2 text-center"
                >
                  {childThumb ? (
                    <img
                      src={childThumb}
                      alt={childMeta?.title || childMeta?.fileName || `${t.itemLabel} ${idx + 1}`}
                      loading="lazy"
                      decoding="async"
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  ) : (
                    <>
                      {child.mediaKind === 'audio' ? (
                        <Music className="w-5 h-5 text-[#5EC2F6] mb-1" aria-hidden="true" />
                      ) : child.mediaKind === 'video' ? (
                        <Film className="w-5 h-5 text-[#5EC2F6] mb-1" aria-hidden="true" />
                      ) : child.mediaKind === 'document' ? (
                        <FileText className="w-5 h-5 text-[#5EC2F6] mb-1" aria-hidden="true" />
                      ) : (
                        <ImageIcon className="w-5 h-5 text-[#5EC2F6] mb-1" aria-hidden="true" />
                      )}
                      <span className="text-[10px] text-[#8B9BB0] line-clamp-2 break-all">
                        {childMeta?.title || childMeta?.fileName || t.mediaKindLabels[child.mediaKind]}
                      </span>
                    </>
                  )}
                  <span
                    dir="ltr"
                    className="absolute top-1.5 start-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[9px] font-mono-num text-[#F0F4F8] border border-white/10"
                  >
                    #{idx + 1} · {t.mediaKindLabels[child.mediaKind]}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* WEBPAGE PREVIEW CHIP (FOR TEXT POSTS WITH LINK PREVIEW) */}
      {post.mediaKind === 'text' && meta?.webPageUrl && (
        <div className="rounded-xl border border-white/10 bg-[#0B0F14] p-3 flex items-center gap-3">
          {previewSrc ? (
            <img
              src={previewSrc}
              alt={meta.title ?? meta.webPageSite ?? t.linkPreviewAlt}
              className="w-12 h-12 rounded-lg object-cover border border-white/10 shrink-0"
            />
          ) : (
            <div className="w-10 h-10 rounded-lg bg-[#2AABEE]/12 border border-[#2AABEE]/25 flex items-center justify-center text-[#5EC2F6] shrink-0">
              <Link2 className="w-4 h-4" aria-hidden="true" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            {meta.webPageSite && (
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#5EC2F6] break-words">
                {meta.webPageSite}
              </div>
            )}
            <div className="text-xs font-medium text-[#F0F4F8] break-words">
              {meta.title || meta.webPageUrl}
            </div>
            <div
              dir="ltr"
              title={meta.webPageUrl}
              className="text-[11px] font-mono-num text-[#8B9BB0] truncate"
            >
              {meta.webPageUrl}
            </div>
          </div>
        </div>
      )}

      {/* CAPTION TEXT (If present) */}
      {post.text.trim().length > 0 && (
        <p
          dir="auto"
          className="text-[13px] leading-relaxed text-[#F0F4F8] whitespace-pre-wrap break-words"
        >
          {post.text}
        </p>
      )}
    </div>
  );
});

PostPreviewCard.displayName = 'PostPreviewCard';
