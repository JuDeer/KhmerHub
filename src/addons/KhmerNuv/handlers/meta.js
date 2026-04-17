module.exports = (builder, deps) => {
  const { getSiteEngine, SITE_TYPES } = deps;

  builder.defineMetaHandler(async ({ id }) => {
    try {
      console.log("[META] handler called", { id });

      const parts = id.split(":");
      const prefix = parts[0];
      const encodedUrl = parts.slice(1).join(":");

      if (!prefix || !encodedUrl) return { meta: null };

      const ctx = getSiteEngine(prefix);
      if (!ctx) return { meta: null };

      const { engine: siteEngine } = ctx;
      const siteType = SITE_TYPES[prefix] || SITE_TYPES.default;
      const seriesUrl = decodeURIComponent(encodedUrl);

      const episodes = await siteEngine.getEpisodes(prefix, seriesUrl);
      console.log("[META] episodes", {
        count: episodes?.length || 0,
        firstId: episodes?.[0]?.id
      });

      if (!episodes.length) return { meta: null };

      const first = episodes[0];

      if (siteType === "movie" || siteType === "channel") {
        return {
          meta: {
            id,
            type: siteType,
            name: first.title,
            poster: first.thumbnail,
            posterShape: "poster",
            background: first.thumbnail,
            description: first.description || first.title,
            genres: first.genres || [],
            available: true,
            videos: [
              {
                id,
                title: first.title,
                thumbnail: first.thumbnail
              }
            ]
          }
        };
      }

      return {
        meta: {
          id,
          type: siteType,
          name: first.title,
          poster: first.thumbnail,
          posterShape: "poster",
          background: first.thumbnail,
          videos: episodes,
        },
      };
    } catch (err) {
      console.log("[META] error", err?.message || String(err));
      return { meta: null };
    }
  });
};