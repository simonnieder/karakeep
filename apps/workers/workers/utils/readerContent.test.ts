import { JSDOM } from "jsdom";
import { describe, expect, test } from "vitest";

import { extractReadableContent } from "./readerContent";

const prose = `<p>${"This article explains the experiment, its results, and the limitations of the evidence. ".repeat(8)}</p>`;
function read(body: string, url = "https://example.com/posts/test") {
  const result = extractReadableContent(
    `<article>${prose}${body}${prose}</article>`,
    url,
  );
  expect(result.readableContent).not.toBeNull();
  return new JSDOM(result.readableContent!.content, { url });
}

function check(
  body: string,
  assertion: (document: Document) => void,
  url?: string,
) {
  const dom = read(body, url);
  try {
    assertion(dom.window.document);
  } finally {
    dom.window.close();
  }
}

describe("reader media", () => {
  test("keeps Anthropic figures, captions, relative URLs and responsive sources", () => {
    check(
      `<div data-article-body>${prose}<div class="hash_media-column" data-type="image"><figure><img src="/figure.png" srcset="/figure.png 1x, /large.png 2x"><figcaption>Experiment results</figcaption></figure></div>${prose}</div>`,
      (doc) => {
        expect(doc.querySelector("figure img")?.getAttribute("src")).toBe(
          "https://www.anthropic.com/figure.png",
        );
        expect(doc.querySelector("img")?.getAttribute("srcset")).toContain(
          "https://www.anthropic.com/large.png 2x",
        );
        expect(doc.querySelector("figcaption")?.textContent).toBe(
          "Experiment results",
        );
      },
      "https://www.anthropic.com/research/test",
    );
  });

  test("decodes Substack image-embed JSON without an img, on custom domains", () => {
    const attrs = JSON.stringify({
      src: "https://cdn.example.com/image.png",
      alt: "A chart",
    }).replaceAll('"', "&quot;");
    check(
      `<div class="available-content"><div class="body markup">${prose}<div class="image-embed" data-attrs="${attrs}"></div>${prose}</div></div>`,
      (doc) => {
        expect(doc.querySelector("img")?.src).toBe(
          "https://cdn.example.com/image.png",
        );
        expect(doc.querySelector("img")?.alt).toBe("A chart");
      },
    );
  });

  test("fills Substack image placeholders, leaves valid images alone", () => {
    check(
      `<img data-attrs='{"src":"https://cdn.example.com/a.png"}'><img src="https://cdn.example.com/saved.png" data-attrs='{"src":"https://cdn.example.com/other.png"}'>`,
      (doc) => {
        expect([...doc.querySelectorAll("img")].map((img) => img.src)).toEqual([
          "https://cdn.example.com/a.png",
          "https://cdn.example.com/saved.png",
        ]);
      },
    );
  });

  test("ignores malformed JSON and unsafe sources without losing the article", () => {
    check(
      `<img data-attrs='not json'><img data-attrs='{"src":"javascript:alert(1)"}'><img data-attrs='{"src":{}}'>`,
      (doc) => {
        expect(doc.body.textContent).toContain("This article explains");
        expect(doc.querySelector("img[src]")).toBeNull();
      },
    );
  });

  test("keeps existing lazy images and real inline image data", () => {
    const inline = `data:image/gif;base64,${"A".repeat(250)}`;
    check(
      `<img data-src="https://cdn.example.com/lazy.png"><img src="${inline}" data-src="https://cdn.example.com/not-this.gif">`,
      (doc) => {
        const images = [...doc.querySelectorAll("img")];
        expect(images[0].src).toBe("https://cdn.example.com/lazy.png");
        expect(images[1].src).toBe(inline);
      },
    );
  });

  test("keeps multiple native players in order with controls and no autoplay", () => {
    check(
      `<video autoplay loop poster="/poster.png"><source src="/one.mp4" type="video/mp4"></video><p>Between the videos.</p><video data-src="/two.mp4"></video>`,
      (doc) => {
        const videos = [...doc.querySelectorAll("video")];
        expect(videos).toHaveLength(2);
        expect(videos[0].querySelector("source")?.src).toBe(
          "https://example.com/one.mp4",
        );
        expect(videos[0].poster).toBe("https://example.com/poster.png");
        expect(videos[1].src).toBe("https://example.com/two.mp4");
        expect(
          videos.every(
            (video) => video.controls && !video.autoplay && !video.loop,
          ),
        ).toBe(true);
        expect(doc.body.innerHTML).toMatch(
          /one\.mp4[\s\S]*Between the videos[\s\S]*two\.mp4/,
        );
        expect(doc.body.innerHTML).not.toContain("reader-media.invalid");
      },
    );
  });

  test("keeps a sandboxed YouTube player without source-page scripts or srcdoc", () => {
    check(
      `<iframe src="https://www.youtube.com/embed/abc123" srcdoc="malicious" onload="alert(1)"></iframe><script>alert(1)</script>`,
      (doc) => {
        const player = doc.querySelector("iframe")!;
        expect(player?.src).toBe("https://www.youtube.com/embed/abc123");
        expect(player.getAttribute("sandbox")).toContain("allow-scripts");
        expect(player.hasAttribute("srcdoc")).toBe(false);
        expect(player.hasAttribute("onload")).toBe(false);
        expect(doc.querySelector("script")).toBeNull();
      },
    );
  });

  test("turns unsupported frames into links and rejects fake player hosts", () => {
    check(
      `<iframe title="Video" src="https://www.youtube.com.evil.example/embed/abc123"></iframe>`,
      (doc) => {
        expect(doc.querySelector("iframe")).toBeNull();
        expect(
          doc.querySelector(
            'a[href="https://www.youtube.com.evil.example/embed/abc123"]',
          )?.textContent,
        ).toBe("Video");
      },
    );
  });

  test("selects the saved X post, preserves all its photos and embeds blob videos", () => {
    const post = `<article data-testid="tweet"><a href="/alice/status/123"><time>Today</time></a><div data-testid="tweetText">The saved post</div><img src="https://pbs.twimg.com/media/one.jpg"><img src="https://pbs.twimg.com/media/two.jpg"><video src="blob:https://x.com/123"></video></article>`;
    const reply = `<article data-testid="tweet"><a href="/bob/status/456"><time>Today</time></a><p>Unrelated reply</p><img src="https://pbs.twimg.com/media/reply.jpg"></article>`;
    check(
      post + reply,
      (doc) => {
        expect(doc.querySelectorAll("img")).toHaveLength(2);
        expect(doc.querySelector("iframe")?.src).toBe(
          "https://platform.twitter.com/embed/Tweet.html?id=123",
        );
        expect(doc.body.textContent).toContain("The saved post");
        expect(doc.body.textContent).not.toContain("Unrelated reply");
      },
      "https://x.com/alice/status/123",
    );
  });
  test("decodes Substack direct video sources", () => {
    check(
      `<div class="available-content"><div class="body markup">${prose}<div class="video-embed" data-attrs='{"src":"https://cdn.example.com/movie.mp4"}'></div>${prose}</div></div>`,
      (doc) => {
        expect(doc.querySelector("video")?.src).toBe(
          "https://cdn.example.com/movie.mp4",
        );
        expect(doc.querySelector("video")?.controls).toBe(true);
      },
    );
  });

  test("uses the X player when the crawler only receives a login wall", () => {
    check(
      "<p>Log in to X</p>",
      (doc) => {
        expect(doc.querySelector("iframe")?.src).toBe(
          "https://platform.twitter.com/embed/Tweet.html?id=123",
        );
        expect(doc.body.textContent).not.toContain("Log in to X");
      },
      "https://x.com/alice/status/123",
    );
  });

  test("removes event handlers, unsafe frames and script URLs", () => {
    check(
      `<div data-article-body>${prose}<img src="javascript:alert(1)" onerror="alert(1)"><video src="javascript:alert(1)" onplay="alert(1)"></video><iframe src="javascript:alert(1)"></iframe><script>alert(1)</script></div>`,
      (doc) => {
        expect(
          doc.querySelector("script, iframe, [onerror], [onplay]"),
        ).toBeNull();
        expect(doc.querySelector("img")?.hasAttribute("src")).toBe(false);
        expect(doc.querySelector("video")?.hasAttribute("src")).toBe(false);
      },
      "https://www.anthropic.com/research/test",
    );
  });
});
