import { spawn } from "node:child_process";
import http from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const httpProxy = require("http-proxy");

const publicPort = positivePort(process.env.PORT, 10000);
const apiPort = positivePort(process.env.API_INTERNAL_PORT, 4000);
const webPort = positivePort(process.env.WEB_INTERNAL_PORT, 3000);
if (new Set([publicPort, apiPort, webPort]).size !== 3) {
  throw new Error("PORT, API_INTERNAL_PORT, and WEB_INTERNAL_PORT must differ.");
}

const apiTarget = `http://127.0.0.1:${apiPort}`;
const webTarget = `http://127.0.0.1:${webPort}`;
const children = [];
let stopping = false;

const api = start("api", "node", ["apps/api/dist/main.js"], {
  PORT: String(apiPort),
});
const web = start("web", "node", ["apps/web/server.js"], {
  PORT: String(webPort),
  HOSTNAME: "127.0.0.1",
});
children.push(api, web);

const proxy = httpProxy.createProxyServer({
  changeOrigin: false,
  xfwd: true,
  ws: true,
});

proxy.on("error", (error, _request, response) => {
  process.stderr.write(`[gateway] upstream unavailable: ${error.message}\n`);
  if (response && "writeHead" in response && !response.headersSent) {
    response.writeHead(503, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "starting" }));
  }
});

const server = http.createServer((request, response) => {
  const target = isApiRequest(request.url) ? apiTarget : webTarget;
  proxy.web(request, response, { target });
});

server.on("upgrade", (request, socket, head) => {
  const target = request.url?.startsWith("/socket.io") ? apiTarget : webTarget;
  proxy.ws(request, socket, head, { target });
});

server.listen(publicPort, "0.0.0.0", () => {
  process.stdout.write(`[gateway] listening on 0.0.0.0:${publicPort}\n`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => void shutdown(signal));
}

function isApiRequest(url = "") {
  return (
    url === "/health" ||
    url.startsWith("/health/") ||
    url === "/api/v1" ||
    url.startsWith("/api/v1/") ||
    url.startsWith("/socket.io")
  );
}

function start(name, command, args, overrides) {
  const child = spawn(command, args, {
    env: { ...process.env, ...overrides },
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    process.stderr.write(
      `[gateway] ${name} exited unexpectedly (${signal ?? code ?? "unknown"}).\n`,
    );
    void shutdown("SIGTERM", 1);
  });
  return child;
}

async function shutdown(signal, exitCode = 0) {
  if (stopping) return;
  stopping = true;
  server.close();
  proxy.close();
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
  const timer = setTimeout(() => {
    for (const child of children) {
      if (!child.killed) child.kill("SIGKILL");
    }
  }, 10_000);
  timer.unref();
  await Promise.all(
    children.map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) resolve();
          else child.once("exit", resolve);
        }),
    ),
  );
  process.exit(exitCode);
}

function positivePort(value, fallback) {
  const port = Number(value ?? fallback);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("A configured port is invalid.");
  }
  return port;
}
