/**
 * Concurrent load test for the DEV custom reset password email API.
 *
 * Usage:
 *   node load-test-reset-password.js
 *
 * Optional env:
 *   TOTAL_REQUESTS=100
 *   CONCURRENCY=10
 *   REQUEST_TIMEOUT_MS=30000
 *   EMAIL=you@example.com
 *   API_URL=https://api.dev.forwardair.com/core/api/auth/customResetPasswordEmail
 */

const TOTAL_REQUESTS = Number(process.env.TOTAL_REQUESTS || 100);
const CONCURRENCY = Number(process.env.CONCURRENCY || 10);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 30000);
const EMAIL = process.env.EMAIL || "";
const url =
  process.env.API_URL ||
  "https://api.dev.forwardair.com/core/api/auth/customResetPasswordEmail";

const headers = {
  "Content-Type": "application/json",
};

const body = JSON.stringify({ email: EMAIL });

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
  if (!EMAIL) {
    console.error("Set EMAIL to the address used in the request body.");
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
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const text = await response.text();
    const elapsed = Date.now() - start;

    console.log(
      `${i}: ${response.status} - ${elapsed}ms - ${text.length}b` +
        (text ? ` - ${text.slice(0, 120)}` : "")
    );

    return {
      ok: response.ok,
      status: response.status,
      elapsed,
      bytes: text.length,
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
  console.log(`Total time: ${wallMinutes.toFixed(2)} mins (${wallMs}ms)`);
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
  console.log(`POST ${url}`);
  console.log(`Body: ${body}`);

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
