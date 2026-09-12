const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { REST, Routes } = require("discord.js");

const COMMANDS_DIR = path.join(__dirname, "commands");
const CACHE_FILE = path.join(__dirname, ".command-cache.json");

function log(...args) {
    console.log("[commands]", ...args);
}

function warn(...args) {
    console.warn("[commands]", ...args);
}

/**
 * Load every command module in ./commands.
 *
 * A single broken file must never take the bot down, because command files
 * now arrive automatically from other devices via git-sync. Each file is
 * loaded in isolation; failures are reported and skipped.
 */
function loadCommands() {
    const loaded = new Map();
    const skipped = [];

    let files;
    try {
        files = fs.readdirSync(COMMANDS_DIR).filter(f => f.endsWith(".js")).sort();
    } catch (err) {
        warn("could not read commands directory:", err.message);
        return { loaded, skipped, payload: [], totalFiles: 0 };
    }

    for (const file of files) {
        const fullPath = path.join(COMMANDS_DIR, file);
        try {
            // Drop any cached copy so a reload always sees the file on disk.
            delete require.cache[require.resolve(fullPath)];

            const command = require(fullPath);

            if (!command?.data || typeof command.data.toJSON !== "function") {
                throw new Error("missing a `data` builder export");
            }
            if (typeof command.execute !== "function") {
                throw new Error("missing an `execute` function export");
            }

            const json = command.data.toJSON();
            if (!json?.name) {
                throw new Error("command data has no name");
            }
            if (loaded.has(json.name)) {
                throw new Error(`duplicate command name "${json.name}"`);
            }

            loaded.set(json.name, { command, json });
        } catch (err) {
            skipped.push({ file, reason: err.message });
            warn(`skipping ${file}: ${err.message}`);
        }
    }

    // Sorted so the payload hash is stable regardless of directory order.
    const payload = [...loaded.values()]
        .map(entry => entry.json)
        .sort((a, b) => a.name.localeCompare(b.name));

    return { loaded, skipped, payload, totalFiles: files.length };
}

function hashPayload(payload, clientId, guildId) {
    return crypto
        .createHash("sha256")
        .update(JSON.stringify({ clientId, guildId, payload }))
        .digest("hex");
}

function readCachedHash() {
    try {
        return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")).hash ?? null;
    } catch {
        return null;
    }
}

function writeCachedHash(hash, count) {
    try {
        fs.writeFileSync(
            CACHE_FILE,
            JSON.stringify({ hash, count, registeredAt: new Date().toISOString() }, null, 2)
        );
    } catch (err) {
        warn("could not write command cache (will re-register next boot):", err.message);
    }
}

/**
 * Push the command set to Discord, but only when it actually changed.
 *
 * git-sync restarts this process on every push, and Discord rate-limits
 * command registration, so re-uploading an identical set every boot is
 * both wasteful and risky.
 */
async function registerGuildCommands(config, options = {}) {
    const force = options.force === true;
    const { loaded, skipped, payload, totalFiles } = loadCommands();

    if (!config.guildId) {
        throw new Error("guildId is required; refusing to register commands globally");
    }

    // Never wipe the guild's command set because every file failed to load.
    // An empty PUT deletes all commands, which is almost certainly not what
    // a broken deploy intended.
    if (payload.length === 0 && totalFiles > 0) {
        warn(
            `all ${totalFiles} command file(s) failed to load; ` +
            "leaving the existing commands registered with Discord."
        );
        return { loaded, skipped, registered: false, reason: "all-failed" };
    }

    const hash = hashPayload(payload, config.clientId, config.guildId);

    if (!force && hash === readCachedHash()) {
        log(`${payload.length} command(s) unchanged; skipping registration.`);
        return { loaded, skipped, registered: false, reason: "unchanged" };
    }

     const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

    try {
        log(`registering ${payload.length} command(s) with Discord...`);
        await rest.put(
            Routes.applicationGuildCommands(config.clientId, config.guildId),
            { body: payload }
        );
        writeCachedHash(hash, payload.length);
        log("✅ commands registered:", payload.map(c => c.name).join(", "));
        return { loaded, skipped, registered: true };
    } catch (err) {
        warn("❌ failed to register commands:", err.message);
        return { loaded, skipped, registered: false, reason: "error", error: err };
    }
}

module.exports = { loadCommands, registerGuildCommands };
