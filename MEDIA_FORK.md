# Media preservation fork brief

Goal: display article/post embedded images and videos in their original order,
on web and mobile, including Anthropic, Substack and X. This checkout starts
from upstream main on 2026-10-31; branch: media-preservation.

## Confirmed upstream gaps

- Substack JSON-wrapped image URLs: open issue #2972.
  https://github.com/karakeep-app/karakeep/issues/2972
- X media not downloaded: open issue #1331.
  https://github.com/karakeep-app/karakeep/issues/1331
- Embedded video handling: open issue #729.
  https://github.com/karakeep-app/karakeep/issues/729
- Reader image caching: approved, open issue #1563.
  https://github.com/karakeep-app/karakeep/issues/1563

## Small initial scope

1. Port the verified Anthropic figure preservation workaround from the local
   running instance into source with a regression fixture.
2. Decode Substack data-attrs JSON image sources before Readability, preserving
   valid existing sources and handling malformed JSON safely.
3. Add a media manifest before Readability drops media, associate retained media
   with the correct post/article, and render it in document order on web/mobile.
4. Handle native video/source elements and supported hosted-video providers.
   X needs post-scoped extraction; the generic page includes unrelated replies.
5. Use existing asset storage/video workers where possible. Distinguish remote
   playable embeds from locally archived files; do not equate them.

## Bounds

A fork alone does not implement these features. Universal video playback is
not a small parser patch: extraction, rendering, authentication and browser
format support all matter. Preserve sanitization and request validation;
never enable arbitrary iframe/script execution to make embeds work.
Paywalled/authenticated sources require the user's existing authorized access.

## Current state

Prepared local checkout only. No GitHub authentication is available in this
session, so no hosted fork has been created or pushed. No new deployment.
The existing Anthropic container workaround remains active separately.
