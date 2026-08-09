import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { io } from "socket.io-client";

const apiBase = process.env.LOAD_API_URL ?? "http://127.0.0.1:4100/api/v1";
const webOrigin = process.env.LOAD_WEB_ORIGIN ?? "http://127.0.0.1:3100";
const socketUrl = process.env.LOAD_SOCKET_URL ?? "http://127.0.0.1:4100/realtime";
const profile = process.env.LOAD_PROFILE ?? "smoke";
const full = profile === "full";
const isolated = process.env.LOAD_TEST_ISOLATED === "true";
const writesEnabled = process.env.LOAD_ENABLE_WRITES === "true";

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required unless LOAD_USERS_FILE is set.`);
  return value;
}

if (full && !isolated) {
  throw new Error("The full profile requires LOAD_TEST_ISOLATED=true.");
}
if (writesEnabled && !isolated) {
  throw new Error("Write scenarios require an isolated test environment.");
}

const levels = full
  ? {
      logins: 100,
      authenticatedUsers: 250,
      conversationReads: 100,
      messageWrites: 100,
      imageUploads: 50,
      attendanceReads: 100,
      issueReads: 100,
      sockets: 100,
      readEvents: 100,
    }
  : {
      logins: 4,
      authenticatedUsers: 4,
      conversationReads: 12,
      messageWrites: 2,
      imageUploads: 1,
      attendanceReads: 8,
      issueReads: 8,
      sockets: 4,
      readEvents: 4,
    };

const configuredUsers = process.env.LOAD_USERS_FILE
  ? JSON.parse(await readFile(process.env.LOAD_USERS_FILE, "utf8"))
  : [
      {
        identifier: requiredEnvironment("LOAD_IDENTIFIER"),
        password: requiredEnvironment("LOAD_PASSWORD"),
        collegeCode: process.env.LOAD_COLLEGE_CODE ?? "6201",
      },
    ];

const samples = new Map();
const scenarioFailures = new Map();
const failureReasons = new Map();
let failures = 0;
let requests = 0;

function userAt(index) {
  return configuredUsers[index % configuredUsers.length];
}

function cookiesFrom(response) {
  const values = response.headers.getSetCookie?.() ?? [];
  return values.map((value) => value.split(";", 1)[0]).join("; ");
}

function csrfFrom(cookie) {
  return cookie
    .split("; ")
    .find((part) => part.startsWith("college_csrf="))
    ?.slice("college_csrf=".length);
}

function record(name, elapsed, ok) {
  requests += 1;
  if (!ok) {
    failures += 1;
    scenarioFailures.set(name, (scenarioFailures.get(name) ?? 0) + 1);
  }
  const list = samples.get(name) ?? [];
  list.push(elapsed);
  samples.set(name, list);
}

async function measured(name, operation) {
  const started = performance.now();
  try {
    const result = await operation();
    const ok = result instanceof Response ? result.ok : true;
    record(name, performance.now() - started, ok);
    return result;
  } catch (error) {
    record(name, performance.now() - started, false);
    return { error };
  }
}

async function login(index) {
  const account = userAt(index);
  const response = await measured("login", () =>
    fetch(`${apiBase}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: webOrigin },
      body: JSON.stringify(account),
    }),
  );
  if (!(response instanceof Response) || !response.ok) return null;
  const cookie = cookiesFrom(response);
  return { cookie, csrf: csrfFrom(cookie) };
}

async function authenticated(session, path, init = {}, metric = "authenticated") {
  return measured(metric, () =>
    fetch(`${apiBase}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        cookie: session.cookie,
        origin: webOrigin,
        ...(session.csrf ? { "x-csrf-token": session.csrf } : {}),
        ...init.headers,
      },
    }),
  );
}

async function repeat(count, sessions, operation) {
  await Promise.all(
    Array.from({ length: count }, (_, index) =>
      operation(sessions[index % sessions.length], index),
    ),
  );
}

const startedAt = performance.now();
const loginSessions = (
  await Promise.all(Array.from({ length: levels.logins }, (_, index) => login(index)))
).filter(Boolean);

if (!loginSessions.length) throw new Error("No load-test login succeeded.");

const sessions = [...loginSessions];
while (sessions.length < levels.authenticatedUsers) {
  const next = await login(sessions.length);
  if (!next) break;
  sessions.push(next);
}

await Promise.all([
  repeat(levels.conversationReads, sessions, (session) =>
    authenticated(session, "/conversations", {}, "conversation-list"),
  ),
  repeat(levels.attendanceReads, sessions, (session) =>
    authenticated(session, "/attendance/sessions?page=1&pageSize=20", {}, "attendance-read"),
  ),
  repeat(levels.issueReads, sessions, (session) =>
    authenticated(session, "/issues?page=1&pageSize=20", {}, "issue-read"),
  ),
]);

const conversationResponse = await authenticated(
  sessions[0],
  "/conversations",
  {},
  "conversation-bootstrap",
);
const conversations =
  conversationResponse instanceof Response && conversationResponse.ok
    ? await conversationResponse.json()
    : [];
const conversationId = Array.isArray(conversations) ? conversations[0]?.id : undefined;

if (conversationId) {
  await repeat(levels.readEvents, sessions, (session) =>
    authenticated(
      session,
      `/conversations/${conversationId}/read`,
      { method: "POST" },
      "message-read",
    ),
  );

  if (writesEnabled) {
    await repeat(levels.messageWrites, sessions, (session, index) =>
      authenticated(
        session,
        `/conversations/${conversationId}/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            body: `Isolated load message ${index}`,
            clientId: `load-${randomUUID()}`,
          }),
        },
        "message-send",
      ),
    );

    const imageBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
      "base64",
    );
    await repeat(levels.imageUploads, sessions, async (session, index) => {
      const messageResponse = await authenticated(
        session,
        `/conversations/${conversationId}/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            body: "Load-test image",
            messageType: "IMAGE",
            clientId: `load-image-${randomUUID()}`,
          }),
        },
        "image-message",
      );
      if (!(messageResponse instanceof Response) || !messageResponse.ok) return;
      const message = await messageResponse.json();
      const fileName = `load-image-${index}.png`;
      const attachment = {
        fileName,
        mimeType: "image/png",
        sizeBytes: imageBytes.length,
        purpose: "MESSAGE",
      };
      const presignResponse = await authenticated(
        session,
        `/messages/${message.id}/attachments/presign`,
        { method: "POST", body: JSON.stringify(attachment) },
        "image-presign",
      );
      if (!(presignResponse instanceof Response) || !presignResponse.ok) return;
      const presign = await presignResponse.json();
      const uploadResponse = await measured("image-object-upload", () =>
        fetch(presign.uploadUrl, {
          method: "PUT",
          headers: presign.requiredHeaders,
          body: imageBytes,
        }),
      );
      if (!(uploadResponse instanceof Response) || !uploadResponse.ok) return;
      await authenticated(
        session,
        `/messages/${message.id}/attachments/complete`,
        {
          method: "POST",
          body: JSON.stringify({ ...attachment, storageKey: presign.storageKey }),
        },
        "image-complete",
      );
    });

    if (process.env.LOAD_BROADCAST_ID) {
      await authenticated(
        sessions[0],
        `/announcements/${process.env.LOAD_BROADCAST_ID}/send-all`,
        {
          method: "POST",
          headers: { "idempotency-key": `load-${randomUUID()}` },
        },
        "broadcast-send",
      );
    }
  }
}

await Promise.all(
  sessions.slice(0, levels.sockets).map(
    (session) =>
      new Promise((resolve) => {
        const started = performance.now();
        const socket = io(socketUrl, {
          transports: ["websocket"],
          extraHeaders: { cookie: session.cookie },
          timeout: 10_000,
          reconnection: false,
        });
        const finish = (ok) => {
          record("websocket-connect", performance.now() - started, ok);
          socket.close();
          resolve();
        };
        socket.once("connect", () => finish(true));
        socket.once("connect_error", (error) => {
          if (!failureReasons.has("websocket-connect"))
            failureReasons.set("websocket-connect", error.message);
          finish(false);
        });
      }),
  ),
);

function percentile(values, value) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * value))] ?? 0;
}

const elapsedSeconds = (performance.now() - startedAt) / 1000;
const report = Object.fromEntries(
  [...samples.entries()].map(([name, values]) => [
    name,
    {
      count: values.length,
      failures: scenarioFailures.get(name) ?? 0,
      ...(failureReasons.has(name) ? { failureReason: failureReasons.get(name) } : {}),
      averageMs: Number((values.reduce((sum, item) => sum + item, 0) / values.length).toFixed(1)),
      p95Ms: Number(percentile(values, 0.95).toFixed(1)),
    },
  ]),
);

console.log(
  JSON.stringify(
    {
      profile,
      requests,
      requestsPerSecond: Number((requests / elapsedSeconds).toFixed(1)),
      errorRate: Number((failures / Math.max(1, requests)).toFixed(4)),
      failures,
      elapsedSeconds: Number(elapsedSeconds.toFixed(1)),
      writesEnabled,
      imageUploadConcurrency: levels.imageUploads,
      broadcastConfigured: Boolean(process.env.LOAD_BROADCAST_ID),
      scenarios: report,
      process: {
        rssMb: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(1)),
        cpuUserMs: Number((process.cpuUsage().user / 1000).toFixed(1)),
        cpuSystemMs: Number((process.cpuUsage().system / 1000).toFixed(1)),
      },
    },
    null,
    2,
  ),
);

if (failures > 0) process.exitCode = 1;
