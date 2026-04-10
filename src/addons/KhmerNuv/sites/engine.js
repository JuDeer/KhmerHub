const { getCatalogItems } = require("./core/catalog");
const { getEpisodes } = require("./core/episodes");
const { getStream } = require("./core/stream");
const { getXvideosBestCurrentUrl } = require("./xvideos");

module.exports = {
  getCatalogItems,
  getEpisodes,
  getStream,
  getXvideosBestCurrentUrl,
};