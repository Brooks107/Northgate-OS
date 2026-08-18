const fs = require("fs");
const os = require("os");
const path = require("path");

const HEARTBEAT_DIR =
  process.env.HEARTBEAT_DIR || path.join(os.homedir(), ".status-heartbeats");

const SERVICE = "northgate-os";
const INTERVAL_MS = 30_000;

let lastStatus = null;
let statusSince = null;

const WS_STATUS = {
  0: "ready",
  1: "connecting",
  2: "reconnecting",
  3: "idle",
  4: "nearly",
  5: "disconnected",
  6: "waiting-for-guilds",
  7: "identifying",
  8: "resuming",
};

function write(client) {
  let payload;
  try {
    const ready = typeof client?.isReady === "function" && client.isReady();
    const wsStatus = client?.ws?.status;
    const ping = client?.ws?.ping;

    payload = {
      service: SERVICE,
      ts: Date.now(),
      status: ready ? "ready" : (WS_STATUS[wsStatus] ?? "offline"),

      pingMs: typeof ping === "number" && ping >= 0 ? Math.round(ping) : null,
      guilds: client?.guilds?.cache?.size ?? null,
      uptimeSec: Math.round(process.uptime()),
    };
  } catch (err) {
    payload = {
      service: SERVICE,
      ts: Date.now(),
      status: "offline",
      pingMs: null,
      guilds: null,
      uptimeSec: Math.round(process.uptime()),
      error: err && err.message ? err.message : String(err),
    };
  }

  if (payload.status !== lastStatus) {
    lastStatus = payload.status;
    statusSince = payload.ts;
  }
  payload.statusSince = statusSince;

  const target = path.join(HEARTBEAT_DIR, `${SERVICE}.json`);
  const tmp = `${target}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(payload));
    fs.renameSync(tmp, target);
  } catch (err) {
    console.warn(
      `[heartbeat] could not write ${target}: ${err && err.message ? err.message : err}`,
    );
  }
}

function startHeartbeat(client) {
  try {
    fs.mkdirSync(HEARTBEAT_DIR, { recursive: true });
  } catch (err) {
    console.warn(
      `[heartbeat] could not create ${HEARTBEAT_DIR}: ${err && err.message ? err.message : err}`,
    );
    return;
  }

  write(client);

  setInterval(() => write(client), INTERVAL_MS).unref();
}

module.exports = { startHeartbeat };
