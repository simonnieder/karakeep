import { Readability } from "@mozilla/readability";
import DOMPurify from "dompurify";
import { JSDOM, VirtualConsole } from "jsdom";

import {
  assessReaderView,
  unavailableReaderViewAssessment,
} from "./readerViewAssessment";
import type { ReaderViewAssessment } from "./readerViewAssessment";

/**
 * Many sites use custom data-* attributes for lazy loading images instead of the
 * standard `src` attribute (e.g. WeChat's data-src, data-actualsrc, data-srv, or
 * the common data-original / data-lazy patterns used by jQuery plugins).
 *
 * Readability and DOMPurify both operate on the DOM, so images with no `src` are
 * either ignored or their placeholders are stripped.  We normalise these attributes
 * to `src` *before* passing the document to Readability so that the extracted
 * article retains the actual image URLs.
 */
const LAZY_SRC_ATTRS = [
  "data-src",
  "data-actualsrc",
  "data-srv",
  "data-original",
  "data-lazy",
  "data-lazyload",
  "data-img-src",
  "data-url",
];

function isPlaceholderDataImage(src: string): boolean {
  // Tiny data-URI images are commonly used as lazy-load placeholders. Do not
  // treat every data:image/gif as a placeholder: SingleFile and some sites
  // inline real GIF assets as data URIs, and replacing those with a lazy
  // attribute URL makes the saved reader content depend on the remote image.
  // 200 chars is a deliberately generous cutoff: a 1x1 transparent GIF/PNG
  // placeholder is only ~60-100 chars, while a real inlined image is many KB,
  // so anything under this limit is safely a placeholder rather than an asset.
  const PLACEHOLDER_MAX_LENGTH = 200;
  const normalizedSrc = src.replace(/\s/g, "").toLowerCase();
  return (
    normalizedSrc.length <= PLACEHOLDER_MAX_LENGTH &&
    (normalizedSrc.startsWith("data:image/gif") ||
      normalizedSrc.startsWith("data:image/png"))
  );
}

function normalizeLazyLoadImages(document: Document): void {
  const images = document.querySelectorAll("img");
  for (const img of images) {
    // Only fill in src if it is absent or a known tiny placeholder. Real
    // inlined GIF/PNG data URIs must be preserved so archived content keeps
    // the saved image rather than falling back to a remote lazy-load URL.
    const currentSrc = img.getAttribute("src") ?? "";
    const needsSrc =
      !currentSrc || currentSrc === "#" || isPlaceholderDataImage(currentSrc);

    if (!needsSrc) {
      continue;
    }

    for (const attr of LAZY_SRC_ATTRS) {
      const value = img.getAttribute(attr);
      if (value && value.trim() && !value.startsWith("data:")) {
        img.setAttribute("src", value.trim());
        break;
      }
    }
  }
}

function mediaUrl(value: unknown, base: string): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value, base);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function prepareMedia(document: Document): void {
  for (const node of document.querySelectorAll("[data-attrs]")) {
    try {
      const attrs: unknown = JSON.parse(node.getAttribute("data-attrs")!);
      if (!attrs || typeof attrs !== "object" || !("src" in attrs)) continue;
      const src = mediaUrl(attrs.src, document.URL);
      if (!src) continue;
      const img = node.matches("img") ? node : node.querySelector("img");
      if (img) {
        const current = img.getAttribute("src") ?? "";
        if (!current || current === "#" || isPlaceholderDataImage(current)) {
          img.setAttribute("src", src);
        }
      } else if (node.matches(".image-embed")) {
        const image = document.createElement("img");
        image.src = src;
        if ("alt" in attrs && typeof attrs.alt === "string")
          image.alt = attrs.alt;
        node.append(image);
      } else if (node.matches(".video-embed") && !node.querySelector("video")) {
        const video = document.createElement("video");
        video.src = src;
        node.append(video);
      }
    } catch {
      // Malformed publisher metadata must not prevent the article from saving.
    }
  }
  normalizeLazyLoadImages(document);
  for (const video of document.querySelectorAll("video, audio")) {
    for (const source of [video, ...video.querySelectorAll("source")]) {
      const src = mediaUrl(
        source.getAttribute("src") || source.getAttribute("data-src"),
        document.URL,
      );
      if (src) source.setAttribute("src", src);
      else source.removeAttribute("src");
    }
    video.setAttribute("controls", "");
    video.setAttribute("playsinline", "");
    video.setAttribute("preload", "none");
    video.removeAttribute("autoplay");
    video.removeAttribute("loop");
    video.setAttribute("style", "max-width:100%");
  }
}

function embeddedPlayer(src: string): boolean {
  const url = new URL(src);
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    return false;
  return (
    (["www.youtube.com", "www.youtube-nocookie.com"].includes(url.hostname) &&
      /^\/embed\/[\w-]+$/.test(url.pathname)) ||
    (url.hostname === "player.vimeo.com" &&
      /^\/video\/\d+$/.test(url.pathname)) ||
    (url.hostname === "platform.twitter.com" &&
      url.pathname === "/embed/Tweet.html" &&
      /^\d+$/.test(url.searchParams.get("id") ?? ""))
  );
}

export function sanitizeMediaContent(html: string, document: Document): string {
  const purify = DOMPurify(document.defaultView!);
  const clean = new JSDOM(purify.sanitize(html, { ADD_TAGS: ["iframe"] }), {
    url: document.URL,
  });
  try {
    for (const node of clean.window.document.querySelectorAll(
      "[href], [src], [poster], [srcset]",
    )) {
      for (const attr of ["href", "src", "poster"]) {
        const value = node.getAttribute(attr);
        if (!value || value.startsWith("#") || value.startsWith("data:"))
          continue;
        const absolute = mediaUrl(value, document.URL);
        if (absolute) node.setAttribute(attr, absolute);
      }
      const srcset = node.getAttribute("srcset");
      if (srcset)
        node.setAttribute(
          "srcset",
          srcset.replace(
            /(\S+)(\s+[\d.]+[xw])?(\s*(?:,|$))/g,
            (_, src: string, size: string, separator: string) =>
              (mediaUrl(src, document.URL) ?? src) + (size ?? "") + separator,
          ),
        );
    }
    prepareMedia(clean.window.document);
    for (const frame of clean.window.document.querySelectorAll("iframe")) {
      const src = mediaUrl(frame.getAttribute("src"), document.URL);
      if (!src) {
        frame.remove();
        continue;
      }
      if (!embeddedPlayer(src)) {
        const link = clean.window.document.createElement("a");
        link.href = src;
        link.textContent = frame.getAttribute("title") || "Open embedded media";
        frame.replaceWith(link);
        continue;
      }
      const player = clean.window.document.createElement("iframe");
      player.src = src;
      player.title = frame.getAttribute("title") || "Embedded media";
      player.setAttribute(
        "sandbox",
        "allow-scripts allow-same-origin allow-presentation",
      );
      player.setAttribute("allow", "fullscreen; picture-in-picture");
      player.setAttribute("allowfullscreen", "");
      player.setAttribute("loading", "lazy");
      player.setAttribute("referrerpolicy", "no-referrer");
      player.setAttribute(
        "style",
        new URL(src).hostname === "platform.twitter.com"
          ? "width:100%;height:600px;border:0"
          : "width:100%;aspect-ratio:16/9;border:0",
      );
      frame.replaceWith(player);
    }
    return clean.window.document.body.innerHTML;
  } finally {
    clean.window.close();
  }
}

function articleRoot(document: Document, url: string): Element | null {
  const location = new URL(url);
  if (["anthropic.com", "www.anthropic.com"].includes(location.hostname)) {
    return document.querySelector("[data-article-body]");
  }
  // Substack also serves publications on custom domains.
  const substack = document.querySelector(".available-content .body.markup");
  if (substack) return substack;
  if (
    !["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(
      location.hostname,
    )
  ) {
    return null;
  }
  const id = location.pathname.match(/\/status\/(\d+)/)?.[1];
  if (!id) return null;
  const post = [
    ...document.querySelectorAll('article[data-testid="tweet"]'),
  ].find((article) =>
    [...article.querySelectorAll("a[href]")].some(
      (link) =>
        link.querySelector("time") &&
        mediaUrl(link.getAttribute("href"), url)
          ?.split(/[?#]/)[0]
          .endsWith(`/status/${id}`),
    ),
  );
  if (!post) {
    // shortcut: blocked X pages use the live embed; archive authenticated posts separately.
    const player = document.createElement("iframe");
    player.src = `https://platform.twitter.com/embed/Tweet.html?id=${id}`;
    const fallback = document.createElement("article");
    fallback.append(player);
    return fallback;
  }
  // X uses blob: video sources; its supported player resolves the actual stream.
  if (
    post.querySelector("video") &&
    !post.querySelector('video[src^="https:"], source[src^="https:"]')
  ) {
    const player = document.createElement("iframe");
    player.src = `https://platform.twitter.com/embed/Tweet.html?id=${id}`;
    player.title = "X post and video";
    post.querySelector("video")!.replaceWith(player);
  }
  return post;
}

export function extractReadableContent(
  htmlContent: string,
  url: string,
): {
  readableContent: { content: string } | null;
  readerViewAssessment: ReaderViewAssessment;
} {
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(htmlContent, { url, virtualConsole });
  try {
    prepareMedia(dom.window.document);
    const root = articleRoot(dom.window.document, url);
    const documentClone = dom.window.document.cloneNode(true) as Document;
    // Readability removes native players; image placeholders keep their position.
    const players = [...documentClone.querySelectorAll("video, audio, iframe")];
    for (const [index, player] of players.entries()) {
      const placeholder = documentClone.createElement("img");
      placeholder.src = `https://reader-media.invalid/${index}`;
      player.replaceWith(placeholder);
    }
    const readableContent = root
      ? { content: root.innerHTML }
      : new Readability(documentClone).parse();
    if (
      readableContent &&
      typeof readableContent.content === "string" &&
      !root
    ) {
      const extracted = new JSDOM(readableContent.content, { url });
      try {
        for (const placeholder of extracted.window.document.querySelectorAll(
          'img[src^="https://reader-media.invalid/"]',
        )) {
          const index = Number(
            new URL(placeholder.getAttribute("src")!).pathname.slice(1),
          );
          if (players[index])
            placeholder.replaceWith(players[index].cloneNode(true));
        }
        readableContent.content = extracted.window.document.body.innerHTML;
      } finally {
        extracted.window.close();
      }
    }
    if (!readableContent || typeof readableContent.content !== "string") {
      return {
        readableContent: null,
        readerViewAssessment: unavailableReaderViewAssessment(),
      };
    }

    const purifiedHTML = sanitizeMediaContent(
      readableContent.content,
      dom.window.document,
    );
    const extractedDom = new JSDOM(purifiedHTML, { url, virtualConsole });
    try {
      return {
        readableContent: { content: purifiedHTML },
        readerViewAssessment: assessReaderView(
          dom.window.document,
          extractedDom.window.document,
          url,
        ),
      };
    } finally {
      extractedDom.window.close();
    }
  } finally {
    dom.window.close();
  }
}
