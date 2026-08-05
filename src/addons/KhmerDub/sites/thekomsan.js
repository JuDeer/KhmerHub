const cheerio = require("cheerio");
const axiosClient = require("../utils/fetch");
const {
  normalizePoster,
  uniqById
} = require("../utils/helpers");

const {
  resolvePlayerUrl,
  resolveOkEmbed,
  buildStream
} = require("../utils/streamResolvers");

/* =========================
   CONFIG
========================= */
const PAGE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9"
};

const DEFAULT_BASE_URL = "https://www.thekomsan.com";
const SITE_NAME = "TheKomsan";
const STREAM_GROUP = "thekomsan";

/* =========================
   HELPERS
========================= */
function absolutizeUrl(url, baseUrl = DEFAULT_BASE_URL) {
  if (!url) return "";

  try {
    return new URL(String(url).trim(), baseUrl).toString();
  } catch {
    return String(url).trim();
  }
}

function cleanTitle(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(text) {
  if (!text) return "";

  return String(text)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => {
      const value = Number(code);
      return Number.isFinite(value) ? String.fromCharCode(value) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const value = parseInt(code, 16);
      return Number.isFinite(value) ? String.fromCharCode(value) : _;
    });
}

function normalizeTheKomsanPoster(url) {
  if (!url) return "";

  let poster = String(url).trim();

  poster = poster
    .replace(/\/w\d+-h\d+[^/]*\//gi, "/s0/")
    .replace(/\/s\d+(-c|-rw)?\//gi, "/s0/")
    .replace(/=w\d+-h\d+[^&]*/gi, "=s0")
    .replace(/=s\d+(-c|-rw)?/gi, "=s0");

  return normalizePoster(poster);
}

function normalizeEpisodeTitle(title, index) {
  let value = cleanTitle(title);

  if (!value) {
    return `Episode ${index + 1}`;
  }

  value = value
    .replace(/^EPISODE\s*/i, "Episode ")
    .replace(/^EP\s*/i, "Episode ");

  value = value.replace(
    /^Episode\s*(\d+)\s*(?:E|END)$/i,
    "Episode $1 End"
  );

  value = value.replace(
    /^Episode\s*(\d+)\s*[-–—]\s*(?:E|END)$/i,
    "Episode $1 End"
  );

  return value;
}

function normalizeVideoUrl(url, baseUrl = DEFAULT_BASE_URL) {
  if (!url) return "";

  let normalized = decodeHtmlEntities(String(url).trim())
    .replace(/\\\//g, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\x26/gi, "&");

  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1).trim();
  }

  if (normalized.startsWith("//")) {
    normalized = `https:${normalized}`;
  } else if (normalized.startsWith("/")) {
    normalized = absolutizeUrl(normalized, baseUrl);
  }

  return normalized;
}

function getYouTubeId(url) {
  if (!url) return "";

  return (
    url.match(/youtu\.be\/([^?&/]+)/i)?.[1] ||
    url.match(/[?&]v=([^&]+)/i)?.[1] ||
    url.match(/\/embed\/([^?&/]+)/i)?.[1] ||
    url.match(/\/shorts\/([^?&/]+)/i)?.[1] ||
    ""
  );
}

function getNextPageUrl(base, html) {
  const $ = cheerio.load(html);

  const older =
    $("a.blog-pager-older-link").attr("href") ||
    $("#Blog1_blog-pager-older-link").attr("href") ||
    $(".blog-pager-older-link").attr("href") ||
    $('a[rel="next"]').attr("href") ||
    "";

  if (older) {
    return absolutizeUrl(older, base);
  }

  const articles = $(
    "article.blog-post, article.hentry, .blog-posts article"
  ).toArray();

  if (!articles.length) return null;

  const last = $(articles[articles.length - 1]);

  const published =
    last.find('meta[itemprop="datePublished"]').attr("content") ||
    last.find("time[datetime]").attr("datetime") ||
    last.find(".published").attr("datetime") ||
    "";

  if (!published) return null;

  return `${base}/search?updated-max=${encodeURIComponent(
    published
  )}&max-results=12`;
}

/* =========================
   VIDEO ARRAY PARSER
========================= */
function extractBalancedArray(source, startIndex) {
  const openIndex = source.indexOf("[", startIndex);
  if (openIndex < 0) return "";

  let depth = 0;
  let quote = "";
  let escaped = false;

  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === quote) {
        quote = "";
      }

      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;

      if (depth === 0) {
        return source.slice(openIndex, i + 1);
      }
    }
  }

  return "";
}

function findVideosArraySource(html) {
  const patterns = [
    /(?:const|let|var)\s+videos\s*=/gi,
    /window\.videos\s*=/gi,
    /options\.player_list\s*=/gi,
    /(?:const|let|var)\s+list_vdoiframe\s*=/gi,
    /window\.list_vdoiframe\s*=/gi
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;

    let match;
    while ((match = pattern.exec(html)) !== null) {
      const arraySource = extractBalancedArray(
        html,
        match.index + match[0].length
      );

      if (arraySource) {
        return arraySource;
      }
    }
  }

  return "";
}

function parseJavaScriptArray(raw) {
  if (!raw) return [];

  const cleaned = raw
    .replace(/^\uFEFF/, "")
    .replace(/<!--/g, "")
    .replace(/-->/g, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Blogger arrays normally use valid JavaScript object syntax,
    // but may not be strict JSON.
  }

  try {
    const parsed = Function(
      `"use strict"; return (${cleaned});`
    )();

    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.log(
      "[thekomsan] parseJavaScriptArray failed:",
      err.message
    );

    return [];
  }
}

function parseVideosArray(html, baseUrl = DEFAULT_BASE_URL) {
  try {
    const raw = findVideosArraySource(html);
    if (!raw) return [];

    const parsed = parseJavaScriptArray(raw);
    if (!parsed.length) return [];

    return parsed
      .map((item, index) => {
        if (!item) return null;

        if (typeof item === "string") {
          const file = normalizeVideoUrl(item, baseUrl);

          if (!file) return null;

          return {
            title: `Episode ${index + 1}`,
            file
          };
        }

        const file = normalizeVideoUrl(
          item.file ||
            item.url ||
            item.src ||
            item.link ||
            item.video ||
            item.embed ||
            "",
          baseUrl
        );

        if (!file) return null;

        return {
          title: normalizeEpisodeTitle(
            item.title ||
              item.name ||
              item.label ||
              item.episode ||
              "",
            index
          ),
          file
        };
      })
      .filter(Boolean);
  } catch (err) {
    console.log(
      "[thekomsan] parseVideosArray failed:",
      err.message
    );

    return [];
  }
}

/* =========================
   FALLBACK VIDEO PARSER
========================= */
function parseFallbackVideos(html, baseUrl) {
  const $ = cheerio.load(html);
  const results = [];

  $("iframe[src]").each((index, element) => {
    const src = normalizeVideoUrl($(element).attr("src"), baseUrl);
    if (!src) return;

    results.push({
      title: `Episode ${index + 1}`,
      file: src
    });
  });

  $("video source[src], video[src]").each((index, element) => {
    const src = normalizeVideoUrl($(element).attr("src"), baseUrl);
    if (!src) return;

    results.push({
      title: `Episode ${results.length + 1}`,
      file: src
    });
  });

  return results.filter(
    (item, index, array) =>
      array.findIndex((entry) => entry.file === item.file) === index
  );
}

/* =========================
   PAGE DETAIL
========================= */
async function getPageDetail(url) {
  try {
    const { data } = await axiosClient.get(url, {
      headers: {
        ...PAGE_HEADERS,
        Referer: url
      }
    });

    const html = String(data || "");
    const $ = cheerio.load(html);

    const title =
      cleanTitle($("h1.entry-title").first().text()) ||
      cleanTitle(
        $('meta[property="og:title"]').first().attr("content")
      ) ||
      cleanTitle(
        $('meta[name="twitter:title"]').first().attr("content")
      ) ||
      cleanTitle($("title").first().text());

    let thumbnail =
      $('meta[property="og:image"]').first().attr("content") ||
      $('meta[name="twitter:image"]').first().attr("content") ||
      $("#my-poster img").first().attr("src") ||
      $("#my-poster img").first().attr("data-src") ||
      $("#postBody img").first().attr("src") ||
      $("meta[itemprop='image']").first().attr("content") ||
      "";

    thumbnail = normalizeTheKomsanPoster(
      absolutizeUrl(thumbnail, url)
    );

    let videos = parseVideosArray(html, url);

    if (!videos.length) {
      videos = parseFallbackVideos(html, url);
    }

    if (!videos.length) return null;

    return {
      title,
      thumbnail,
      videos
    };
  } catch (err) {
    console.log(
      "[thekomsan] getPageDetail failed:",
      err.message
    );

    return null;
  }
}

/* =========================
   CATALOG PARSERS
========================= */
function parseCatalogPost($, element, pageUrl, prefix) {
  const $el = $(element);

  const linkEl =
    $el.find("h2.entry-title a[href]").first().length
      ? $el.find("h2.entry-title a[href]").first()
      : $el.find("a.post-filter-inner[href]").first().length
        ? $el.find("a.post-filter-inner[href]").first()
        : $el.find("a.post-filter-link[href]").first().length
          ? $el.find("a.post-filter-link[href]").first()
          : $el.find("a[href]").first();

  const title =
    cleanTitle(linkEl.attr("title")) ||
    cleanTitle($el.find("h2.entry-title").first().text()) ||
    cleanTitle($el.find(".entry-title").first().text()) ||
    cleanTitle(linkEl.text());

  const link = absolutizeUrl(linkEl.attr("href") || "", pageUrl);

  if (!title || !link) return null;

  const imgEl = $el.find("img.snip-thumbnail, img").first();

  let poster =
    imgEl.attr("data-src") ||
    imgEl.attr("data-original") ||
    imgEl.attr("data-lazy-src") ||
    imgEl.attr("src") ||
    linkEl.find("img").attr("data-src") ||
    linkEl.find("img").attr("src") ||
    "";

  poster = normalizeTheKomsanPoster(
    absolutizeUrl(poster, pageUrl)
  );

  return {
    id: `${prefix}:${encodeURIComponent(link)}`,
    name: title,
    poster
  };
}

/* =========================
   CATALOG
========================= */
async function getCatalogItems(prefix, siteConfig, url) {
  try {
    const pageUrl =
      url ||
      siteConfig?.catalogUrl ||
      siteConfig?.baseUrl ||
      DEFAULT_BASE_URL;

    const { data } = await axiosClient.get(pageUrl, {
      headers: {
        ...PAGE_HEADERS,
        Referer:
          siteConfig?.baseUrl ||
          DEFAULT_BASE_URL
      }
    });

    const $ = cheerio.load(data);

    let posts = $(
      "div.blog-posts div.grid-posts article.blog-post"
    ).toArray();

    if (!posts.length) {
      posts = $(
        ".blog-posts article.blog-post, .blog-posts article.hentry"
      ).toArray();
    }

    if (!posts.length) {
      posts = $(
        "article.blog-post, article.hentry, .post-filter"
      ).toArray();
    }

    const results = posts
      .map((post) =>
        parseCatalogPost($, post, pageUrl, prefix)
      )
      .filter(Boolean);

    return uniqById(results);
  } catch (err) {
    console.log(
      "[thekomsan] getCatalogItems failed:",
      err.message
    );

    return [];
  }
}

/* =========================
   EPISODES
========================= */
async function getEpisodes(prefix, seriesUrl) {
  try {
    const detail = await getPageDetail(seriesUrl);
    if (!detail?.videos?.length) return [];

    return detail.videos.map((video, index) => {
      const episodeNumber = index + 1;

      return {
        id: `${prefix}:${encodeURIComponent(
          seriesUrl
        )}:1:${episodeNumber}`,
        title:
          video.title ||
          `Episode ${String(episodeNumber).padStart(2, "0")}`,
        seriesTitle: detail.title,
        season: 1,
        episode: episodeNumber,
        thumbnail: detail.thumbnail || "",
        released: new Date().toISOString()
      };
    });
  } catch (err) {
    console.log(
      "[thekomsan] getEpisodes failed:",
      err.message
    );

    return [];
  }
}

/* =========================
   STREAM
========================= */
async function getStream(prefix, seriesUrl, episode) {
  try {
    const episodeNumber = Number(episode);

    if (
      !Number.isInteger(episodeNumber) ||
      episodeNumber < 1
    ) {
      return null;
    }

    const detail = await getPageDetail(seriesUrl);
    if (!detail?.videos?.length) return null;

    const video = detail.videos[episodeNumber - 1];
    if (!video?.file) return null;

    let url = normalizeVideoUrl(video.file, seriesUrl);
    if (!url) return null;

    const streamTitle =
      video.title || `Episode ${episodeNumber}`;

    if (/youtu\.be|youtube\.com/i.test(url)) {
      const ytId = getYouTubeId(url);
      if (!ytId) return null;

      return {
        ytId,
        name: SITE_NAME,
        title: `${streamTitle} (YouTube)`,
        behaviorHints: {
          group: STREAM_GROUP
        }
      };
    }

    if (/player\.php/i.test(url)) {
      const resolved = await resolvePlayerUrl(url);

      if (!resolved) return null;

      url = normalizeVideoUrl(resolved, seriesUrl);
    }

    if (/ok\.ru\/videoembed\//i.test(url)) {
      const cleaned = url
        .replace(/([?&])autoplay=1(?=&|$)/gi, "$1")
        .replace(/[?&]$/, "")
        .replace(/\?&/, "?");

      const resolved = await resolveOkEmbed(cleaned);

      url = normalizeVideoUrl(
        resolved || cleaned,
        seriesUrl
      );
    }

    return buildStream(
      url,
      episodeNumber,
      streamTitle,
      SITE_NAME,
      STREAM_GROUP,
      seriesUrl
    );
  } catch (err) {
    console.log(
      "[thekomsan] getStream failed:",
      err.message
    );

    return null;
  }
}

module.exports = {
  getCatalogItems,
  getEpisodes,
  getStream,
  getNextPageUrl
};
