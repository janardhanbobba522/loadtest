/**
 * Concurrent load test for the QA shipments search API.
 *
 * Usage:
 *   API_TOKEN="Bearer <token>" APP_ID="<app-id>" node load-test.js
 *
 * Optional env:
 *   TOTAL_REQUESTS=1000
 *   CONCURRENCY=10
 *   REQUEST_TIMEOUT_MS=30000
 *   PICKUP_FROM=2026-09-19T00:00:00
 *   PICKUP_TO=2026-09-26T23:59:59
 *   APP_ID=<app-id>
 *   API_BASE=https://api.qa.forwardair.com
 *   ORIGIN=https://premier.qa.forwardair.com
 */

const TOTAL_REQUESTS = Number(process.env.TOTAL_REQUESTS || 1000);
const CONCURRENCY = Number(process.env.CONCURRENCY || 50);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 30000);
const PICKUP_FROM = process.env.PICKUP_FROM || "2026-09-19T00:00:00";
const PICKUP_TO = process.env.PICKUP_TO || "2026-09-26T23:59:59";
const APP_ID = process.env.APP_ID || "";
const API_TOKEN = process.env.API_TOKEN || "";
const API_BASE =
  process.env.API_BASE || "https://api.qa.forwardair.com";
const ORIGIN =
  process.env.ORIGIN || "https://premier.qa.forwardair.com";

const url =
  `${API_BASE}/core/api/v1/shipments/v2/search` +
  "?limit=50&offset=0&sort=requestedPickupFromDate:desc" +
  `&requestedPickupFromDate=${encodeURIComponent(PICKUP_FROM)}` +
  `&requestedPickupToDate=${encodeURIComponent(PICKUP_TO)}`;

const headers = {
  accept: "application/json, text/plain, */*",
  "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
  "app-id": APP_ID,
  authorization: API_TOKEN,
  "cache-control": "no-cache",
  pragma: "no-cache",
  origin: ORIGIN,
  Referer: `${ORIGIN}/`,
};

function isIpv4(value) {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value);
}

function getPublicIpv4() {
  const https = require("node:https");

  return new Promise((resolve) => {
    const request = https.get(
      "https://api.ipify.org?format=json",
      { family: 4, timeout: 10000 },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          try {
            if (response.statusCode !== 200) {
              resolve(`unavailable (HTTP ${response.statusCode})`);
              return;
            }
            const data = JSON.parse(raw);
            const ip = data.ip || "";
            resolve(isIpv4(ip) ? ip : `unavailable (not IPv4: ${ip || "empty"})`);
          } catch (error) {
            resolve(`unavailable (${error.message})`);
          }
        });
      }
    );

    request.on("timeout", () => {
      request.destroy();
      resolve("unavailable (timeout)");
    });
    request.on("error", (error) => {
      resolve(`unavailable (${error.message})`);
    });
  });
}

function validateConfig() {
  if (!API_TOKEN) {
    console.error("Set API_TOKEN to the Authorization header value.");
    process.exit(1);
  }

  if (!Number.isInteger(TOTAL_REQUESTS) || TOTAL_REQUESTS < 1) {
    console.error("TOTAL_REQUESTS must be a positive integer.");
    process.exit(1);
  }

  if (!Number.isInteger(CONCURRENCY) || CONCURRENCY < 1) {
    console.error("CONCURRENCY must be a positive integer.");
    process.exit(1);
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1
  );
  return sorted[Math.max(0, index)];
}

async function callApi(i) {
  const start = Date.now();

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const body = await response.arrayBuffer();
    const elapsed = Date.now() - start;

    console.log(
      `${i}: ${response.status} - ${elapsed}ms - ${body.byteLength}b`
    );

    return {
      ok: response.ok,
      status: response.status,
      elapsed,
      bytes: body.byteLength,
    };
  } catch (error) {
    const elapsed = Date.now() - start;
    console.error(`${i}: FAILED - ${error.message} - ${elapsed}ms`);
    return {
      ok: false,
      status: "FAILED",
      elapsed,
      bytes: 0,
      error: error.message,
    };
  }
}

function printSummary(results, startedAt, endedAt, publicIp) {
  const wallMs = endedAt - startedAt;
  const wallMinutes = wallMs / 60000;
  const latencies = results.map((result) => result.elapsed).sort((a, b) => a - b);
  const failures = results.filter((result) => !result.ok);
  const bytes = results.reduce((sum, result) => sum + result.bytes, 0);
  const statusCounts = new Map();

  for (const result of results) {
    const key = String(result.status);
    statusCounts.set(key, (statusCounts.get(key) || 0) + 1);
  }

  const avg =
    latencies.reduce((sum, value) => sum + value, 0) / (latencies.length || 1);

  console.log("");
  console.log(`IPv4: ${publicIp}`);
  console.log(`Start: ${new Date(startedAt).toLocaleString()}`);
  console.log(`End: ${new Date(endedAt).toLocaleString()}`);
  console.log(
    `Total time: ${wallMinutes.toFixed(2)} mins (${wallMs}ms)`
  );
  console.log(`Completed: ${results.length}`);
  console.log(`Failures: ${failures.length}`);
  console.log(
    `Throughput: ${((results.length / wallMs) * 1000).toFixed(2)} req/s`
  );
  console.log(`Transferred: ${bytes} bytes`);
  console.log(
    `Latency ms: min=${latencies[0] ?? 0} avg=${Math.round(avg)} ` +
      `p50=${percentile(latencies, 50)} p95=${percentile(latencies, 95)} ` +
      `p99=${percentile(latencies, 99)} max=${latencies.at(-1) ?? 0}`
  );
  console.log(
    `Statuses: ${[...statusCounts.entries()]
      .map(([status, count]) => `${status}=${count}`)
      .join(" ")}`
  );
}

async function runLoadTest() {
  validateConfig();

  const publicIp = await getPublicIpv4();
  const results = new Array(TOTAL_REQUESTS);
  const startedAt = Date.now();
  let nextIndex = 0;
  let inFlight = 0;

  console.log(
    `Starting ${TOTAL_REQUESTS} requests in parallel, concurrency ${CONCURRENCY}`
  );
  console.log(`IPv4: ${publicIp}`);
  console.log(`Start: ${new Date(startedAt).toLocaleString()}`);
  console.log(url);

  await new Promise((resolve, reject) => {
    const launch = () => {
      while (inFlight < CONCURRENCY && nextIndex < TOTAL_REQUESTS) {
        const i = nextIndex++;
        inFlight++;

        callApi(i + 1)
          .then((result) => {
            results[i] = result;
            inFlight--;

            if (nextIndex >= TOTAL_REQUESTS && inFlight === 0) {
              resolve();
              return;
            }

            launch();
          })
          .catch(reject);
      }
    };

    launch();
  });

  const endedAt = Date.now();
  printSummary(results, startedAt, endedAt, publicIp);
}

runLoadTest();
