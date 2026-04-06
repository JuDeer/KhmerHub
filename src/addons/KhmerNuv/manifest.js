const EXTRA = ["search", "skip"];

const sites = [
  { id: "khmertv", name: "KhmerTV", type: "movie" },
  { id: "vip", name: "PhumiVip", type: "series" },
  { id: "sunday", name: "SundayDrama", type: "series" },
  { id: "phumi2", name: "PhumiClub", type: "series" },
  { id: "khmerave", name: "KhmerAve", type: "series" },
  { id: "merlkon", name: "Merlkon", type: "series" },
  { id: "idrama", name: "iDramaHD", type: "series" },
  { id: "cat3movie", name: "Cat3Movie", type: "movie" },
  { id: "xvideos", name: "xVideos", type: "movie" }  
];

module.exports = {
  id: "community.khmer.nuvio",
  version: "3.5.0",
  name: "KhmerDub",
  description: "Stream contents | Dev: TheDevilz.",
  logo: "https://raw.githubusercontent.com/konrepo/KhmerKodi/refs/heads/main/logo/person.png",

  resources: ["catalog", "meta", "stream"],
  types: ["series", "movie"],
  idPrefixes: sites.map((s) => s.id),

  catalogs: sites.map((site) => ({
    type: site.type,
    id: site.id,
    name: site.name,
    extraSupported: EXTRA
  })),

  behaviorHints: {
    configurable: false
  }

};