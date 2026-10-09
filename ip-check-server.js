/**
 * Local page + API to show the client IP for incoming requests.
 *
 * Usage:
 *   node ip-check-server.js
 *
 * Optional env:
 *   PORT=3456
 *
 * Open http://localhost:3456 in a browser, or call GET /api/ip from load tests.
 */

const http = require("node:http");

const PORT = Number(process.env.PORT || 3456);

function isIpv4(value) {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value);
}

function toIpv4(value) {
  if (!value) return null;

  let ip = String(value).trim();
  if (ip.startsWith("::ffff:")) {
    ip = ip.slice(7);
  }
  if (ip === "::1") {
    return "127.0.0.1";
  }
  if (isIpv4(ip)) {
    return ip;
  }

  return null;
}

function getClientIp(req) {
  const candidates = [];

  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    for (const part of String(forwarded).split(",")) {
      candidates.push(part.trim());
    }
  }

  if (req.headers["x-real-ip"]) {
    candidates.push(String(req.headers["x-real-ip"]).trim());
  }

  if (req.socket.remoteAddress) {
    candidates.push(req.socket.remoteAddress);
  }

  for (const candidate of candidates) {
    const ipv4 = toIpv4(candidate);
    if (ipv4) return ipv4;
  }

  return "unknown";
}

function htmlPage(data) {
  const json = JSON.stringify(data, null, 2);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Client IP</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, Segoe UI, sans-serif;
      margin: 0;
      min-height: 100vh;
      background: #0f1419;
      color: #e7ecf3;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    main {
      width: min(640px, 100%);
      background: #1a2332;
      border: 1px solid #2d3a4f;
      border-radius: 12px;
      padding: 28px 32px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
    }
    h1 { margin: 0 0 8px; font-size: 1.35rem; font-weight: 600; }
    p { margin: 0 0 20px; color: #9aa8bc; font-size: 0.95rem; line-height: 1.5; }
    .ip {
      font-size: 1.75rem;
      font-weight: 700;
      letter-spacing: 0.02em;
      color: #6ee7b7;
      word-break: break-all;
      margin-bottom: 24px;
    }
    pre {
      margin: 0;
      padding: 16px;
      background: #0f1419;
      border-radius: 8px;
      overflow: auto;
      font-size: 0.8rem;
      line-height: 1.45;
      color: #c5d0de;
    }
    .meta { margin-top: 20px; font-size: 0.85rem; color: #7b8a9e; }
    button {
      margin-top: 16px;
      padding: 10px 16px;
      border: none;
      border-radius: 8px;
      background: #3b82f6;
      color: #fff;
      font-size: 0.9rem;
      cursor: pointer;
    }
    button:hover { background: #2563eb; }
  </style>
</head>
<body>
  <main>
    <h1>Your request IPv4</h1>
    <p>This is the IPv4 address the server sees for this call (including proxy headers when present).</p>
    <div class="ip" id="ip">${escapeHtml(data.clientIpv4)}</div>
    <pre id="details">${escapeHtml(json)}</pre>
    <button type="button" onclick="location.reload()">Refresh</button>
    <p class="meta">JSON API: <code>GET /api/ip</code></p>
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildPayload(req) {
  const clientIpv4 = getClientIp(req);

  return {
    clientIpv4,
    method: req.method,
    path: req.url,
    time: new Date().toISOString(),
    headers: {
      "x-forwarded-for": req.headers["x-forwarded-for"] || null,
      "x-real-ip": req.headers["x-real-ip"] || null,
      "user-agent": req.headers["user-agent"] || null,
    },
    socketRemoteAddress: toIpv4(req.socket.remoteAddress),
  };
}

const server = http.createServer((req, res) => {
  const payload = buildPayload(req);

  if (req.url === "/api/ip" || req.url?.startsWith("/api/ip?")) {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload, null, 2));
    return;
  }

  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(htmlPage(payload));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: "Not found", clientIpv4: payload.clientIpv4 }));
});

server.listen(PORT, () => {
  console.log(`IP check server listening on http://localhost:${PORT}`);
  console.log(`API: http://localhost:${PORT}/api/ip`);
});
