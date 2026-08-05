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
const SITE_ID = "thekomsan";
const SITE_NAME = "TheKomsan";
const BASE_URL = "https://www.thekomsan.com";

const PAGE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9," +
    "image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Pragma: "no-cache"
};

/* =========================
   BASIC HELPERS
========================= */
function absolutizeUrl(url, baseUrl = BASE_URL) {
  if (!url) return "";

  try {
    return new URL(String(url).trim(), baseUrl).toString();
  } catch {
    return String(url).trim();
  }
}

function cleanTitle(text) {
  return String(text || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value) {
  if (!value) return "";

  return String(value)
    .replace(/&quot;/gi, '"')
    .replace(/&#34;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function normalizeTheKomsanPoster(url) {
  if (!url) return "";

  let poster = decodeHtmlEntities(String(url).trim());

  if (poster.startsWith("//")) {
    poster = `https:${poster}`;
  }

  poster = poster
    // Blogger path image sizing.
    .replace(/\/w\d+-h\d+[^/]*\//gi, "/s0/")
    .replace(/\/s\d+(-c|-rw)?\//gi, "/s0/")
    .replace(/\/s\d+-r[w|h]\//gi, "/s0/")

    // Blogger query/equal image sizing.
    .replace(/=w\d+-h\d+[^&"']*/gi, "=s0")
    .replace(/=s\d+(-c|-rw)?/gi, "=s0");

  return normalizePoster(poster);
}

function normalizeEpisodeTitle(title, index) {
  const fallback = `Episode ${index + 1}`;
  let value = cleanTitle(title);

  if (!value) return fallback;

  value = value
    .replace(/^EPISODE\s*/i, "Episode ")
    .replace(/^EP\s*/i, "Episode ");

  value = value.replace(
    /^Episode\s*(\d+)\s*(?:E|END)$/i,
    "Episode $1 End"
  );

  value = value.replace(
    /^Episode\s*(\d+)\s*-\s*(?:E|END)$/i,
    "Episode $1 End"
  );

  return value;
}

function normalizeVideoUrl(url, baseUrl = BASE_URL) {
  if (!url) return "";

  let value = decodeHtmlEntities(String(url).trim());

  value = value
    .replace(/\\\//g, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\x26/gi, "&");

  if (value.startsWith("//")) {
    value = `https:${value}`;
  } else if (value.startsWith("/")) {
    value = absolutizeUrl(value, baseUrl);
  }

  return value;
}

function extractYouTubeId(url) {
  if (!url) return "";

  return (
    url.match(/youtu\.be\/([^?&/]+)/i)?.[1] ||
    url.match(/[?&]v=([^&]+)/i)?.[1] ||
    url.match(/youtube\.com\/embed\/([^?&/]+)/i)?.[1] ||
    url.match(/youtube\.com\/shorts\/([^?&/]+)/i)?.[1] ||
    ""
  );
}

function isDirectVideoUrl(url) {
  return /\.(?:m3u8|mp4|mkv|webm)(?:$|[?#])/i.test(url || "");
}

/* =========================
   JAVASCRIPT STRING PARSING
========================= */
function decodeJavaScriptString(value, quote = '"') {
  if (value == null) return "";

  let result = String(value);

  result = result
    .replace(/\\u([0-9a-f]{4})/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/\\x([0-9a-f]{2})/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\//g, "/")
    .replace(/\\\\/g, "\\");

  if (quote === '"') {
    result = result.replace(/\\"/g, '"');
  }

  if (quote === "'") {
    result = result.replace(/\\'/g, "'");
  }

  return result;
}

function readObjectStringProperty(objectText, propertyName) {
  const pattern = new RegExp(
    `(?:^|[,\\s{])${propertyName}\\s*:\\s*(["'])([\\s\\S]*?)\\1`,
    "i"
  );

  const match = objectText.match(pattern);
  if (!match) return "";

  return decodeJavaScriptString(match[2], match[1]);
}

function extractArraySource(html) {
  const patterns = [
    /(?:const|let|var)\s+videos\s*=\s*(\[[\s\S]*?\])\s*;/i,
    /window\.videos\s*=\s*(\[[\s\S]*?\])\s*;/i,
    /options\.player_list\s*=\s*(\[[\s\S]*?\])\s*;/i,
    /player_list\s*:\s*(\[[\s\S]*?\])\s*[,}]/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return "";
}

function splitJavaScriptObjects(arraySource) {
  if (!arraySource) return [];

  const objects = [];

  let quote = "";
  let escaped = false;
  let depth = 0;
  let start = -1;

  for (let i = 0; i < arraySource.length; i += 1) {
    const char = arraySource[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = "";
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        start = i;
      }

      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;

      if (depth === 0 && start >= 0) {
        objects.push(arraySource.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return objects;
}

/* =========================
   VIDEO ARRAY
========================= */
function parseVideosArray(html, pageUrl = BASE_URL) {
  try {
    const arraySource = extractArraySource(html);
    if (!arraySource) return [];

    const objectSources = splitJavaScriptObjects(arraySource);

    const videos = objectSources
      .map((objectText, index) => {
        const rawTitle =
          readObjectStringProperty(objectText, "title") ||
          readObjectStringProperty(objectText, "label") ||
          readObjectStringProperty(objectText, "name");

        const rawFile =
          readObjectStringProperty(objectText, "file") ||
          readObjectStringProperty(objectText, "url") ||
          readObjectStringProperty(objectText, "src");

        const file = normalizeVideoUrl(rawFile, pageUrl);
        if (!file) return null;

        return {
          title: normalizeEpisodeTitle(rawTitle, index),
          file
        };
      })
      .filter(Boolean);

    const seen = new Set();

    return videos.filter((video) => {
      if (seen.has(video.file)) return false;

      seen.add(video.file);
      return true;
    });
  } catch (err) {
    console.log(`[${SITE_ID}] parseVideosArray failed:`, err.message);
    return [];
  }
}

/* =========================
   PAGE METADATA
========================= */
function extractPageTitle($) {
  return (
    cleanTitle($("h1.entry-title").first().text()) ||
    cleanTitle($('meta[property="og:title"]').attr("content")) ||
    cleanTitle($('meta[name="twitter:title"]').attr("content")) ||
    cleanTitle($("title").text())
  );
}

function extractPagePoster($) {
  const poster =
    $('meta[property="og:image"]').attr("content") ||
    $('meta[name="twitter:image"]').attr("content") ||
    $('meta[itemprop="image"]').attr("content") ||
    $("#my-poster img").first().attr("data-src") ||
    $("#my-poster img").first().attr("src") ||
    $(".post-body img").first().attr("data-src") ||
    $(".post-body img").first().attr("src") ||
    "";

  return normalizeTheKomsanPoster(poster);
}

function extractPublishedDate($) {
  const value =
    $('meta[itemprop="datePublished"]').attr("content") ||
    $('time[itemprop="datePublished"]').attr("datetime") ||
    $(".post-date.published").attr("datetime") ||
    $("script[type='application/ld+json']")
      .toArray()
      .map((el) => {
        try {
          const parsed = JSON.parse($(el).html() || "{}");
          return parsed?.datePublished || "";
        } catch {
          return "";
        }
      })
      .find(Boolean) ||
    "";

  if (!value) return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function getPageDetail(url) {
  try {
    const { data } = await axiosClient.get(url, {
      headers: {
        ...PAGE_HEADERS,
        Referer: BASE_URL
      },
      timeout: 20000
    });

    const $ = cheerio.load(data);

    const title = extractPageTitle($);
    const thumbnail = extractPagePoster($);
    const releasedDate = extractPublishedDate($);
    const videos = parseVideosArray(data, url);

    if (!videos.length) {
      console.log(`[${SITE_ID}] no videos found:`, url);
      return null;
    }

    return {
      title,
      thumbnail,
      released: releasedDate?.toISOString() || null,
      videos
    };
  } catch (err) {
    console.log(`[${SITE_ID}] getPageDetail failed:`, err.message);
    return null;
  }
}

/* =========================
   CATALOG PARSING
========================= */
function findCatalogPosts($) {
  const selectors = [
    "div.blog-posts div.grid-posts article.blog-post",
    "div.grid-posts article.blog-post",
    "article.blog-post",
    "article.hentry",
    ".post-filter"
  ];

  for (const selector of selectors) {
    const posts = $(selector).toArray();

    if (posts.length) {
      return posts;
    }
  }

  return [];
}

function extractCatalogLink($el, pageUrl) {
  const candidates = [
    $el.find("a.post-filter-link").first(),
    $el.find("h2.entry-title a").first(),
    $el.find("h3.entry-title a").first(),
    $el.find("a[href]").first()
  ];

  for (const candidate of candidates) {
    const href = candidate.attr("href");

    if (href) {
      return absolutizeUrl(href, pageUrl);
    }
  }

  return "";
}

function extractCatalogTitle($el) {
  const linkEl =
    $el.find("a.post-filter-link").first().length > 0
      ? $el.find("a.post-filter-link").first()
      : $el.find("h2.entry-title a").first();

  return (
    cleanTitle(linkEl.attr("title")) ||
    cleanTitle($el.find("h2.entry-title").first().text()) ||
    cleanTitle($el.find("h3.entry-title").first().text()) ||
    cleanTitle(linkEl.text()) ||
    cleanTitle($el.find("img").first().attr("alt"))
  );
}

function extractCatalogPoster($el) {
  const img = $el.find("img.snip-thumbnail, img").first();

  const poster =
    img.attr("data-src") ||
    img.attr("data-original") ||
    img.attr("data-lazy-src") ||
    img.attr("src") ||
    "";

  return normalizeTheKomsanPoster(poster);
}

/* =========================
   CATALOG
========================= */
async function getCatalogItems(prefix, siteConfig, url) {
  try {
    const pageUrl = absolutizeUrl(
      url || siteConfig?.baseUrl || BASE_URL,
      BASE_URL
    );

    const { data } = await axiosClient.get(pageUrl, {
      headers: {
        ...PAGE_HEADERS,
        Referer: siteConfig?.baseUrl || BASE_URL
      },
      timeout: 20000
    });

    const $ = cheerio.load(data);
    const posts = findCatalogPosts($);

    const results = posts
      .map((post) => {
        const $el = $(post);

        const link = extractCatalogLink($el, pageUrl);
        const title = extractCatalogTitle($el);

        if (!title || !link) return null;

        if (!/^https?:\/\//i.test(link)) return null;
        if (!/thekomsan\.com/i.test(link)) return null;
        if (/\/search(?:\/|[?#]|$)/i.test(link)) return null;
        if (/\/p\//i.test(link)) return null;

        return {
          id: `${prefix}:${encodeURIComponent(link)}`,
          name: title,
          poster: extractCatalogPoster($el)
        };
      })
      .filter(Boolean);

    return uniqById(results);
  } catch (err) {
    console.log(`[${SITE_ID}] getCatalogItems failed:`, err.message);
    return [];
  }
}

/* =========================
   PAGINATION
========================= */
function getNextPageUrl(base, html) {
  try {
    const $ = cheerio.load(html);

    const nextUrl =
      $("#Blog1_blog-pager-older-link").attr("href") ||
      $("a.blog-pager-older-link").attr("href") ||
      $(".blog-pager-older-link").attr("href") ||
      $("#blog-pager-older-link").attr("href") ||
      $('a[rel="next"]').attr("href") ||
      "";

    if (nextUrl) {
      return absolutizeUrl(nextUrl, base || BASE_URL);
    }

    const posts = findCatalogPosts($);
    if (!posts.length) return null;

    const lastPost = $(posts[posts.length - 1]);

    const published =
      lastPost.find('meta[itemprop="datePublished"]').attr("content") ||
      lastPost.find("time[datetime]").attr("datetime") ||
      lastPost.find(".published").attr("datetime") ||
      "";

    if (!published) return null;

    const searchBase = absolutizeUrl("/search", base || BASE_URL);
    const next = new URL(searchBase);

    next.searchParams.set("updated-max", published);
    next.searchParams.set("max-results", "20");

    return next.toString();
  } catch (err) {
    console.log(`[${SITE_ID}] getNextPageUrl failed:`, err.message);
    return null;
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
        id:
          `${prefix}:${encodeURIComponent(seriesUrl)}` +
          `:1:${episodeNumber}`,

        title:
          video.title ||
          `Episode ${String(episodeNumber).padStart(2, "0")}`,

        seriesTitle: detail.title,
        season: 1,
        episode: episodeNumber,
        thumbnail: detail.thumbnail || "",
        released: detail.released || new Date().toISOString()
      };
    });
  } catch (err) {
    console.log(`[${SITE_ID}] getEpisodes failed:`, err.message);
    return [];
  }
}

/* =========================
   STREAM RESOLUTION
========================= */
async function resolveStreamUrl(inputUrl, seriesUrl) {
  let url = normalizeVideoUrl(inputUrl, seriesUrl);

  if (!url) return "";

  if (/player\.php/i.test(url)) {
    const resolved = await resolvePlayerUrl(url);

    if (resolved) {
      url = normalizeVideoUrl(resolved, seriesUrl);
    }
  }

  if (/ok\.ru\/videoembed\//i.test(url)) {
    const cleaned = url
      .replace(/([?&])autoplay=1(?:&|$)/gi, "$1")
      .replace(/[?&]$/, "");

    const resolved = await resolveOkEmbed(cleaned);
    url = normalizeVideoUrl(resolved || cleaned, seriesUrl);
  }

  return url;
}

/* =========================
   STREAM
========================= */
async function getStream(prefix, seriesUrl, episode) {
  try {
    const episodeNumber = Number.parseInt(episode, 10);

    if (!Number.isFinite(episodeNumber) || episodeNumber < 1) {
      return null;
    }

    const detail = await getPageDetail(seriesUrl);
    if (!detail?.videos?.length) return null;

    const video = detail.videos[episodeNumber - 1];
    if (!video?.file) return null;

    let url = normalizeVideoUrl(video.file, seriesUrl);
    if (!url) return null;

    if (/youtu\.be|youtube\.com/i.test(url)) {
      const ytId = extractYouTubeId(url);
      if (!ytId) return null;

      return {
        ytId,
        name: SITE_NAME,
        title: video.title || `Episode ${episodeNumber} (YouTube)`,
        behaviorHints: {
          group: SITE_ID
        }
      };
    }

    url = await resolveStreamUrl(url, seriesUrl);
    if (!url) return null;

    return buildStream(
      url,
      episodeNumber,
      video.title || `Episode ${episodeNumber}`,
      SITE_NAME,
      SITE_ID,
      seriesUrl
    );
  } catch (err) {
    console.log(`[${SITE_ID}] getStream failed:`, err.message);
    return null;
  }
}

module.exports = {
  getCatalogItems,
  getEpisodes,
  getStream,
  getNextPageUrl
};
