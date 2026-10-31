# Reader media preservation

Fork: https://github.com/simonnieder/karakeep, branch `media-preservation`.

The reader parser now:

- Keeps Anthropic article bodies intact, including figures and captions.
- Decodes Substack `data-attrs` image and direct video URLs, including custom
  publication domains, while preserving valid existing image sources.
- Keeps native video/audio players in extracted articles, in their original
  position, with controls and without autoplay. Relative URLs are resolved.
- Preserves sandboxed YouTube, Vimeo and X player embeds. Other iframe providers
  become links, rather than silently disappearing or running arbitrary scripts.
- Selects the saved X post instead of its replies. Blob video sources and blocked
  crawler pages fall back to X's live post player.

The web reader and mobile DOM reader already share the stored HTML renderer;
no separate client player or database schema is needed. Re-crawl existing
bookmarks to regenerate their reader content.

## Checks

Run the focused extraction and classifier tests:

```
pnpm --filter @karakeep/workers exec vitest run workers/utils/readerContent.test.ts workers/utils/readerViewAssessment.test.ts
```

The regression cases cover article figures/captions, relative/responsive image
URLs, malformed Substack JSON, real inline images, multiple videos in order,
X post selection and blocked pages, supported/unsupported iframe providers,
and stripping script URLs, event handlers and srcdoc. The original Anthropic
article was also extracted successfully with all four figures and captions.

## Limits

Images and videos remain remote resources, not an offline media archive.
Protected, deleted or expired media may need authorized access or stop working.
Browser codec support still applies. Custom JS players with no media source in
the crawled HTML require a provider adapter; unsupported iframes retain a link.
X's fallback embeds the whole live post, so its photos may also appear there.
The shared HTML renderer is unchanged; actual iOS/Android playback needs device
verification. No browser or mobile UI playback was verified in this change.

Related upstream reports:
- https://github.com/karakeep-app/karakeep/issues/2972 (Substack images)
- https://github.com/karakeep-app/karakeep/issues/1331 (X media)
- https://github.com/karakeep-app/karakeep/issues/729 (embedded videos)
- https://github.com/karakeep-app/karakeep/issues/1563 (offline image caching)
