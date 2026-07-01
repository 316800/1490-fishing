const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";
const dataDir = path.join(root, "data");
const dbPath = path.join(dataDir, "db.json");
const sessionCookieName = "fishing_session";
const passwordIterations = 120_000;
const defaultAdminEmails = ["61654733@qq.com"];

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
    users: [
      {
        id: "demo-user",
        email: "demo@1490fishing.local",
        nickname: "我",
        role: "member",
        membership: "free",
        createdAt: new Date().toISOString(),
      },
    ],
    sessions: [],
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
    groups: [
      {
        id: "group-long-island-north",
        name: "长岛北岸鱼情群",
        description: "北岸潮汐、风向、夜钓安全和即时鱼情。",
        owner: "1490系统",
        members: ["我", "长岛阿明", "老王"],
        messages: [
          {
            id: crypto.randomUUID(),
            author: "1490系统",
            text: "欢迎进群。这里可以像微信群一样发鱼情、问潮水、约钓和分享钓点。",
            createdAt: new Date().toISOString(),
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  };
}

function normalizeDb(db) {
  db.users = Array.isArray(db.users) ? db.users : initialDb().users;
  db.sessions = Array.isArray(db.sessions) ? db.sessions : [];
  db.spots = Array.isArray(db.spots) ? db.spots : [];
  db.feed = Array.isArray(db.feed) ? db.feed : [];
  db.photoAnalyses = Array.isArray(db.photoAnalyses) ? db.photoAnalyses : [];
  db.groups = Array.isArray(db.groups) ? db.groups : [];
  if (!db.groups.length) db.groups = initialDb().groups;
  db.users = db.users.map((user) => ({
    role: "member",
    membership: "free",
    createdAt: new Date().toISOString(),
    ...user,
  }));
  db.groups = db.groups
    .filter((group) => group && group.id && group.name)
    .map((group) => ({
      id: String(group.id),
      name: String(group.name || "未命名交流群").slice(0, 60),
      description: String(group.description || "").slice(0, 160),
      owner: String(group.owner || "钓友").slice(0, 60),
      members: Array.isArray(group.members) ? group.members.slice(0, 80).map((member) => String(member).slice(0, 60)) : [],
      messages: Array.isArray(group.messages)
        ? group.messages
            .filter((message) => message && (message.text || message.audioUrl))
            .slice(-100)
            .map((message) => ({
              id: String(message.id || crypto.randomUUID()),
              author: String(message.author || "钓友").slice(0, 60),
              kind: message.kind === "voice" || message.audioUrl ? "voice" : "text",
              text: String(message.text || "").slice(0, 1000),
              audioUrl: String(message.audioUrl || "").slice(0, 700000),
              duration: Math.max(0, Number(message.duration) || 0),
              createdAt: message.createdAt || new Date().toISOString(),
            }))
        : [],
      createdAt: group.createdAt || new Date().toISOString(),
      updatedAt: group.updatedAt || group.createdAt || new Date().toISOString(),
    }));
  return db;
}

function ensureDb() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify(initialDb(), null, 2));
}

function readDb() {
  ensureDb();
  try {
    return normalizeDb(JSON.parse(fs.readFileSync(dbPath, "utf8")));
  } catch {
    const db = initialDb();
    writeDb(db);
    return db;
  }
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email || "",
    nickname: user.nickname || "钓友",
    role: isAdminUser(user) ? "admin" : user.role || "member",
    membership: user.membership || "free",
    createdAt: user.createdAt,
  };
}

function normalizeEmail(value = "") {
  return String(value).trim().toLowerCase();
}

function configuredAdminEmails() {
  return new Set(
    [defaultAdminEmails.join(","), process.env.ADMIN_EMAILS || ""]
      .filter(Boolean)
      .join(",")
      .split(",")
      .map(normalizeEmail)
      .filter(Boolean),
  );
}

function isAdminUser(user) {
  if (!user) return false;
  return user.role === "admin" || configuredAdminEmails().has(normalizeEmail(user.email));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(String(password), salt, passwordIterations, 32, "sha256").toString("hex");
  return { salt, hash };
}

function verifyPassword(password, user) {
  if (!user?.passwordHash || !user?.passwordSalt) return false;
  const { hash } = hashPassword(password, user.passwordSalt);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(user.passwordHash, "hex"));
}

function parseCookies(req) {
  const cookies = {};
  String(req.headers.cookie || "")
    .split(";")
    .forEach((pair) => {
      const index = pair.indexOf("=");
      if (index < 0) return;
      const key = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      cookies[key] = decodeURIComponent(value);
    });
  return cookies;
}

function cookieHeader(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

function requestUser(req, db) {
  const token = parseCookies(req)[sessionCookieName];
  if (!token) return null;
  const now = Date.now();
  const session = db.sessions.find((item) => item.token === token && new Date(item.expiresAt).getTime() > now);
  if (!session) return null;
  return db.users.find((user) => user.id === session.userId) || null;
}

function setSessionCookie(req, res, db, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.sessions = db.sessions
    .filter((session) => new Date(session.expiresAt).getTime() > Date.now())
    .concat({ token, userId, createdAt: new Date().toISOString(), expiresAt });
  res.setHeader("Set-Cookie", cookieHeader(sessionCookieName, token, {
    maxAge: 30 * 24 * 60 * 60,
    secure: req.headers["x-forwarded-proto"] === "https",
  }));
}

function requireUser(req, res, db) {
  const user = requestUser(req, db);
  if (!user) {
    sendJson(res, 401, { error: "请先登录。" });
    return null;
  }
  return user;
}

function requireAdmin(req, res, db) {
  const user = requireUser(req, res, db);
  if (!user) return null;
  if (!isAdminUser(user)) {
    sendJson(res, 403, { error: "需要管理员权限。" });
    return null;
  }
  return user;
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
    sendJson(res, 200, { user: publicUser(requestUser(req, db)) });
    return;
  }

  if (req.method === "GET" && parsed.pathname === "/api/admin/status") {
    const user = requireAdmin(req, res, db);
    if (!user) return;
    sendJson(res, 200, { ok: true, user: publicUser(user) });
    return;
  }

  if (req.method === "POST" && parsed.pathname === "/api/auth/register") {
    const input = await readJson(req);
    const email = normalizeEmail(input.email);
    const nickname = String(input.nickname || "").trim().slice(0, 40) || "钓友";
    const password = String(input.password || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      sendJson(res, 400, { error: "请输入有效邮箱。" });
      return;
    }
    if (password.length < 6) {
      sendJson(res, 400, { error: "密码至少 6 位。" });
      return;
    }
    if (db.users.some((user) => normalizeEmail(user.email) === email)) {
      sendJson(res, 409, { error: "这个邮箱已经注册。" });
      return;
    }
    const passwordData = hashPassword(password);
    const user = {
      id: crypto.randomUUID(),
      email,
      nickname,
      role: configuredAdminEmails().has(email) ? "admin" : "member",
      membership: "free",
      passwordHash: passwordData.hash,
      passwordSalt: passwordData.salt,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.users.push(user);
    setSessionCookie(req, res, db, user.id);
    db.feed.push({
      id: crypto.randomUUID(),
      type: "member",
      userId: user.id,
      title: "新钓友加入",
      text: `${nickname} 已创建 1490 账号。`,
      createdAt: new Date().toISOString(),
    });
    writeDb(db);
    sendJson(res, 201, { user: publicUser(user) });
    return;
  }

  if (req.method === "POST" && parsed.pathname === "/api/auth/login") {
    const input = await readJson(req);
    const email = normalizeEmail(input.email);
    const user = db.users.find((item) => normalizeEmail(item.email) === email);
    if (!user || !verifyPassword(input.password || "", user)) {
      sendJson(res, 401, { error: "邮箱或密码不正确。" });
      return;
    }
    user.lastLoginAt = new Date().toISOString();
    setSessionCookie(req, res, db, user.id);
    writeDb(db);
    sendJson(res, 200, { user: publicUser(user) });
    return;
  }

  if (req.method === "POST" && parsed.pathname === "/api/auth/logout") {
    const token = parseCookies(req)[sessionCookieName];
    db.sessions = db.sessions.filter((session) => session.token !== token);
    res.setHeader("Set-Cookie", cookieHeader(sessionCookieName, "", { maxAge: 0 }));
    writeDb(db);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "PATCH" && parsed.pathname === "/api/session") {
    const user = requireUser(req, res, db);
    if (!user) return;
    const input = await readJson(req);
    const nickname = String(input.nickname || user.nickname || "钓友").trim().slice(0, 40) || "钓友";
    user.nickname = nickname;
    user.updatedAt = new Date().toISOString();
    writeDb(db);
    sendJson(res, 200, { user: publicUser(user) });
    return;
  }

  if (req.method === "GET" && parsed.pathname === "/api/spots") {
    const user = requestUser(req, db);
    const visibleSpots = db.spots.filter((spot) => {
      if (spot.visibility === "public") return true;
      if (!user) return false;
      return spot.userId === user.id;
    });
    sendJson(res, 200, { spots: visibleSpots.slice(-200).reverse() });
    return;
  }

  if (req.method === "POST" && parsed.pathname === "/api/spots") {
    const user = requireUser(req, res, db);
    if (!user) return;
    const input = await readJson(req);
    const spot = {
      id: input.id || crypto.randomUUID(),
      userId: user.id,
      owner: user.nickname,
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
      userId: user.id,
      spotId: spot.id,
      title: "更新了钓点",
      text: `${user.nickname} · ${spot.name} · ${spot.targetFish || "目标鱼待补充"}`,
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
    const user = requireUser(req, res, db);
    if (!user) return;
    const input = await readJson(req);
    const item = {
      id: crypto.randomUUID(),
      type: input.type || "status",
      userId: user.id,
      spotId: input.spotId || "",
      title: String(input.title || `${user.nickname} 的鱼情动态`).slice(0, 120),
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

  if (req.method === "GET" && parsed.pathname === "/api/groups") {
    sendJson(res, 200, { groups: db.groups.slice(-100).reverse() });
    return;
  }

  if (req.method === "POST" && parsed.pathname === "/api/groups") {
    const user = requireUser(req, res, db);
    if (!user) return;
    const input = await readJson(req);
    const group = {
      id: input.id || crypto.randomUUID(),
      name: String(input.name || "未命名交流群").slice(0, 60),
      description: String(input.description || "").slice(0, 160),
      owner: user.nickname,
      members: Array.from(new Set([user.nickname, ...(Array.isArray(input.members) ? input.members : [])])).slice(0, 80),
      messages: Array.isArray(input.messages)
        ? input.messages.slice(-80).map((message) => ({
            id: message.id || crypto.randomUUID(),
            author: String(message.author || user.nickname).slice(0, 60),
            kind: message.kind === "voice" || message.audioUrl ? "voice" : "text",
            text: String(message.text || "").slice(0, 1000),
            audioUrl: String(message.audioUrl || "").slice(0, 700000),
            duration: Math.max(0, Number(message.duration) || 0),
            createdAt: message.createdAt || new Date().toISOString(),
          }))
        : [],
      createdAt: input.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (!group.messages.length) {
      group.messages.push({
        id: crypto.randomUUID(),
        author: user.nickname,
        text: `创建了交流群：${group.name}`,
        createdAt: new Date().toISOString(),
      });
    }
    db.groups = db.groups.filter((item) => item.id !== group.id).concat(group);
    db.feed.push({
      id: crypto.randomUUID(),
      type: "group",
      userId: user.id,
      title: "创建了交流群",
      text: `${user.nickname} · ${group.name}`,
      createdAt: new Date().toISOString(),
    });
    writeDb(db);
    sendJson(res, 201, { group });
    return;
  }

  const groupMessageMatch = parsed.pathname.match(/^\/api\/groups\/([^/]+)\/messages$/);
  if (req.method === "POST" && groupMessageMatch) {
    const user = requireUser(req, res, db);
    if (!user) return;
    const groupId = decodeURIComponent(groupMessageMatch[1]);
    const group = db.groups.find((item) => item.id === groupId);
    if (!group) {
      sendJson(res, 404, { error: "交流群不存在。" });
      return;
    }
    const input = await readJson(req);
    const isVoice = input.kind === "voice" || input.audioUrl;
    const message = {
      id: input.id || crypto.randomUUID(),
      author: user.nickname,
      kind: isVoice ? "voice" : "text",
      text: String(input.text || "").trim().slice(0, 1000),
      audioUrl: isVoice ? String(input.audioUrl || "").slice(0, 700000) : "",
      duration: isVoice ? Math.max(0, Number(input.duration) || 0) : 0,
      createdAt: new Date().toISOString(),
    };
    if (!message.text && !message.audioUrl) {
      sendJson(res, 400, { error: "消息不能为空。" });
      return;
    }
    group.messages = Array.isArray(group.messages) ? group.messages : [];
    group.messages.push(message);
    group.messages = group.messages.slice(-100);
    group.members = Array.from(new Set([...(Array.isArray(group.members) ? group.members : []), user.nickname])).slice(0, 80);
    group.updatedAt = message.createdAt;
    writeDb(db);
    sendJson(res, 201, { group, message });
    return;
  }

  if (req.method === "POST" && parsed.pathname === "/api/photo-analysis") {
    const user = requireUser(req, res, db);
    if (!user) return;
    const input = await readJson(req);
    const rule = speciesFromText(`${input.fileName || ""} ${input.speciesHint || ""}`);
    const analysis = {
      id: crypto.randomUUID(),
      userId: user.id,
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
      userId: user.id,
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
