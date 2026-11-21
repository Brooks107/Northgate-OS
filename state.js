const fs = require("fs");
const path = require("path");

// Runtime state that staff toggle with commands (the lock flags).
//
// Keep runtime lock toggles separate from the environment-specific configs.
const STATE_FILE = path.join(__dirname, "state.json");

const KEYS = ["locked", "managementVoiceChannelLocked", "forceLocked", "maintenanceMode"];

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
        if (Number.isInteger(raw.defconLevel) && raw.defconLevel >= 1 && raw.defconLevel <= 6) {
            state.defconLevel = raw.defconLevel;
        }
        if (Array.isArray(raw.defconAddedDevelopers)) {
            state.defconAddedDevelopers = raw.defconAddedDevelopers.filter(
                id => typeof id === "string" && /^\d{17,20}$/.test(id)
            );
        }
        if (Array.isArray(raw.defconAdminRoleIds)) {
            state.defconAdminRoleIds = raw.defconAdminRoleIds.filter(
                id => typeof id === "string" && /^\d{17,20}$/.test(id)
            );
        }
        if (Array.isArray(raw.defconWhitelistedRoleIds)) {
            state.defconWhitelistedRoleIds = [...new Set(raw.defconWhitelistedRoleIds.filter(
                id => typeof id === "string" && /^\d{17,20}$/.test(id)
            ))];
        }
        if (Number.isSafeInteger(raw.nextServerBackupId) && raw.nextServerBackupId > 0) {
            state.nextServerBackupId = raw.nextServerBackupId;
        }
        if ("defconOwnsLock" in raw) {
            state.defconOwnsLock = Boolean(raw.defconOwnsLock);
        }
        if (typeof raw.defconStartedAt === "string") {
            state.defconStartedAt = raw.defconStartedAt;
        }
        if (typeof raw.defconStartedBy === "string" && /^\d{17,20}$/.test(raw.defconStartedBy)) {
            state.defconStartedBy = raw.defconStartedBy;
        }
        if (typeof raw.defconIssue === "string") {
            state.defconIssue = raw.defconIssue;
        }
        if (raw.adminPanel && typeof raw.adminPanel === "object") {
            state.adminPanel = raw.adminPanel;
        }
        if (raw.groupArrays && typeof raw.groupArrays === "object") {
            state.groupArrays = raw.groupArrays;
        }
        if (raw.groupArraysByEnvironment && typeof raw.groupArraysByEnvironment === "object") {
            state.groupArraysByEnvironment = raw.groupArraysByEnvironment;
        }
        return state;
    } catch {
        // No state file yet (or it is unreadable): callers fall back to
        // the defaults in the active environment config.
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
