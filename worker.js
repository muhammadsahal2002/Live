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
        name: nameMatch ? nameMatch[1].trim() : 'Unknown',
        group: groupMatch ? groupMatch[1].trim() : 'Other'
      };
    } else if (t && !t.startsWith('#')) {
      current.url = t;
      if (current.name && current.url) channels.push({ ...current });
      current = {};
    }
  }
  return channels;
}

// 3. FETCH CHANNELS
async function getChannels() {
  const bustUrl = M3U_URL + '?t=' + Date.now();
  const res = await fetch(bustUrl, { cache: 'no-store' });
  if (!res.ok) throw new Error("Failed to fetch M3U: " + res.status);
  const text = await res.text();
  return { channels: parseM3U(text), rawLength: text.length };
}

// 4. BUILD MANIFEST
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
    version: "1.0.2",
    name: "My Custom M3U TV",
    description: "Live TV grouped by category",
    resources: ["catalog", "meta", "stream"],
    types: ["tv"],
    catalogs,
    idPrefixes: ["m3u:"]
  };
}

// 5. MAIN WORKER
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    let channels = [];
    let rawLength = 0;
    let fetchError = null;

    try {
      const result = await getChannels();
      channels = result.channels;
      rawLength = result.rawLength;
    } catch (e) {
      fetchError = e.message;
    }

    const groups = [...new Set(channels.map(c => c.group))].filter(g => g && g !== "Other");

    // --- DEBUG ENDPOINT ---
    if (path === "/debug") {
      return new Response(JSON.stringify({
        m3uUrl: M3U_URL,
        fetchError: fetchError,
        rawLength: rawLength,
        totalChannels: channels.length,
        groups: groups,
        firstChannel: channels[0] || null,
        sampleKids: channels.find(c => c.group === 'Kids') || null,
        sampleEntertainment: channels.find(c => c.group === 'Entertainment') || null
      }, null, 2), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // --- MANIFEST ---
    if (path === "/manifest.json") {
      return new Response(JSON.stringify(buildManifest(groups)), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // --- META ---
    if (path.startsWith("/meta/tv/")) {
      const id = decodeURIComponent(path.split("/meta/tv/")[1].split("/")[0]);
      const idx = parseInt(id.replace("m3u:", ""), 10);
      const ch = channels[idx];
      if (!ch) return new Response(JSON.stringify({ meta: {} }), {
        headers: { "Content-Type": "application/json" }
      });
      return new Response(JSON.stringify({
        meta: {
          id, type: "tv", name: ch.name,
          poster: ch.logo, posterShape: "square",
          background: ch.logo,
          description: `Live channel: ${ch.name} (${ch.group})`
        }
      }), { headers: { "Content-Type": "application/json" } });
    }

    // --- CATALOG ---
    if (path.startsWith("/catalog/tv/")) {
      const catId = decodeURIComponent(path.split("/catalog/tv/")[1].split("/")[0]);
      let filtered = channels;

      if (catId !== "m3u_all") {
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
        type: "tv", name: ch.name, poster: ch.logo, posterShape: "square"
      }));

      return new Response(JSON.stringify({ metas }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // --- STREAM ---
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