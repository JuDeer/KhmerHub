const cheerio = require("cheerio");
const axiosClient = require("../../utils/fetch");
const { POST_INFO } = require("../../utils/cache");
const { normalizePoster } = require("../../utils/helpers");
const { getPostId } = require("./postId");
const { getStreamDetail, FILE_REGEX } = require("./stream");

/* =========================
   EPISODES
========================= */
async function getEpisodes(prefix, seriesUrl) {
  let postId = null;

  if (prefix === "sunday") {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        postId = await getPostId(seriesUrl);
        break;
      } catch (err) {
        console.log(
          `[sunday] getPostId attempt ${attempt} failed:`,
          err?.response?.status || err?.message
        );

        if (attempt < 3) {
          await new Promise(resolve =>
            setTimeout(resolve, attempt * 1000)
          );
        }
      }
    }
  } else {
    postId = await getPostId(seriesUrl);
  }

  // Sunday playlist fallback
  if (!postId && prefix === "sunday") {
    let data = "";

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await axiosClient.get(seriesUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
              "AppleWebKit/537.36 Chrome/120 Safari/537.36",
            Referer: seriesUrl
          }
        });

        data = response.data || "";

        if (data) break;
      } catch (err) {
        console.log(
          `[sunday] episode page attempt ${attempt} failed:`,
          err?.response?.status || err?.message
        );

        if (attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, attempt * 700));
        }
      }
    }

    if (!data) return [];

    FILE_REGEX.lastIndex = 0;

    const urls = [];
    let match;

    while ((match = FILE_REGEX.exec(data)) !== null) {
      urls.push(match[1]);
    }

    const $ = cheerio.load(data);
    const pagePoster =
      $("meta[property='og:image']").attr("content") ||
      $("link[rel='image_src']").attr("href") ||
      "";

    const normalizedPoster = normalizePoster(pagePoster);

    const pageTitle =
      $("h1").first().text().trim() ||
      $("meta[property='og:title']").attr("content") ||
      $("title").text().trim() ||
      seriesUrl;
     
    return urls.map((url, index) => ({
      id: `${prefix}:${encodeURIComponent(seriesUrl)}:1:${index + 1}`,
      title: `Episode ${String(index + 1).padStart(2, "0")}`,
      seriesTitle: pageTitle,
      season: 1,
      episode: index + 1,
      thumbnail: normalizedPoster,
      released: new Date().toISOString(),
    }));
  }

  if (!postId) {
    return [];
  }

  let detail = null;

  if (prefix === "sunday") {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        detail = await getStreamDetail(postId, seriesUrl);

        if (detail?.urls?.length) break;
      } catch (err) {
        console.log(
          `[sunday] getStreamDetail attempt ${attempt} failed:`,
          err?.response?.status || err?.message
        );
      }

      if (attempt < 3) {
        await new Promise(resolve =>
          setTimeout(resolve, attempt * 1000)
        );
      }
    }
  } else {
    detail = await getStreamDetail(postId, seriesUrl);
  }

  if (!detail) {
    return [];
  }

  const maxEp = POST_INFO.get(postId)?.maxEp || null;

  let urls = Array.isArray(detail.urls)
    ? detail.urls.filter(Boolean)
    : [];

  if (maxEp && urls.length > maxEp) {
    urls = urls.slice(0, maxEp);
  }

  return urls.map((url, index) => ({
    id: `${prefix}:${encodeURIComponent(seriesUrl)}:1:${index + 1}`,
    title: `Episode ${String(index + 1).padStart(2, "0")}`,
    seriesTitle: detail.title,
    season: 1,
    episode: index + 1,
    thumbnail: detail.thumbnail,
    released: new Date().toISOString(),
  }));
}

module.exports = {
  getEpisodes,
};
