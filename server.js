const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";
const dataDir = path.join(root, "data");
const dbPath = path.join(dataDir, "db.json");

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

const nyMarineRules = {
  "striped bass": {
    displayName: "Striped bass",
    aliases: ["striper", "striped bass", "bass"],
    minimum: "Marine waters slot size 28-31 in",
    possession: "1 fish",
    season: "Apr 15-Dec 15",
    note: "Bait fishing for striped bass requires non-offset inline circle hooks in NY.",
  },
  fluke: {
    displayName: "Summer flounder / fluke",
    aliases: ["fluke", "summer flounder", "flounder"],
    minimum: "19 in May 4-Aug 1; 19.5 in Aug 2-Oct 15",
    possession: "3 fish",
    season: "May 4-Oct 15",
    note: "Do not remove head/tail before landing except NY DEC bait-fillet exception.",
  },
  porgy: {
    displayName: "Scup / porgy",
    aliases: ["porgy", "scup"],
    minimum: "Shore 9.5 in; vessel 11 in",
    possession: "30 fish",
    season: "May 1-Dec 31",
    note: "Party/charter rules can differ by date.",
  },
  bluefish: {
    displayName: "Bluefish",
    aliases: ["bluefish", "blue", "snapper"],
    minimum: "No size limit",
    possession: "5 fish for individuals; 7 aboard licensed party/charter boats",
    season: "All year",
    note: "Includes snappers.",
  },
  "black sea bass": {
    displayName: "Black sea bass",
    aliases: ["black sea bass", "sea bass"],
    minimum: "16 in",
    possession: "3 fish May 16-Aug 31; 6 fish Sept 1-Dec 31",
    season: "May 16-Dec 31",
    note: "Measured to farthest extremity of tail, excluding tail filament.",
  },
  tautog: {
    displayName: "Tautog / blackfish",
    aliases: ["tautog", "blackfish"],
    minimum: "16 in",
    possession: "Long Island Sound 2/3 by season; NY Bight 2/4 by season",
    season: "Spring and fall seasons vary by region",
    note: "Long Island Sound and NY Bight have different possession limits and seasons.",
  },
};

const officialRuleUrl = "https://dec.ny.gov/things-to-do/saltwater-fishing/recreational-fishing-regulations";

function initialDb() {
  return {
    users: [{ id: "demo-user", nickname: "我", createdAt: new Date().toISOString() }],
    spots: [],
    feed: [
      {
        id: crypto.randomUUID(),
        type: "system",
        userId: "demo-user",
        title: "鱼情动态已启用",
        text: "正在作钓、刚中鱼、心得更新和照片识别都会进入这里。",
        createdAt: new Date().toISOString(),
      },
    ],
    photoAnalyses: [],
  };
}

function ensureDb() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify(initialDb(), null, 2));
}

function readDb() {
  ensureDb();
  try {
    return JSON.parse(fs.readFileSync(dbPath, "utf8"));
  } catch {
    const db = initialDb();
    writeDb(db);
    return db;
  }
}

function writeDb(db) {
  ensureDb();
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

function sendJson(res, status, data) {
  send(res, status, JSON.stringify(data), { "Content-Type": "application/json; charset=utf-8" });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_500_000) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function filePathForUrl(url) {
  const parsed = new URL(url, "http://localhost");
  const pathname = decodeURIComponent(parsed.pathname);
  const requested = pathname === "/" ? "/index.html" : pathname;
  const resolved = path.normalize(path.join(root, requested));
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

function speciesFromText(value = "") {
  const normalized = value.toLowerCase();
  for (const rule of Object.values(nyMarineRules)) {
    if (rule.aliases.some((alias) => normalized.includes(alias))) return rule;
  }
  if (normalized.includes("bass")) return nyMarineRules["striped bass"];
  if (normalized.includes("flounder")) return nyMarineRules.fluke;
  return nyMarineRules["striped bass"];
}

function confidenceFromInput(input) {
  const text = `${input.fileName || ""} ${input.speciesHint || ""}`.toLowerCase();
  if (!text.trim()) return 0.42;
  const matched = Object.values(nyMarineRules).some((rule) => rule.aliases.some((alias) => text.includes(alias)));
  return matched ? 0.78 : 0.48;
}

async function handleApi(req, res) {
  const parsed = new URL(req.url, "http://localhost");
  const db = readDb();

  if (req.method === "GET" && parsed.pathname === "/api/session") {
    sendJson(res, 200, { user: db.users[0] || initialDb().users[0] });
    return;
  }

  if (req.method === "POST" && parsed.pathname === "/api/session") {
    const input = await readJson(req);
    const nickname = String(input.nickname || "我").trim().slice(0, 40) || "我";
    db.users[0] = { ...(db.users[0] || {}), id: "demo-user", nickname, updatedAt: new Date().toISOString() };
    writeDb(db);
    sendJson(res, 200, { user: db.users[0] });
    return;
  }

  if (req.method === "GET" && parsed.pathname === "/api/spots") {
    sendJson(res, 200, { spots: db.spots.slice(-200).reverse() });
    return;
  }

  if (req.method === "POST" && parsed.pathname === "/api/spots") {
    const input = await readJson(req);
    const spot = {
      id: input.id || crypto.randomUUID(),
      userId: "demo-user",
      name: String(input.name || "未命名钓点").slice(0, 120),
      lat: Number(input.lat),
      lon: Number(input.lon),
      visibility: input.visibility || "private",
      targetFish: String(input.targetFish || "").slice(0, 160),
      bestWindow: String(input.bestWindow || "").slice(0, 180),
      notes: String(input.notes || "").slice(0, 1200),
      createdAt: input.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.spots = db.spots.filter((item) => item.id !== spot.id).concat(spot);
    db.feed.push({
      id: crypto.randomUUID(),
      type: "spot",
      userId: "demo-user",
      spotId: spot.id,
      title: "更新了钓点",
      text: `${spot.name} · ${spot.targetFish || "目标鱼待补充"}`,
      createdAt: new Date().toISOString(),
    });
    writeDb(db);
    sendJson(res, 201, { spot });
    return;
  }

  if (req.method === "GET" && parsed.pathname === "/api/feed") {
    sendJson(res, 200, { feed: db.feed.slice(-100).reverse() });
    return;
  }

  if (req.method === "POST" && parsed.pathname === "/api/feed") {
    const input = await readJson(req);
    const item = {
      id: crypto.randomUUID(),
      type: input.type || "status",
      userId: "demo-user",
      spotId: input.spotId || "",
      title: String(input.title || "鱼情动态").slice(0, 120),
      text: String(input.text || "").slice(0, 1000),
      lat: Number(input.lat),
      lon: Number(input.lon),
      createdAt: new Date().toISOString(),
    };
    db.feed.push(item);
    writeDb(db);
    sendJson(res, 201, { item });
    return;
  }

  if (req.method === "POST" && parsed.pathname === "/api/photo-analysis") {
    const input = await readJson(req);
    const rule = speciesFromText(`${input.fileName || ""} ${input.speciesHint || ""}`);
    const analysis = {
      id: crypto.randomUUID(),
      userId: "demo-user",
      species: rule.displayName,
      confidence: confidenceFromInput(input),
      location: {
        lat: Number(input.lat),
        lon: Number(input.lon),
        source: input.locationSource || "current-point",
      },
      regulation: {
        source: "NYS DEC Recreational Saltwater Fishing Regulations",
        sourceUrl: officialRuleUrl,
        lastObserved: "2026-06-28",
        minimum: rule.minimum,
        possession: rule.possession,
        season: rule.season,
        note: rule.note,
        warning: "法规可能随时变化；保留/带走鱼之前必须核对官方页面和当地执法要求。",
      },
      createdAt: new Date().toISOString(),
    };
    db.photoAnalyses.push(analysis);
    const feedItem = {
      id: crypto.randomUUID(),
      type: "photo",
      userId: "demo-user",
      title: "上传了鱼照识别",
      text: `${analysis.species} · ${analysis.regulation.minimum} · ${analysis.regulation.possession}`,
      lat: analysis.location.lat,
      lon: analysis.location.lon,
      createdAt: new Date().toISOString(),
    };
    db.feed.push(feedItem);
    writeDb(db);
    sendJson(res, 201, { analysis, feedItem });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    send(res, 200, "ok\n", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }

  if ((req.url || "").startsWith("/api/")) {
    handleApi(req, res).catch((error) => {
      sendJson(res, error.message === "Payload too large" ? 413 : 400, { error: error.message });
    });
    return;
  }

  const filePath = filePathForUrl(req.url || "/");
  if (!filePath) {
    send(res, 403, "Forbidden\n", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      const fallback = path.join(root, "index.html");
      fs.readFile(fallback, (fallbackError, fallbackData) => {
        if (fallbackError) {
          send(res, 404, "Not found\n", { "Content-Type": "text/plain; charset=utf-8" });
          return;
        }
        send(res, 200, fallbackData, { "Content-Type": mimeTypes[".html"] });
      });
      return;
    }

    const contentType = mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    send(res, 200, data, { "Content-Type": contentType });
  });
});

server.listen(port, host, () => {
  console.log(`1490 fishing weather server listening on ${host}:${port}`);
});
