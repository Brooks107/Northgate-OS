const fs = require("fs");
const path = require("path");

// Runtime state that staff toggle with commands (the lock flags).
//
// This deliberately lives OUTSIDE config.json. config.json is tracked by git
// and auto-synced every 15s; writing to it at runtime dirties the working tree,
// which makes git-sync's `merge --ff-only` abort as soon as any pushed commit
// touches config.json -- silently freezing auto-deploy until someone notices.
const STATE_FILE = path.join(__dirname, "state.json");

const KEYS = ["locked", "commissionLocked", "managementVoiceChannelLocked", "forceLocked", "maintenanceMode"];

function load() {
    try {
        const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));

        const state = {};
        for (const key of KEYS) {
            if (key in raw) state[key] = Boolean(raw[key]);
        }
        if ("forceLockOverwrites" in raw) {
            state.forceLockOverwrites = raw.forceLockOverwrites;
        }
        if (raw.adminPanel && typeof raw.adminPanel === "object") {
            state.adminPanel = raw.adminPanel;
        }
        if (raw.groupArrays && typeof raw.groupArrays === "object") {
            state.groupArrays = raw.groupArrays;
        }
        return state;
    } catch {
        // No state file yet (or it is unreadable): callers fall back to
        // whatever defaults config.json ships with.
        return {};
    }
}

function save(patch) {
    const next = { ...load(), ...patch };

    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 4));
        return true;
    } catch (err) {
        console.error("[state] could not persist state.json:", err.message);
        return false;
    }
}

module.exports = { load, save, STATE_FILE };
