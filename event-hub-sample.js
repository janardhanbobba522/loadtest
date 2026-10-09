/**
 * Azure Event Hub sample: list hubs / properties and send a test event.
 *
 * Setup:
 *   npm install
 *
 * Env (required):
 *   EVENT_HUB_CONNECTION_STRING="Endpoint=sb://..../;SharedAccessKeyName=...;SharedAccessKey=...;EntityPath=my-hub"
 *
 * If EntityPath is missing from the connection string, also set:
 *   EVENT_HUB_NAME=my-hub
 *
 * Usage:
 *   node event-hub-sample.js list
 *   node event-hub-sample.js send
 *   node event-hub-sample.js receive
 *
 * Optional for send:
 *   MESSAGE='{"hello":"world"}'
 *   COUNT=1
 *
 * Optional for receive:
 *   MAX_EVENTS=5
 *   RECEIVE_SECONDS=15
 */

const crypto = require("node:crypto");
const {
  EventHubProducerClient,
  EventHubConsumerClient,
  earliestEventPosition,
} = require("@azure/event-hubs");

const CONNECTION_STRING = process.env.EVENT_HUB_CONNECTION_STRING || "";
const EVENT_HUB_NAME =
  process.env.EVENT_HUB_NAME ||  "";
const MESSAGE = {"actualWeight":null,"actualWeightType":null,"airportCd":"EVV","city":null,"countryCd":null,"createdAt":"Oct 8, 2026 4:55:23 AM","createdUid":"cartageedi/NuvizzInbound","dimFlag":null,"dimWeight":null,"latitude":"39.83431","longitude":"-82.92391","manifestId":null,"pieces":0,"podName":null,"position":null,"recordDt":"Sep 8, 2026 3:54:54 PM","recordedBy":null,"stateProvinceCd":null,"statusCd":"PUP","statusComment":"Stop Delivery","timeZoneCd":null,"weight":null};
const COUNT = Number(process.env.COUNT || 1);
const MAX_EVENTS = Number(process.env.MAX_EVENTS || 5);
const RECEIVE_SECONDS = Number(process.env.RECEIVE_SECONDS || 15);

function parseConnectionString(value) {
  const parts = {};
  for (const segment of String(value).split(";")) {
    if (!segment) continue;
    const index = segment.indexOf("=");
    if (index === -1) continue;
    parts[segment.slice(0, index)] = segment.slice(index + 1);
  }
  return parts;
}

function parseEntityPath(connectionString) {
  return parseConnectionString(connectionString).EntityPath || "";
}

function parseNamespaceHost(connectionString) {
  const endpoint = parseConnectionString(connectionString).Endpoint || "";
  try {
    return new URL(endpoint).host;
  } catch {
    return "";
  }
}

function createSasToken(connectionString, resourceUri, ttlSeconds = 3600) {
  const parts = parseConnectionString(connectionString);
  const keyName = parts.SharedAccessKeyName;
  const key = parts.SharedAccessKey;

  if (!keyName || !key) {
    throw new Error(
      "Connection string must include SharedAccessKeyName and SharedAccessKey."
    );
  }

  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  const stringToSign = `${encodeURIComponent(resourceUri)}\n${expiry}`;
  const signature = crypto
    .createHmac("sha256", key)
    .update(stringToSign)
    .digest("base64");

  return (
    `SharedAccessSignature sr=${encodeURIComponent(resourceUri)}` +
    `&sig=${encodeURIComponent(signature)}` +
    `&se=${expiry}` +
    `&skn=${encodeURIComponent(keyName)}`
  );
}

function requireConfig(needHubName) {
  if (!CONNECTION_STRING) {
    console.error(
      "Set EVENT_HUB_CONNECTION_STRING to your Azure Event Hub connection string."
    );
    process.exit(1);
  }

  if (needHubName && !EVENT_HUB_NAME) {
    console.error(
      "Set EVENT_HUB_NAME, or include EntityPath=... in the connection string."
    );
    process.exit(1);
  }
}

async function listEventHubs() {
  requireConfig(false);

  const host = parseNamespaceHost(CONNECTION_STRING);
  if (!host) {
    throw new Error("Could not parse Endpoint from the connection string.");
  }

  const resourceUri = `https://${host}`;
  const token = createSasToken(CONNECTION_STRING, resourceUri);
  const url = `https://${host}/$Resources/EventHubs?api-version=2014-01`;

  console.log(`Namespace: ${host}`);
  console.log("Listing Event Hubs...\n");

  const response = await fetch(url, {
    headers: {
      Authorization: token,
      Accept: "application/atom+xml;type=feed;charset=utf-8",
    },
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`List failed (${response.status}): ${body.slice(0, 500)}`);
  }

  const titles = [...body.matchAll(/<title[^>]*>([^<]+)<\/title>/g)].map(
    (match) => match[1]
  );
  const hubNames = titles.filter(
    (title) => title && title !== "EventHubs" && !title.startsWith("http")
  );

  if (hubNames.length === 0) {
    console.log("No Event Hubs found (or response could not be parsed).");
    console.log("Raw response (truncated):");
    console.log(body.slice(0, 800));
    return;
  }

  console.log(`Found ${hubNames.length} Event Hub(s):`);
  for (const name of hubNames) {
    console.log(`- ${name}`);
  }

  const hubName = EVENT_HUB_NAME || hubNames[0];
  if (!hubName) return;

  console.log(`\nDetails for: ${hubName}`);
  const client = new EventHubProducerClient(CONNECTION_STRING, hubName);
  try {
    const properties = await client.getEventHubProperties();
    const partitions = await client.getPartitionIds();
    console.log(`  name: ${properties.name}`);
    console.log(`  createdOn: ${properties.createdOn}`);
    console.log(`  partitionCount: ${partitions.length}`);
    console.log(`  partitionIds: ${partitions.join(", ")}`);
  } finally {
    await client.close();
  }
}

async function sendSample() {
  requireConfig(true);

  const client = new EventHubProducerClient(CONNECTION_STRING, EVENT_HUB_NAME);
  const count = Number.isInteger(COUNT) && COUNT > 0 ? COUNT : 1;

  try {
    const batch = await client.createBatch();
    const events = [];

    for (let i = 1; i <= count; i++) {
      const payload = MESSAGE
        ? safeJsonParse(MESSAGE)
        : {
            source: "event-hub-sample",
            type: "test",
            index: i,
            sentAt: new Date().toISOString(),
            message: "Hello from Event Hub sample",
          };

      const event = {
        body: payload,
        properties: {
          sample: "true",
          index: String(i),
        },
      };

      if (!batch.tryAdd(event)) {
        throw new Error("Event is too large for a single batch.");
      }
      events.push(payload);
    }

    await client.sendBatch(batch);

    console.log(`Sent ${events.length} event(s) to Event Hub "${EVENT_HUB_NAME}"`);
    console.log(JSON.stringify(events, null, 2));
  } finally {
    await client.close();
  }
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function receiveSample() {
  requireConfig(true);

  const consumerGroup =
    process.env.EVENT_HUB_CONSUMER_GROUP || "$Default";
  const client = new EventHubConsumerClient(
    consumerGroup,
    CONNECTION_STRING,
    EVENT_HUB_NAME
  );

  const received = [];
  console.log(
    `Listening on "${EVENT_HUB_NAME}" (group: ${consumerGroup}) for up to ${RECEIVE_SECONDS}s...`
  );

  const subscription = client.subscribe(
    {
      processEvents: async (events) => {
        for (const event of events) {
          received.push({
            body: event.body,
            enqueuedTimeUtc: event.enqueuedTimeUtc,
            partitionId: event.partitionKey || undefined,
            sequenceNumber: event.sequenceNumber,
          });
          console.log(
            `Event #${received.length}: ${JSON.stringify(event.body)}`
          );
          if (received.length >= MAX_EVENTS) {
            await subscription.close();
          }
        }
      },
      processError: async (error) => {
        console.error(`Receive error: ${error.message}`);
      },
    },
    { startPosition: earliestEventPosition }
  );

  await new Promise((resolve) => setTimeout(resolve, RECEIVE_SECONDS * 1000));
  await subscription.close();
  await client.close();

  console.log(`\nReceived ${received.length} event(s).`);
}

async function main() {
  const command = (process.argv[2] || "list").toLowerCase();

  if (command === "list") {
    await listEventHubs();
    return;
  }

  if (command === "send") {
    await sendSample();
    return;
  }

  if (command === "receive") {
    await receiveSample();
    return;
  }

  console.error(`Unknown command: ${command}`);
  console.error("Use: list | send | receive");
  process.exit(1);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
