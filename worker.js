// ============================================================
// CONFIGURATION
// ============================================================

const M3U_URL =
  "https://raw.githubusercontent.com/muhammadsahal2002/adfree/refs/heads/master/playlist.m3u";

const MEMORY_TTL = 60 * 1000; // 1 minute in-memory cache

let memoryCache = null;
let memoryCacheTime = 0;


// ============================================================
// PARSE M3U
// ============================================================

function parseM3U(content) {
  const lines = content.split(/\r?\n/);
  const channels = [];
  let current = { logo: "", name: "", group: "", url: "" };

  for (const line of lines) {
    const t = line.trim();

    if (t.startsWith("#EXTINF")) {
      const logoMatch = t.match(/tvg-logo="([^"]*)"/);
      const groupMatch = t.match(/group-title="([^"]*)"/);
      const nameMatch = t.match(/,(.*)$/);

      current = {
        logo: logoMatch ? logoMatch[1] : "",
        name: nameMatch ? nameMatch[1].trim() : "Unknown",
        group: groupMatch ? groupMatch[1].trim() : "Other",
        url: ""
      };
    } else if (t && !t.startsWith("#")) {
      current.url = t;
      if (current.name && current.url) channels.push({ ...current });
      current = { logo: "", name: "", group: "", url: "" };
    }
  }

  return channels;
}


// ============================================================
// LOAD M3U (no Cloudflare Cache API)
// ============================================================

async function getChannels() {
  const now = Date.now();
  if (memoryCache && now - memoryCacheTime < MEMORY_TTL) return memoryCache;

  const response = await fetch(M3U_URL, {
    headers: {
      "User-Agent": "Cloudflare-Worker-M3U",
      "Cache-Control": "no-cache"
    }
  });

  if (!response.ok) throw new Error("GitHub returned HTTP " + response.status);

  const text = await response.text();
  if (!text || text.length < 10) throw new Error("Empty playlist");

  const channels = parseM3U(text);
  if (!channels.length) throw new Error("No channels parsed");

  const result = { channels, rawLength: text.length };
  memoryCache = result;
  memoryCacheTime = now;
  return result;
}


// ============================================================
// STRIP .json
// ============================================================

function cleanId(raw) {
  return decodeURIComponent(raw).replace(/\.json$/i, "");
}


// ============================================================
// BUILD MANIFEST
// ============================================================

function buildManifest(groups) {
  const catalogs = [
    {
      type: "tv",
      id: "m3u_all",
      name: "All Channels",
      extra: [{ name: "search", isRequired: false }]
    }
  ];

  for (const group of groups) {
    catalogs.push({
      type: "tv",
      id: "m3u_group_" + encodeURIComponent(group),
      name: group,
      extra: [{ name: "search", isRequired: false }]
    });
  }

  return {
    id: "org.mym3u.addon",
    version: "1.0.7",
    name: "My Custom M3U TV",
    description: "Live TV grouped by category",
    resources: ["catalog", "meta", "stream"],
    types: ["tv"],
    catalogs,
    idPrefixes: ["m3u:"]
  };
}


// ============================================================
// HANDLE REQUEST
// ============================================================

async function handleRequest(request) {
  try {
    const url = new URL(request.url);
    const path = url.pathname;

    // ROOT
    if (path === "/") {
      return new Response(
        "My Custom M3U TV addon is running.\n\nManifest: /manifest.json\nDebug: /debug",
        { headers: { "Content-Type": "text/plain; charset=utf-8" } }
      );
    }

    // LOAD CHANNELS
    let result;
    try {
      result = await getChannels();
    } catch (error) {
      if (path === "/debug") {
        return new Response(
          JSON.stringify({ ok: false, error: error.message, m3uUrl: M3U_URL }, null, 2),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("M3U loading error: " + error.message, {
        status: 502,
        headers: { "Content-Type": "text/plain" }
      });
    }

    const channels = result.channels;

    // GROUPS
    const preferredOrder = [
      "Kids", "Entertainment", "Movies", "Sports",
      "Music", "Documentary", "News", "Religious", "Other"
    ];

    const availableGroups = [...new Set(channels.map((c) => c.group).filter(Boolean))];
    const groups = preferredOrder.filter((g) => availableGroups.includes(g));
    for (const g of availableGroups) {
      if (!groups.includes(g)) groups.push(g);
    }

    // DEBUG
    if (path === "/debug") {
      return new Response(
        JSON.stringify({
          ok: true,
          m3uUrl: M3U_URL,
          rawLength: result.rawLength,
          totalChannels: channels.length,
          groups,
          firstChannel: channels[0] || null,
          firstKidsChannel: channels.find((c) => c.group === "Kids") || null
        }, null, 2),
        {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
          }
        }
      );
    }

    // MANIFEST
    if (path === "/manifest.json") {
      return new Response(JSON.stringify(buildManifest(groups)), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store"
        }
      });
    }

    // META
    if (path.startsWith("/meta/tv/")) {
      const id = cleanId(path.split("/meta/tv/")[1].split("/")[0]);
      const idx = parseInt(id.replace("m3u:", ""), 10);
      const ch = channels[idx];

      if (!ch) {
        return new Response(JSON.stringify({ meta: {} }), {
          headers: { "Content-Type": "application/json" }
        });
      }

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

    // CATALOG
    if (path.startsWith("/catalog/tv/")) {
      const catId = cleanId(path.split("/catalog/tv/")[1].split("/")[0]);
      let filtered = channels;

      if (catId !== "m3u_all") {
        const groupName = decodeURIComponent(catId.replace("m3u_group_", ""));
        filtered = channels.filter((ch) => ch.group === groupName);
      }

      const search = url.searchParams.get("search");
      if (search) {
        const q = search.toLowerCase().trim();
        filtered = filtered.filter((ch) => ch.name.toLowerCase().includes(q));
      }

      const metas = filtered.map((ch) => ({
        id: `m3u:${channels.indexOf(ch)}`,
        type: "tv",
        name: ch.name,
        poster: ch.logo,
        posterShape: "square"
      }));

      return new Response(JSON.stringify({ metas }), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=60"
        }
      });
    }

    // STREAM
    if (path.startsWith("/stream/tv/")) {
      const id = cleanId(path.split("/stream/tv/")[1].split("/")[0]);
      const idx = parseInt(id.replace("m3u:", ""), 10);
      const ch = channels[idx];

      if (!ch) {
        return new Response(JSON.stringify({ streams: [] }), {
          headers: { "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({
        streams: [{
          title: `${ch.name} (${ch.group})`,
          url: ch.url,
          behaviorHints: { notWebReady: true }
        }]
      }), { headers: { "Content-Type": "application/json" } });
    }

    // 404
    return new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "text/plain" }
    });

  } catch (error) {
    return new Response(
      "Worker error: " + (error?.stack || error?.message || String(error)),
      {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      }
    );
  }
}


// ============================================================
// EVENT LISTENER (Service Worker syntax)
// ============================================================

addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});