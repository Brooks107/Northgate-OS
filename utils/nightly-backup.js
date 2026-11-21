const configManager = require("../configManager");
const { createServerBackup } = require("./server-backup");

let scheduleTimer = null;

function getNextRunAt(now = new Date()) {
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
        throw new TypeError("now must be a valid Date.");
    }

    return new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1
    ));
}

async function notifyBackupFailure(client, error) {
    const configuredDevelopers = Array.isArray(client.config?.developers)
        ? client.config.developers
        : [];
    const developerIds = [...new Set([
        process.env.SYNC_ALERT_USER_ID,
        ...configuredDevelopers
    ].filter(id => /^\d{17,20}$/.test(String(id || ""))))];
    const reason = String(error?.message || error).slice(0, 1200);
    let lastError;

    for (const developerId of developerIds) {
        try {
            const user = await client.users.fetch(developerId);
            await user.send({
                content: `⚠️ **NorthGate Main nightly backup failed.**\n**Reason:** ${reason}`,
                allowedMentions: { users: [user.id] }
            });
            return;
        } catch (notificationError) {
            lastError = notificationError;
        }
    }

    throw new Error(
        developerIds.length
            ? `Could not DM a configured developer: ${lastError.message}`
            : "No valid developer ID is configured for backup failure alerts."
    );
}

async function createMainServerBackup(
    client,
    manager = configManager,
    backupCreator = createServerBackup
) {
    const mainGuildId = manager.getMainGuildId();
    const backupChannelId = manager.getMainBackupChannelId();
    const guild = client.guilds.cache.get(mainGuildId)
        || await client.guilds.fetch(mainGuildId);
    return backupCreator(guild, client, backupChannelId);
}

async function runMainBackup(client) {
    try {
        const receipt = await createMainServerBackup(client);
        console.log(
            `[nightly-backup] created Main backup #${receipt.backupId} (${receipt.filename}).`
        );
        return receipt;
    } catch (error) {
        console.error("[nightly-backup] Main backup failed:", error);
        try {
            await notifyBackupFailure(client, error);
        } catch (notificationError) {
            console.error("[nightly-backup] could not notify a developer:", notificationError);
        }
        return null;
    }
}

function scheduleNext(client) {
    const runAt = getNextRunAt();
    const delay = Math.max(0, runAt.getTime() - Date.now());
    scheduleTimer = setTimeout(async () => {
        scheduleTimer = null;
        try {
            await runMainBackup(client);
        } finally {
            scheduleNext(client);
        }
    }, delay);
    scheduleTimer.unref?.();
    console.log(`[nightly-backup] next Main backup scheduled for ${runAt.toISOString()}.`);
}

function start(client) {
    if (!client?.guilds) {
        throw new TypeError("A Discord client is required to start nightly backups.");
    }
    if (scheduleTimer) return;
    scheduleNext(client);
}

function stop() {
    if (scheduleTimer) clearTimeout(scheduleTimer);
    scheduleTimer = null;
}

module.exports = {
    createMainServerBackup,
    getNextRunAt,
    runMainBackup,
    start,
    stop
};
