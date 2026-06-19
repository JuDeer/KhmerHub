const axiosClient = require("../utils/fetch");
const { buildStream } = require("../utils/streamResolvers");

let CHANNELS = null;

function parseLogo(line) {
  const match = line.match(/tvg-logo="([^"]+)"/i);
  return match ? match[1] : "";
}

function parseTitle(line) {
  return line.split(",").pop()?.trim() || "English Channel";
}

function parseM3U(data, limit = 300) {
  const lines = data.split(/\r?\n/);
  const channels = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();

    if (!line || !line.startsWith("#EXTINF")) continue;

    const streamUrl = lines[i + 1]?.trim();
    if (!streamUrl || !streamUrl.startsWith("http")) continue;

    channels.push({
      title: parseTitle(line),
      link: streamUrl,
      thumbnail: parseLogo(line),
      resolve: true
    });

    if (channels.length >= limit) break;
  }

  return channels;
}

async function loadChannels(site) {
  if (CHANNELS) return CHANNELS;

  const playlistUrl = site.baseUrl;
  const limit = site.pageSize || 300;

  const { data } = await axiosClient.get(playlistUrl);
  CHANNELS = parseM3U(data, limit);

  return CHANNELS;
}

function findChannelByUrl(channels, url) {
  return channels.find((item) => item.link === url) || null;
}

/* =========================
   CATALOG
========================= */
async function getCatalogItems(prefix, site) {
  const channels = await loadChannels(site);

  return channels.map((item) => ({
    id: `${prefix}:${encodeURIComponent(item.link)}`,
    name: item.title,
    poster: item.thumbnail
  }));
}

/* =========================
   EPISODES
========================= */
async function getEpisodes(prefix, seriesUrl, site) {
  const channels = await loadChannels(site);
  const channel = findChannelByUrl(channels, seriesUrl);

  if (!channel) return [];

  return [
    {
      id: `${prefix}:${encodeURIComponent(seriesUrl)}:1:1`,
      title: channel.title,
      season: 1,
      episode: 1,
      thumbnail: channel.thumbnail,
      released: new Date().toISOString()
    }
  ];
}

/* =========================
   STREAM
========================= */
async function getStream(prefix, seriesUrl, epNum, site) {
  const channels = await loadChannels(site);
  const channel = findChannelByUrl(channels, seriesUrl);

  if (!channel) return null;

  return buildStream(
    channel.link,
    1,
    channel.title,
    "Khmer II",
    "english",
    null
  );
}

module.exports = {
  getCatalogItems,
  getEpisodes,
  getStream
};
