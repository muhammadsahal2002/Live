// 1. CONFIGURATION
const M3U_URL = "https://raw.githubusercontent.com/muhammadsahal2002/adfree/refs/heads/master/playlist.m3u";

// 2. HELPER TO PARSE M3U
function parseM3U(content) {
  const lines = content.split('\n');
  const channels = [];
  let current = {};

  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('#EXTINF')) {
      const logoMatch = t.match(/tvg-logo="([^"]*)"/);
      const groupMatch = t.match(/group-title="([^"]*)"/);
      const nameMatch = t.match(/,(.*)$/);
      current = {
        logo: logoMatch ? logoMatch[1] : '',
        group: groupMatch ? groupMatch[1].trim() : 'Uncategorized',
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

// 3. STATIC MANIFEST (catalogs added dynamically later)
function buildManifest(groups) {
  const catalogs = [
    { type: "tv", id: "m3u_all", name: "All Channels", extra: [{ name: "search", isRequired: false }] }
  ];

  for (const g of groups) {
    catalogs.push({
      type: "tv",
      id: "m3u_group_" + encodeURIComponent(g),
      name: g,
      extra: [{ name: "search", isRequired: false }]
    });
  }

  return {
    id: "org.mym3u.addon",
    version: "1.0.0",
    name: "My Custom M3U TV",
    description: "Live TV grouped by category from GitHub M3U",
    resources: ["catalog", "meta", "stream"],
    types: ["tv"],
    catalogs,
    idPrefixes: ["m3u:"]
  };
}

// 4. MAIN WORKER
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Fetch M3U first (needed for both manifest and catalogs)
    let channels = [];
    try {
      const res = await fetch(M3U_URL);
      if (!res.ok) throw new Error("Failed to fetch M3U");
      channels = parseM3U(await res.text());
    } catch (e) {
      return new Response("Error loading playlist: " + e.message, { status: 500 });
    }

    // Get unique groups in the order they appear
    const groups = [...new Set(channels.map(c => c.group))];

    // Serve Manifest
    if (path === "/manifest.json") {
      const manifest = buildManifest(groups);
      return new Response(JSON.stringify(manifest), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // META HANDLER
    if (path.startsWith("/meta/tv/")) {
      const id = decodeURIComponent(path.split("/meta/tv/")[1].split("/")[0]);
      const idx = parseInt(id.replace("m3u:", ""), 10);
      const ch = channels[idx];
      if (!ch) return new Response(JSON.stringify({ meta: {} }), {
        headers: { "Content-Type": "application/json" }
      });

      return new Response(JSON.stringify({
        meta: {
          id,
          type: "tv",
          name: ch.name,
          poster: ch.logo,
          posterShape: "square",
          background: ch.logo,
          description: `Live channel: ${ch.name} (${ch.group})`
        }
      }), { headers: { "Content-Type": "application/json" } });
    }

    // CATALOG HANDLER
    if (path.startsWith("/catalog/tv/")) {
      const catId = decodeURIComponent(path.split("/catalog/tv/")[1].split("/")[0]);

      let filtered = channels;
      if (catId !== "m3u_all") {
        // extract group from id "m3u_group_<name>"
        const groupName = catId.replace("m3u_group_", "");
        filtered = channels.filter(ch => ch.group === groupName);
      }

      const search = url.searchParams.get("search");
      if (search) {
        const q = search.toLowerCase();
        filtered = filtered.filter(ch => ch.name.toLowerCase().includes(q));
      }

      const metas = filtered.map(ch => ({
        id: `m3u:${channels.indexOf(ch)}`,
        type: "tv",
        name: ch.name,
        poster: ch.logo,
        posterShape: "square"
      }));

      return new Response(JSON.stringify({ metas }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // STREAM HANDLER
    if (path.startsWith("/stream/tv/")) {
      const id = decodeURIComponent(path.split("/stream/tv/")[1].split("/")[0]);
      const idx = parseInt(id.replace("m3u:", ""), 10);
      const ch = channels[idx];
      if (!ch) return new Response(JSON.stringify({ streams: [] }), {
        headers: { "Content-Type": "application/json" }
      });

      return new Response(JSON.stringify({
        streams: [{
          title: `${ch.name} (${ch.group})`,
          url: ch.url,
          behaviorHints: { notWebReady: true }
        }]
      }), { headers: { "Content-Type": "application/json" } });
    }

    return new Response("Not found", { status: 404 });
  }
};