module.exports = (builder, deps) => {
  const { getSiteEngine, SITE_TYPES } = deps;

  builder.defineStreamHandler(async ({ id }) => {
    try {
      console.log("[STREAM] handler called", { id });

      const parts = id.split(":");
      console.log("[STREAM] parts", parts);

      const prefix = parts[0];
      const encodedUrl = parts[1];

      console.log("[STREAM] parsed", {
        prefix,
        encodedUrl
      });

      if (!prefix || !encodedUrl) {
        console.log("[STREAM] missing prefix or encodedUrl");
        return { streams: [] };
      }

      const siteType = SITE_TYPES[prefix] || SITE_TYPES.default;
      const isSingleItem = siteType === "movie" || siteType === "channel";
      const epNum = isSingleItem ? 1 : Number(parts[parts.length - 1]);

      console.log("[STREAM] type info", {
        siteType,
        isSingleItem,
        epNum
      });

      if (!isSingleItem && (!Number.isInteger(epNum) || epNum <= 0)) {
        console.log("[STREAM] invalid episode number");
        return { streams: [] };
      }

      const ctx = getSiteEngine(prefix);
      console.log("[STREAM] ctx", { hasCtx: !!ctx });

      if (!ctx) {
        console.log("[STREAM] no site engine for prefix", prefix);
        return { streams: [] };
      }

      const { engine: siteEngine } = ctx;
      const seriesUrl = decodeURIComponent(encodedUrl);

      console.log("[STREAM] decoded url", { seriesUrl });
      console.log("[STREAM] calling siteEngine.getStream");

      const stream = await siteEngine.getStream(prefix, seriesUrl, epNum);

      console.log("[STREAM] getStream result", {
        hasStream: !!stream,
        isArray: Array.isArray(stream),
        count: Array.isArray(stream) ? stream.length : stream ? 1 : 0
      });

      if (!stream) return { streams: [] };

      return {
        streams: Array.isArray(stream) ? stream : [stream]
      };
    } catch (err) {
      console.error("[defineStreamHandler]", err);
      return { streams: [] };
    }
  });
};