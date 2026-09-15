// 1. CONFIGURATION
const M3U_URL = "https://raw.githubusercontent.com/muhammadsahal2002/adfree/refs/heads/master/playlist.m3u"; 

// 2. DEFINE YOUR CATEGORIES (Keywords to look for in channel names)
const CATEGORIES = [
  { id: "m3u_all", name: "All Channels", keywords: [] },
  { id: "m3u_news", name: "Bangla News", keywords: ["news", "somoy", "jamuna", "ekattor", "independent", "btv"] },
  { id: "m3u_sports", name: "Sports", keywords: ["sports", "star sports", "ten", "unite8"] },
  { id: "m3u_movies", name: "Movies", keywords: ["movie", "cinema", "hbo", "star movies", "zee cinema", "sony pix"] }
];

// 3. STREMIO MANIFEST
const manifest = {
  id: "org.mym3u.addon",
  version: "1.0.0",
  name: "My Custom M3U TV",
  description: "Live TV from my GitHub M3U playlist",
  resources: ["catalog", "stream"],
  types: ["tv"],
  catalogs: CATEGORIES.map(cat => ({
    type: "tv",
    id: cat.id,
    name: cat.name,
    extra: [{ name: "search", isRequired: false }]
  })),
  idPrefixes: ["m3u:"]
};

// 4. HELPER TO PARSE M3U TEXT
function parseM3U(content) {
  const lines = content.split('\n');
  const channels = [];
  let current = {};
  
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('#EXTINF')) {
      const logoMatch = t.match(/tvg-logo="([^"]*)"/);
      const nameMatch = t.match(/,(.*)$/);
      current = {
        logo: logoMatch ? logoMatch[1] : '',
        name: nameMatch ? nameMatch[1].trim() : 'Unknown'
      };
    } else if (t && !t.startsWith('#')) {
      current.url = t;
      if (current.name && current.url) channels.push({ ...current });
      current = {};
    }
  }
  return channels;
}

// 5. MAIN WORKER LOGIC
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Serve the Manifest
    if (path === "/manifest.json") {
      return new Response(JSON.stringify(manifest), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // Fetch and Parse the M3U file
    let channels = [];
    try {
      const res = await fetch(M3U_URL);
      if (!res.ok) throw new Error("Failed to fetch M3U");
      channels = parseM3U(await res.text());
    } catch (e) {
      return new Response("Error loading playlist", { status: 500 });
    }

    // Handle Catalog Requests (Categories)
    if (path.startsWith("/catalog/tv/")) {
      const catId = path.split("/catalog/tv/")[1].split("/")[0];
      const category = CATEGORIES.find(c => c.id === catId);

      let filtered = channels;
      if (category && category.keywords.length > 0) {
        filtered = channels.filter(ch => 
          category.keywords.some(k => ch.name.toLowerCase().includes(k))
        );
      }

      // Handle Search inside a category
      const search = url.searchParams.get("search");
      if (search) {
        const q = search.toLowerCase();
        filtered = filtered.filter(ch => ch.name.toLowerCase().includes(q));
      }

      const metas = filtered.map(ch => ({
        id: `m3u:${channels.indexOf(ch)}`, // Keep original index for stream handler
        type: "tv",
        name: ch.name,
        poster: ch.logo,
        posterShape: "square"
      }));

      return new Response(JSON.stringify({ metas }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // Handle Stream Requests
    if (path.startsWith("/stream/tv/")) {
      const id = decodeURIComponent(path.split("/stream/tv/")[1].split("/")[0]);
      const idx = parseInt(id.replace("m3u:", ""), 10);
      const ch = channels[idx];

      if (!ch) return new Response(JSON.stringify({ streams: [] }), { status: 200 });

      return new Response(JSON.stringify({
        streams: [{ title: ch.name, url: ch.url }]
      }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response("Not found", { status: 404 });
  }
};