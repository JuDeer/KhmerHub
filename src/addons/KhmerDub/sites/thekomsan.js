import { fetchText, fetchJson } from "../utils/fetch.js";

const BASE_URL = "https://www.thekomsan.com";
const BLOG_ID = "868925748946685134";
const FEED_URL = `${BASE_URL}/feeds/posts/default`;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const VIDEO_EXTENSIONS =
  /\.(?:m3u8|mp4|mkv|webm|mov|avi)(?:[?#].*)?$/i;

const EMBED_HOSTS =
  /(?:youtube\.com|youtu\.be|ok\.ru|dailymotion\.com|dai\.ly|facebook\.com|drive\.google\.com|streamtape\.com|dood|mixdrop|filemoon|vidhide|voe\.sx|uqload|streamwish|vidmoly|sendvid)/i;

/**
 * Convert HTML entities without requiring a browser DOM.
 */
function decodeHtml(value = "") {
  return String(value)
    .replace(/&#(\d+);/g, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 10))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    )
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

/**
 * Remove HTML tags and normalize whitespace.
 */
function stripHtml(value = "") {
  return decodeHtml(
    String(value)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/p>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(value, baseUrl = BASE_URL) {
  if (!value) {
    return "";
  }

  let url = decodeHtml(String(value).trim())
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/^['"]|['"]$/g, "");

  if (!url) {
    return "";
  }

  if (url.startsWith("//")) {
    url = `https:${url}`;
  }

  try {
    return new URL(url, baseUrl).href;
  } catch {
    return url;
  }
}

function makeAbsoluteUrl(value) {
  return normalizeUrl(value, BASE_URL);
}

function removeDuplicateItems(items, keyBuilder) {
  const seen = new Set();

  return items.filter((item) => {
    const key = keyBuilder(item);

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function getAlternateLink(entry) {
  return (
    entry?.link?.find((item) => item?.rel === "alternate")?.href ||
    entry?.link?.find((item) => item?.type === "text/html")?.href ||
    ""
  );
}

function getEntryId(entry) {
  const rawId = entry?.id?.$t || "";

  return (
    rawId.match(/post-(\d+)/i)?.[1] ||
    rawId.match(/\/posts\/default\/(\d+)/i)?.[1] ||
    ""
  );
}

function getCategories(entry) {
  return (
    entry?.category
      ?.map((item) => item?.term?.trim())
      .filter(Boolean) || []
  );
}

function getThumbnail(entry) {
  const candidates = [
    entry?.media$thumbnail?.url,
    entry?.media$content?.[0]?.url,
    extractFirstImage(entry?.content?.$t),
    extractFirstImage(entry?.summary?.$t),
  ];

  const thumbnail = candidates.find(Boolean);

  return upgradeBloggerImage(thumbnail || "");
}

function upgradeBloggerImage(value) {
  const url = normalizeUrl(value);

  if (!url) {
    return "";
  }

  return url
    .replace(/\/s72-c\//i, "/s600/")
    .replace(/\/s72-c$/i, "/s600")
    .replace(/\/w72-h72-[^/]+\//i, "/s600/")
    .replace(/\/w72-h72-[^/]+$/i, "/s600")
    .replace(/\/s320\//i, "/s600/")
    .replace(/\/s320$/i, "/s600")
    .replace(/=w72-h72-[^&]+$/i, "=s600")
    .replace(/=s320$/i, "=s600");
}

function extractFirstImage(html = "") {
  const source = String(html);

  const match =
    source.match(
      /<img\b[^>]*(?:data-src|data-original|src)=["']([^"']+)["'][^>]*>/i
    ) ||
    source.match(
      /<(?:meta|link)\b[^>]*(?:content|href)=["']([^"']+\.(?:jpg|jpeg|png|webp)(?:\?[^"']*)?)["'][^>]*>/i
    );

  return match?.[1] || "";
}

function cleanTitle(value = "") {
  return decodeHtml(String(value))
    .replace(/\u200b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseEpisodeCount(title = "") {
  const match = String(title).match(
    /\[(\d+)\s*(?:ep|end|episode|episodes)?\]/i
  );

  return match ? Number.parseInt(match[1], 10) : null;
}

function mapFeedEntry(entry) {
  const title = cleanTitle(entry?.title?.$t);
  const url = makeAbsoluteUrl(getAlternateLink(entry));
  const categories = getCategories(entry);

  return {
    id: getEntryId(entry) || url,
    title,
    name: title,
    url,
    poster: getThumbnail(entry),
    background: getThumbnail(entry),
    description: stripHtml(
      entry?.summary?.$t || entry?.content?.$t || ""
    ),
    categories,
    genres: categories,
    published: entry?.published?.$t || "",
    updated: entry?.updated?.$t || "",
    episodeCount: parseEpisodeCount(title),
    source: "thekomsan",
    sourceType: "blogger",
  };
}

function clampLimit(value) {
  const number = Number.parseInt(value, 10);

  if (!Number.isFinite(number) || number <= 0) {
    return DEFAULT_LIMIT;
  }

  return Math.min(number, MAX_LIMIT);
}

function normalizePage(value) {
  const number = Number.parseInt(value, 10);

  return Number.isFinite(number) && number > 0 ? number : 1;
}

function createFeedUrl({
  page = 1,
  limit = DEFAULT_LIMIT,
  label = "",
  query = "",
  orderBy = "published",
} = {}) {
  const safePage = normalizePage(page);
  const safeLimit = clampLimit(limit);
  const startIndex = (safePage - 1) * safeLimit + 1;

  let feedUrl = FEED_URL;

  if (label) {
    feedUrl += `/-/${encodeURIComponent(label)}`;
  }

  const url = new URL(feedUrl);

  url.searchParams.set("alt", "json");
  url.searchParams.set("start-index", String(startIndex));
  url.searchParams.set("max-results", String(safeLimit));
  url.searchParams.set("orderby", orderBy);

  if (query) {
    url.searchParams.set("q", query.trim());
  }

  return url.href;
}

async function requestJson(url, options = {}) {
  if (typeof fetchJson === "function") {
    return fetchJson(url, options);
  }

  const text = await fetchText(url, options);
  return JSON.parse(text);
}

function parseOpenSearchNumber(feed, key) {
  const value = feed?.[key]?.$t;
  const number = Number.parseInt(value, 10);

  return Number.isFinite(number) ? number : 0;
}

/**
 * Load catalog items from the Blogger JSON feed.
 */
export async function getCatalog({
  page = 1,
  limit = DEFAULT_LIMIT,
  label = "",
  query = "",
} = {}) {
  const safePage = normalizePage(page);
  const safeLimit = clampLimit(limit);

  const url = createFeedUrl({
    page: safePage,
    limit: safeLimit,
    label,
    query,
  });

  const data = await requestJson(url, {
    headers: {
      Accept: "application/json,text/plain,*/*",
      Referer: `${BASE_URL}/`,
    },
  });

  const feed = data?.feed || {};
  const entries = Array.isArray(feed.entry) ? feed.entry : [];
  const items = entries
    .map(mapFeedEntry)
    .filter((item) => item.title && item.url);

  const total = parseOpenSearchNumber(feed, "openSearch$totalResults");
  const startIndex =
    parseOpenSearchNumber(feed, "openSearch$startIndex") ||
    (safePage - 1) * safeLimit + 1;

  const itemsPerPage =
    parseOpenSearchNumber(feed, "openSearch$itemsPerPage") ||
    safeLimit;

  const nextStartIndex = startIndex + items.length;
  const hasMore =
    items.length >= itemsPerPage &&
    (total === 0 || nextStartIndex <= total);

  return {
    items,
    results: items,
    page: safePage,
    limit: safeLimit,
    total,
    hasMore,
    nextPage: hasMore ? safePage + 1 : null,
    source: "thekomsan",
  };
}

/**
 * Alias used by engines that call the site catalog function "getPosts".
 */
export async function getPosts(options = {}) {
  return getCatalog(options);
}

/**
 * Search TheKomsan through the Blogger JSON feed.
 */
export async function search(query, options = {}) {
  const keyword = String(query || "").trim();

  if (!keyword) {
    return {
      items: [],
      results: [],
      page: 1,
      limit: clampLimit(options.limit),
      total: 0,
      hasMore: false,
      nextPage: null,
      source: "thekomsan",
    };
  }

  return getCatalog({
    ...options,
    query: keyword,
  });
}

/**
 * Load posts by a Blogger label.
 */
export async function getByLabel(label, options = {}) {
  return getCatalog({
    ...options,
    label: String(label || "").trim(),
  });
}

function getPostIdFromUrl(value) {
  const url = String(value || "");

  return (
    url.match(/[?&]postId=(\d+)/i)?.[1] ||
    url.match(/\/posts\/default\/(\d+)/i)?.[1] ||
    ""
  );
}

function findEntryByUrl(entries, targetUrl) {
  let normalizedTarget = "";

  try {
    normalizedTarget = new URL(targetUrl).pathname.replace(/\/+$/, "");
  } catch {
    normalizedTarget = String(targetUrl);
  }

  return entries.find((entry) => {
    const link = getAlternateLink(entry);

    try {
      return (
        new URL(link).pathname.replace(/\/+$/, "") ===
        normalizedTarget
      );
    } catch {
      return link === targetUrl;
    }
  });
}

async function findPostEntry(seriesUrl) {
  const postId = getPostIdFromUrl(seriesUrl);

  if (postId) {
    const url = new URL(`${FEED_URL}/${postId}`);
    url.searchParams.set("alt", "json");

    const data = await requestJson(url.href, {
      headers: {
        Accept: "application/json,text/plain,*/*",
        Referer: seriesUrl,
      },
    });

    return data?.entry || null;
  }

  const slug = new URL(seriesUrl).pathname
    .split("/")
    .filter(Boolean)
    .pop()
    ?.replace(/\.html$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();

  if (!slug) {
    return null;
  }

  const searchUrl = createFeedUrl({
    page: 1,
    limit: 20,
    query: slug,
  });

  const data = await requestJson(searchUrl, {
    headers: {
      Accept: "application/json,text/plain,*/*",
      Referer: seriesUrl,
    },
  });

  const entries = Array.isArray(data?.feed?.entry)
    ? data.feed.entry
    : [];

  return findEntryByUrl(entries, seriesUrl) || entries[0] || null;
}

function parseJsString(value = "") {
  return decodeHtml(
    String(value)
      .trim()
      .replace(/^['"]|['"]$/g, "")
      .replace(/\\(['"\\])/g, "$1")
      .replace(/\\n/g, " ")
      .replace(/\\r/g, " ")
      .replace(/\\t/g, " ")
      .replace(/\\u0026/gi, "&")
      .replace(/\\u003d/gi, "=")
      .replace(/\\u002f/gi, "/")
      .replace(/\\\//g, "/")
  );
}

function extractBalancedArray(source, startIndex) {
  let depth = 0;
  let quote = "";
  let escaped = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const character = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = "";
      }

      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }

    if (character === "[") {
      depth += 1;
    } else if (character === "]") {
      depth -= 1;

      if (depth === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }

  return "";
}

function extractNamedArray(source, variableName) {
  const pattern = new RegExp(
    `(?:var|let|const)?\\s*${variableName}\\s*=\\s*`,
    "i"
  );

  const match = pattern.exec(source);

  if (!match) {
    return "";
  }

  const arrayStart = source.indexOf("[", match.index + match[0].length);

  if (arrayStart === -1) {
    return "";
  }

  return extractBalancedArray(source, arrayStart);
}

function parseObjectProperty(objectText, propertyNames) {
  for (const property of propertyNames) {
    const patterns = [
      new RegExp(
        `(?:^|[,\\s{])["']?${property}["']?\\s*:\\s*["']([^"']+)["']`,
        "i"
      ),
      new RegExp(
        `(?:^|[,\\s{])["']?${property}["']?\\s*:\\s*\`([^\`]+)\``,
        "i"
      ),
    ];

    for (const pattern of patterns) {
      const match = objectText.match(pattern);

      if (match?.[1]) {
        return parseJsString(match[1]);
      }
    }
  }

  return "";
}

function splitTopLevelObjects(arrayText) {
  const body = arrayText.trim().replace(/^\[/, "").replace(/\]$/, "");
  const objects = [];

  let start = -1;
  let depth = 0;
  let quote = "";
  let escaped = false;

  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = "";
      }

      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }

    if (character === "{") {
      if (depth === 0) {
        start = index;
      }

      depth += 1;
    } else if (character === "}") {
      depth -= 1;

      if (depth === 0 && start !== -1) {
        objects.push(body.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return objects;
}

function parseListVideoIframe(source, pageUrl) {
  const arrayText =
    extractNamedArray(source, "list_vdoiframe") ||
    extractNamedArray(source, "listVdoIframe") ||
    extractNamedArray(source, "playlist") ||
    "";

  if (!arrayText) {
    return [];
  }

  const objectEntries = splitTopLevelObjects(arrayText);

  return objectEntries
    .map((objectText, index) => {
      const title =
        parseObjectProperty(objectText, [
          "title",
          "name",
          "label",
          "episode",
        ]) || `Episode ${index + 1}`;

      const file = parseObjectProperty(objectText, [
        "file",
        "url",
        "src",
        "link",
      ]);

      const image = parseObjectProperty(objectText, [
        "image",
        "poster",
        "thumbnail",
      ]);

      return {
        title: cleanTitle(title),
        url: normalizeUrl(file, pageUrl),
        poster: upgradeBloggerImage(
          normalizeUrl(image, pageUrl)
        ),
      };
    })
    .filter((item) => item.url);
}

function getAttribute(tag, attribute) {
  const pattern = new RegExp(
    `\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i"
  );

  const match = tag.match(pattern);

  return decodeHtml(match?.[1] || match?.[2] || match?.[3] || "");
}

function extractIframeEpisodes(source, pageUrl) {
  const episodes = [];
  const iframePattern = /<iframe\b[^>]*>/gi;

  let match;

  while ((match = iframePattern.exec(source))) {
    const iframe = match[0];
    const src =
      getAttribute(iframe, "data-src") ||
      getAttribute(iframe, "src");

    if (!src || src === "about:blank") {
      continue;
    }

    const title =
      getAttribute(iframe, "title") ||
      getAttribute(iframe, "name") ||
      `Episode ${episodes.length + 1}`;

    episodes.push({
      title: cleanTitle(title),
      url: normalizeUrl(src, pageUrl),
      poster: "",
    });
  }

  return episodes;
}

function extractVideoEpisodes(source, pageUrl) {
  const episodes = [];
  const videoPattern = /<(?:video|source)\b[^>]*>/gi;

  let match;

  while ((match = videoPattern.exec(source))) {
    const tag = match[0];
    const src =
      getAttribute(tag, "data-src") ||
      getAttribute(tag, "src");

    if (!src) {
      continue;
    }

    episodes.push({
      title: `Episode ${episodes.length + 1}`,
      url: normalizeUrl(src, pageUrl),
      poster: upgradeBloggerImage(
        normalizeUrl(getAttribute(tag, "poster"), pageUrl)
      ),
    });
  }

  return episodes;
}

function extractAnchorEpisodes(source, pageUrl) {
  const episodes = [];
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let match;

  while ((match = anchorPattern.exec(source))) {
    const url = normalizeUrl(match[1], pageUrl);
    const title = stripHtml(match[2]);

    if (
      !url ||
      (!VIDEO_EXTENSIONS.test(url) && !EMBED_HOSTS.test(url))
    ) {
      continue;
    }

    episodes.push({
      title: title || `Episode ${episodes.length + 1}`,
      url,
      poster: "",
    });
  }

  return episodes;
}

function extractRawVideoUrls(source, pageUrl) {
  const results = [];
  const urlPattern =
    /https?:\\?\/\\?\/[^\s"'<>\\]+|\/\/[^\s"'<>\\]+/gi;

  const matches = String(source).match(urlPattern) || [];

  for (const rawValue of matches) {
    const url = normalizeUrl(rawValue, pageUrl);

    if (
      !url ||
      (!VIDEO_EXTENSIONS.test(url) && !EMBED_HOSTS.test(url))
    ) {
      continue;
    }

    results.push({
      title: `Episode ${results.length + 1}`,
      url,
      poster: "",
    });
  }

  return results;
}

function extractEpisodeNumber(value = "") {
  const patterns = [
    /\b(?:episode|ep)\s*[-_.:]?\s*(\d+)\b/i,
    /\bpart\s*[-_.:]?\s*(\d+)\b/i,
    /\b(\d+)\s*(?:episode|ep)\b/i,
    /(?:^|\D)(\d{1,4})(?:\D|$)/,
  ];

  for (const pattern of patterns) {
    const match = String(value).match(pattern);

    if (match) {
      return Number.parseInt(match[1], 10);
    }
  }

  return null;
}

function normalizeEpisodeTitles(episodes) {
  return episodes.map((episode, index) => {
    const number =
      extractEpisodeNumber(episode.title) ||
      extractEpisodeNumber(episode.url);

    return {
      ...episode,
      id: `${number || index + 1}`,
      number: number || index + 1,
      title:
        episode.title &&
        !/^episode\s+\d+$/i.test(episode.title)
          ? episode.title
          : `Episode ${number || index + 1}`,
      name:
        episode.title &&
        !/^episode\s+\d+$/i.test(episode.title)
          ? episode.title
          : `Episode ${number || index + 1}`,
      source: "thekomsan",
    };
  });
}

function parseEpisodes(source, pageUrl) {
  const episodes = [
    ...parseListVideoIframe(source, pageUrl),
    ...extractIframeEpisodes(source, pageUrl),
    ...extractVideoEpisodes(source, pageUrl),
    ...extractAnchorEpisodes(source, pageUrl),
    ...extractRawVideoUrls(source, pageUrl),
  ];

  const uniqueEpisodes = removeDuplicateItems(
    episodes.filter((item) => item.url),
    (item) => item.url
  );

  return normalizeEpisodeTitles(uniqueEpisodes);
}

/**
 * Load a single Blogger post and extract its episode playlist.
 */
export async function getSeries(seriesUrl) {
  const url = makeAbsoluteUrl(seriesUrl);

  if (!url) {
    throw new Error("[thekomsan] Missing series URL");
  }

  let entry = null;

  try {
    entry = await findPostEntry(url);
  } catch (error) {
    console.log(
      "[thekomsan] Blogger entry lookup failed:",
      error?.response?.status || error?.message
    );
  }

  let html = "";
  let content = entry?.content?.$t || "";

  try {
    html = await fetchText(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        Referer: `${BASE_URL}/`,
      },
    });
  } catch (error) {
    console.log(
      "[thekomsan] page fetch failed:",
      error?.response?.status || error?.message
    );
  }

  const combinedSource = `${content}\n${html}`;
  const episodes = parseEpisodes(combinedSource, url);

  const mappedEntry = entry
    ? mapFeedEntry(entry)
    : {
        id: url,
        title: cleanTitle(
          html.match(
            /<h1\b[^>]*class=["'][^"']*entry-title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i
          )?.[1] ||
            html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
            ""
        ),
        name: "",
        url,
        poster: upgradeBloggerImage(extractFirstImage(html)),
        background: "",
        description: "",
        categories: [],
        genres: [],
        published: "",
        updated: "",
        episodeCount: null,
        source: "thekomsan",
        sourceType: "blogger",
      };

  mappedEntry.name = mappedEntry.name || mappedEntry.title;
  mappedEntry.background =
    mappedEntry.background || mappedEntry.poster;

  return {
    ...mappedEntry,
    url,
    episodes,
    videos: episodes,
  };
}

/**
 * Alias used by engines that request episodes directly.
 */
export async function getEpisodes(seriesUrl) {
  const series = await getSeries(seriesUrl);
  return series.episodes;
}

/**
 * Load one episode by its index or episode number.
 */
export async function getEpisode(seriesUrl, episodeValue) {
  const episodes = await getEpisodes(seriesUrl);
  const requested = Number.parseInt(episodeValue, 10);

  if (!Number.isFinite(requested)) {
    return episodes[0] || null;
  }

  return (
    episodes.find(
      (episode) =>
        episode.number === requested ||
        Number.parseInt(episode.id, 10) === requested
    ) ||
    episodes[requested] ||
    episodes[requested - 1] ||
    null
  );
}

export const thekomsan = {
  id: "thekomsan",
  name: "TheKomsan",
  prefix: "thekomsan",
  baseUrl: BASE_URL,
  blogId: BLOG_ID,
  feedUrl: FEED_URL,
  sourceType: "blogger",

  getCatalog,
  getPosts,
  getByLabel,
  search,
  getSeries,
  getEpisodes,
  getEpisode,
};

export default thekomsan;
