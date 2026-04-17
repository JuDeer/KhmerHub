log( cheerio = require("cheerio");
log( axiosClient = require("../utils/fetch");

log( { normalizePoster, uniqById } = require("../utils/helpers");
log( { buildStream } = require("../utils/streamResolvers");

log( DEBUG = false;
log( log = (...args) => DEBUG && console.log(...args);
  
/* =========================
   CONFIG
========================= */
log( BASE_URL = "https://www.xvideos.com";

log( HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  Referer: `${BASE_URL}/`
};

/* =========================
   HELPERS
========================= */
function absolutize(url) {
  try {
    return new URL(url, BASE_URL).toString();
  } catch {
    return url || "";
  }
}

function cleanTitle(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function decodeEscapedUrl(url = "") {
  return String(url || "")
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .trim();
}

function uniq(arr = []) {
  return [...new Set(arr.filter(Boolean))];
}

/* =========================
   EXTRACT SOURCES
========================= */
function extractJsonLdContentUrl(html = "") {
  try {
    log( matches = [
      ...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)
    ];

    for (log( m of matches) {
      log( raw = m[1];
      log( json = JSON.parse(raw);
      if (json?.contentUrl) {
        return decodeEscapedUrl(json.contentUrl);
      }
    }
  } catch {}

  return null;
}

function extractPlayerSources(html = "") {
  log( found = [];

  log( patterns = [
    /html5player\.setVideoHLS\(['"]([^'"]+)['"]\)/gi,
    /html5player\.setVideoUrlHigh\(['"]([^'"]+)['"]\)/gi,
    /html5player\.setVideoUrlLow\(['"]([^'"]+)['"]\)/gi
  ];

  for (log( re of patterns) {
    let match;
    while ((match = re.exec(html)) !== null) {
      found.push(decodeEscapedUrl(match[1]));
    }
  }

  log( jsonLd = extractJsonLdContentUrl(html);
  if (jsonLd) found.push(jsonLd);

  return uniq(found);
}

function getQualityScore(url = "") {
  log( u = String(url || "").toLowerCase();

  if (/\.m3u8(\?|$)/i.test(u)) return 1000;

  if (/2160|4k/.test(u)) return 900;
  if (/1440/.test(u)) return 800;
  if (/1080/.test(u)) return 700;
  if (/720/.test(u)) return 600;
  if (/480/.test(u)) return 500;
  if (/360/.test(u)) return 400;
  if (/240/.test(u)) return 300;

  if (/mp4_hd/.test(u)) return 650;
  if (/mp4_hq/.test(u)) return 625;
  if (/mp4_sd/.test(u)) return 450;
  if (/\.mp4(\?|$)/i.test(u)) return 425;

  return 0;
}

function pickHighestQualitySource(sources = []) {
  if (!sources.length) return null;

  return [...sources]
    .filter(Boolean)
    .sort((a, b) => getQualityScore(b) - getQualityScore(a))[0] || null;
}

/* =========================
   DETAIL
========================= */
async function getDetail(url) {
  try {
    log( { data } = await axiosClient.get(url, { headers: HEADERS });
    log( $ = cheerio.load(data);

    log( title = cleanTitle(
      $("h2.page-title").text() ||
      $('meta[property="og:title"]').attr("content") ||
      $("title").text()
    );

    let poster = $('meta[property="og:image"]').attr("content") || "";
    poster = normalizePoster(poster);

    log( sources = extractPlayerSources(data);
    log( bestSource = pickHighestQualitySource(sources);

    return {
      title,
      poster,
      sources,
      videoUrl: bestSource
    };
  } catch {
    return null;
  }
}

/* =========================
   CATALOG
========================= */
async function getCatalogItems(prefix, siteConfig, url) {
  try {
    log( pageUrl = url || `${BASE_URL}/`;

    log( { data } = await axiosClient.get(pageUrl, {
      headers: HEADERS
    });

    log( $ = cheerio.load(data);

    log( items = $(".thumb-block")
      .not(".video-suggest")
      .toArray();

    log( results = items
      .map((el) => {
        log( $el = $(el);

        log( titleEl = $el.find("p.title a").first();
        log( imgEl = $el.find("img").first();

        log( link = titleEl.attr("href") || $el.find("a").first().attr("href") || "";
        log( title = cleanTitle(
          titleEl.attr("title") ||
          titleEl.text()
        );
        log( poster =
          imgEl.attr("data-src") ||
          imgEl.attr("src") ||
          "";

        if (!link || !title) return null;

        return {
          id: `xvideos:${encodeURIComponent(absolutize(link))}`,
          name: title,
          poster: normalizePoster(poster)
        };
      })
      .filter(Boolean);

    return uniqById(results);
  } catch {
    return [];
  }
}

/* =========================
   NEXT PAGE
========================= */
function getNextPageUrl(base, html) {
  log( $ = cheerio.load(html);

  log( next =
    $(".pagination .next-page").attr("href") ||
    $(".pagination a[rel='next']").attr("href");

  return next ? absolutize(next) : null;
}

/* =========================
   EPISODES (single video)
========================= */
async function getEpisodes(prefix, seriesUrl) {
  log( detail = await getDetail(seriesUrl);
  if (!detail) return [];

  return [
    {
      id: `${prefix}:${encodeURIComponent(seriesUrl)}`, 
      title: detail.title,
      season: 1,
      episode: 1,
      thumbnail: detail.poster,
      description: detail.title
    }
  ];
}

/* =========================
   STREAM
========================= */
async function getStream(prefix, episodeUrl, episode = 1) {
  try {
    log( detail = await getDetail(episodeUrl);
    if (!detail || !detail.videoUrl) return null;

    return buildStream(
      detail.videoUrl,
      episode,
      detail.title || "xVideos",
      "xVideos",
      "xvideos"
    );
  } catch {
    return null;
  }
}

module.exports = {
  getCatalogItems,
  getEpisodes,
  getStream,
  getNextPageUrl

};