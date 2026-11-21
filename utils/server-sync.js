const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
    ActionRowBuilder,
    AuditLogEvent,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    MessageFlags
} = require("discord.js");
const configManager = require("../configManager");

const STATE_FILE = path.join(__dirname, "..", "server-sync-state.json");
const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const ALERT_USERNAME = "brooksy246";
const THRESHOLDS = {
    channelsCreated: 10,
    channelsDeleted: 5,
    rolesCreated: 5,
    rolesDeleted: 5
};
const SUPPORTED_CHANNEL_TYPES = new Set([
    ChannelType.GuildText,
    ChannelType.GuildVoice,
    ChannelType.GuildCategory,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildStageVoice,
    ChannelType.GuildForum,
    ChannelType.GuildMedia
]);
const THREAD_CHANNEL_TYPES = new Set([
    ChannelType.AnnouncementThread,
    ChannelType.PublicThread,
    ChannelType.PrivateThread
]);
const pendingApprovals = new Map();
let activeSync = false;
let scheduleTimer = null;

function readState() {
    try {
        return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    } catch (error) {
        if (error.code === "ENOENT") return {};
        throw new Error(`Could not read server sync state: ${error.message}`);
    }
}

function saveState(patch) {
    const temporaryPath = `${STATE_FILE}.${process.pid}.tmp`;
    try {
        const next = { ...readState(), ...patch };
        fs.writeFileSync(temporaryPath, `${JSON.stringify(next, null, 4)}\n`, "utf8");
        fs.renameSync(temporaryPath, STATE_FILE);
    } catch (error) {
        try {
            if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
        } catch (cleanupError) {
            console.error("[server-sync] could not remove temporary state file:", cleanupError.message);
        }
        throw new Error(`Could not save server sync state: ${error.message}`);
    }
}

async function getGuild(client, guildId) {
    return client.guilds.cache.get(guildId) || client.guilds.fetch(guildId);
}

async function countRecentAuditEntries(guild, action, since) {
    const auditLog = await guild.fetchAuditLogs({ type: action, limit: 100 });
    return auditLog.entries.filter(entry => entry.createdTimestamp >= since).size;
}

async function getRecentChanges(guild) {
    const since = Date.now() - SYNC_INTERVAL_MS;
    const [channelsCreated, channelsDeleted, rolesCreated, rolesDeleted] = await Promise.all([
        countRecentAuditEntries(guild, AuditLogEvent.ChannelCreate, since),
        countRecentAuditEntries(guild, AuditLogEvent.ChannelDelete, since),
        countRecentAuditEntries(guild, AuditLogEvent.RoleCreate, since),
        countRecentAuditEntries(guild, AuditLogEvent.RoleDelete, since)
    ]);

    return { channelsCreated, channelsDeleted, rolesCreated, rolesDeleted };
}

function getTriggeredThresholds(changes) {
    return Object.entries(THRESHOLDS)
        .filter(([key, threshold]) => changes[key] >= threshold)
        .map(([key, threshold]) => ({ key, count: changes[key], threshold }));
}

async function resolveAlertUser(client) {
    const configuredId = process.env.SYNC_ALERT_USER_ID;
    if (configuredId && /^\d{17,20}$/.test(configuredId)) {
        return client.users.fetch(configuredId);
    }

    const cached = client.users.cache.find(
        user => user.username.toLowerCase() === ALERT_USERNAME
    );
    if (cached) return cached;

    for (const guildId of [configManager.getMainGuildId(), configManager.getVaultGuildId()]) {
        let guild;
        try {
            guild = await getGuild(client, guildId);
            const matches = await guild.members.search({ query: ALERT_USERNAME, limit: 10 });
            const member = matches.find(
                candidate => candidate.user.username.toLowerCase() === ALERT_USERNAME
            );
            if (member) return member.user;
        } catch (error) {
            console.warn(`[server-sync] could not find ${ALERT_USERNAME} in guild ${guildId}:`, error.message);
        }
    }

    throw new Error(
        `Could not resolve Discord user "${ALERT_USERNAME}". Set SYNC_ALERT_USER_ID to their user ID.`
    );
}

function describeChanges(changes) {
    return [
        `Channels created: **${changes.channelsCreated}** (limit ${THRESHOLDS.channelsCreated})`,
        `Channels deleted: **${changes.channelsDeleted}** (limit ${THRESHOLDS.channelsDeleted})`,
        `Roles created: **${changes.rolesCreated}** (limit ${THRESHOLDS.rolesCreated})`,
        `Roles deleted: **${changes.rolesDeleted}** (limit ${THRESHOLDS.rolesDeleted})`
    ].join("\n");
}

async function alertForApproval(client, details, changes = null) {
    const user = await resolveAlertUser(client);
    const token = crypto.randomBytes(12).toString("hex");
    const expiresAt = Date.now() + 30 * 60 * 1000;
    pendingApprovals.set(token, {
        userId: user.id,
        expiresAt,
        client
    });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`server_sync_abort_${token}`)
            .setLabel("Confirm abort")
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`server_sync_override_${token}`)
            .setLabel("Sync anyway")
            .setStyle(ButtonStyle.Success)
    );
    const content = [
        "🚨 **NorthGate server sync paused for approval.**",
        details,
        changes ? describeChanges(changes) : null,
        "Choose **Confirm abort** to leave the vault unchanged, or **Sync anyway** to proceed with a full mirror."
    ].filter(Boolean).join("\n\n");

    try {
        await user.send({
            content,
            components: [row],
            allowedMentions: { users: [user.id] }
        });
    } catch (error) {
        pendingApprovals.delete(token);
        throw new Error(`Could not DM ${ALERT_USERNAME}; sync remains paused: ${error.message}`);
    }

    setTimeout(() => pendingApprovals.delete(token), 30 * 60 * 1000).unref?.();
    console.warn(`[server-sync] sync paused and approval requested from ${ALERT_USERNAME}.`);
}

async function notifySyncFailure(client, error) {
    const reason = error instanceof Error ? error.message : String(error);
    try {
        const user = await resolveAlertUser(client);
        await user.send({
            content:
                `⚠️ **NorthGate Main-to-Vault sync failed.**\n` +
                `It may have made partial changes before failing.\n` +
                `**Reason:** ${reason.slice(0, 1500)}`,
            allowedMentions: { users: [user.id] }
        });
    } catch (notificationError) {
        console.error(
            `[server-sync] could not notify ${ALERT_USERNAME} about the sync failure:`,
            notificationError
        );
    }
}

async function handleInteraction(interaction) {
    if (!interaction.isButton()) return false;
    const match = interaction.customId.match(/^server_sync_(abort|override)_([a-f0-9]{24})$/);
    if (!match) return false;

    const pending = pendingApprovals.get(match[2]);
    if (!pending || pending.expiresAt < Date.now()) {
        pendingApprovals.delete(match[2]);
        await interaction.reply({
            content: "⌛ This sync approval has expired. The vault was not changed.",
            flags: MessageFlags.Ephemeral
        });
        return true;
    }
    if (interaction.user.id !== pending.userId) {
        await interaction.reply({
            content: "❌ Only the developer who received this alert can approve the sync.",
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    pendingApprovals.delete(match[2]);
    if (match[1] === "abort") {
        await interaction.reply({
            content: "✅ Sync aborted. The vault was left unchanged.",
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    await interaction.reply({
        content: "⚠️ Approval received. Starting the full main-to-vault sync.",
        flags: MessageFlags.Ephemeral
    });
    void runSync(pending.client, { bypassCircuitBreaker: true });
    return true;
}

function roleIdentity(role) {
    return role.name;
}

function channelIdentity(channel, parentName = "") {
    return `${channel.type}:${parentName}:${channel.name}`;
}

function indexByIdentity(items, identity) {
    const indexed = new Map();
    for (const item of items) {
        const key = identity(item);
        const queue = indexed.get(key) || [];
        queue.push(item);
        indexed.set(key, queue);
    }
    return indexed;
}

function takeByIdentity(indexed, identity) {
    const queue = indexed.get(identity);
    return queue?.shift() || null;
}

function sortedRoles(guild) {
    return [...guild.roles.cache.values()]
        .filter(role => role.id !== guild.id && !role.managed)
        .sort((left, right) => left.position - right.position);
}

async function roleOptions(role) {
    const options = {
        name: role.name,
        colors: { primaryColor: role.colors.primaryColor },
        hoist: role.hoist,
        mentionable: role.mentionable,
        permissions: role.permissions.bitfield.toString(),
        unicodeEmoji: role.unicodeEmoji
    };
    if (role.colors.secondaryColor !== null) {
        options.colors.secondaryColor = role.colors.secondaryColor;
    }
    if (role.colors.tertiaryColor !== null) {
        options.colors.tertiaryColor = role.colors.tertiaryColor;
    }
    const iconUrl = role.iconURL({ extension: "png", size: 256 });
    if (iconUrl) {
        const response = await fetch(iconUrl, { signal: AbortSignal.timeout(15_000) });
        if (!response.ok) {
            throw new Error(`Could not download the icon for role "${role.name}" (${response.status}).`);
        }
        options.icon = Buffer.from(await response.arrayBuffer());
    } else {
        options.icon = null;
    }
    return options;
}

async function syncRoles(source, target) {
    await Promise.all([source.roles.fetch(), target.roles.fetch()]);
    const targetIndex = indexByIdentity(sortedRoles(target), roleIdentity);
    const sourceRoles = sortedRoles(source);
    const roleMap = new Map();
    const retainedTargetIds = new Set();
    const positionUpdates = [];
    const optionsByRole = new Map(await Promise.all(
        sourceRoles.map(async role => [role, await roleOptions(role)])
    ));
    let created = 0;
    let updated = 0;

    for (const sourceRole of sourceRoles) {
        let targetRole = takeByIdentity(targetIndex, roleIdentity(sourceRole));
        const options = { ...optionsByRole.get(sourceRole) };
        if (targetRole) {
            options.colors = {
                primaryColor: sourceRole.colors.primaryColor,
                secondaryColor: sourceRole.colors.secondaryColor,
                tertiaryColor: sourceRole.colors.tertiaryColor
            };
        }
        if (!targetRole) {
            targetRole = await target.roles.create({
                ...options,
                reason: "Automated 24-hour main-to-vault server sync"
            });
            created++;
        } else {
            await targetRole.edit({
                ...options,
                reason: "Automated 24-hour main-to-vault server sync"
            });
            updated++;
        }
        roleMap.set(sourceRole.id, targetRole.id);
        retainedTargetIds.add(targetRole.id);
        positionUpdates.push({ role: targetRole, position: sourceRole.position });
    }

    if (positionUpdates.length) {
        await target.roles.setPositions(positionUpdates);
    }

    const extraRoles = sortedRoles(target).filter(role => !retainedTargetIds.has(role.id));
    for (const role of extraRoles) {
        await role.delete("Automated 24-hour main-to-vault server sync");
    }

    await target.roles.everyone.setPermissions(
        source.roles.everyone.permissions.bitfield,
        "Automated 24-hour main-to-vault server sync"
    );

    return { roleMap, created, updated, deleted: extraRoles.length };
}

function mapOverwrites(sourceChannel, sourceGuild, targetGuild, roleMap) {
    return [...sourceChannel.permissionOverwrites.cache.values()].flatMap(overwrite => {
        let id = overwrite.id;
        if (overwrite.type === 0) {
            id = overwrite.id === sourceGuild.id
                ? targetGuild.id
                : roleMap.get(overwrite.id);
            if (!id) {
                const sourceRole = sourceGuild.roles.cache.get(overwrite.id);
                if (sourceRole?.managed) return [];
                throw new Error(
                    `Could not map source role overwrite ${overwrite.id} in #${sourceChannel.name}.`
                );
            }
        }
        return [{
            id,
            type: overwrite.type,
            allow: overwrite.allow.bitfield.toString(),
            deny: overwrite.deny.bitfield.toString()
        }];
    });
}

function mapEmojiId(emojiId, sourceGuild, targetGuild) {
    if (!emojiId) return null;
    const sourceEmoji = sourceGuild.emojis.cache.get(emojiId);
    if (!sourceEmoji) return null;
    return targetGuild.emojis.cache.find(emoji => emoji.name === sourceEmoji.name)?.id || null;
}

function channelOptions(sourceChannel, sourceGuild, targetGuild, roleMap, parentId, includeType) {
    const options = {
        name: sourceChannel.name,
        position: sourceChannel.position,
        permissionOverwrites: mapOverwrites(sourceChannel, sourceGuild, targetGuild, roleMap)
    };
    if (includeType) options.type = sourceChannel.type;
    if (sourceChannel.type !== ChannelType.GuildCategory) options.parent = parentId || null;
    options.reason = "Automated 24-hour main-to-vault server sync";

    if (
        sourceChannel.type === ChannelType.GuildText ||
        sourceChannel.type === ChannelType.GuildAnnouncement ||
        sourceChannel.type === ChannelType.GuildForum ||
        sourceChannel.type === ChannelType.GuildMedia
    ) {
        options.topic = sourceChannel.topic ?? null;
        options.nsfw = sourceChannel.nsfw;
        options.rateLimitPerUser = sourceChannel.rateLimitPerUser;
        options.defaultAutoArchiveDuration = sourceChannel.defaultAutoArchiveDuration;
        options.defaultThreadRateLimitPerUser = sourceChannel.defaultThreadRateLimitPerUser;
    }

    if (sourceChannel.type === ChannelType.GuildVoice || sourceChannel.type === ChannelType.GuildStageVoice) {
        options.bitrate = sourceChannel.bitrate;
        options.userLimit = sourceChannel.userLimit;
        options.rtcRegion = sourceChannel.rtcRegion;
        options.videoQualityMode = sourceChannel.videoQualityMode;
    }

    if (sourceChannel.type === ChannelType.GuildForum || sourceChannel.type === ChannelType.GuildMedia) {
        options.availableTags = sourceChannel.availableTags.map(tag => {
            const sourceEmoji = tag.emoji;
            const mappedId = sourceEmoji?.id
                ? mapEmojiId(sourceEmoji.id, sourceGuild, targetGuild)
                : null;
            return {
                name: tag.name,
                moderated: tag.moderated,
                emoji: sourceEmoji?.id
                    ? (mappedId ? { id: mappedId, name: null } : null)
                    : sourceEmoji?.name
                        ? { id: null, name: sourceEmoji.name }
                        : null
            };
        });
        options.defaultSortOrder = sourceChannel.defaultSortOrder;
        options.defaultForumLayout = sourceChannel.defaultForumLayout;
        const defaultEmoji = sourceChannel.defaultReactionEmoji;
        const mappedDefaultEmojiId = defaultEmoji?.id
            ? mapEmojiId(defaultEmoji.id, sourceGuild, targetGuild)
            : null;
        options.defaultReactionEmoji = defaultEmoji?.id
            ? (mappedDefaultEmojiId ? { id: mappedDefaultEmojiId, name: null } : null)
            : defaultEmoji?.name
                ? { id: null, name: defaultEmoji.name }
                : null;
    }
    return options;
}

function sortedChannels(guild) {
    return [...guild.channels.cache.values()]
        .filter(channel => channel.guild && SUPPORTED_CHANNEL_TYPES.has(channel.type))
        .sort((left, right) => {
            const leftCategory = left.type === ChannelType.GuildCategory ? 0 : 1;
            const rightCategory = right.type === ChannelType.GuildCategory ? 0 : 1;
            return leftCategory - rightCategory || left.position - right.position;
        });
}

function getUnsupportedChannels(guild) {
    return [...guild.channels.cache.values()].filter(
        channel =>
            channel.guild &&
            !SUPPORTED_CHANNEL_TYPES.has(channel.type) &&
            !THREAD_CHANNEL_TYPES.has(channel.type)
    );
}

async function syncChannels(source, target, roleMap) {
    await Promise.all([source.channels.fetch(), target.channels.fetch()]);
    const sourceChannels = sortedChannels(source);
    const targetChannels = sortedChannels(target);
    const unsupported = getUnsupportedChannels(source);
    if (unsupported.length) {
        throw new Error(
            `Unsupported source channel types prevent an exact sync: ${unsupported.map(channel => `${channel.name} (${channel.type})`).join(", ")}`
        );
    }

    const targetChannelIndex = indexByIdentity(
        targetChannels,
        channel => channelIdentity(
            channel,
            channel.parentId ? target.channels.cache.get(channel.parentId)?.name || "" : ""
        )
    );
    const channelMap = new Map();
    const retainedTargetIds = new Set();
    let created = 0;
    let updated = 0;

    for (const sourceChannel of sourceChannels) {
        const parentName = sourceChannel.parentId
            ? source.channels.cache.get(sourceChannel.parentId)?.name || ""
            : "";
        const identity = channelIdentity(sourceChannel, parentName);
        let targetChannel = takeByIdentity(targetChannelIndex, identity);
        const targetParentId = sourceChannel.parentId
            ? channelMap.get(sourceChannel.parentId)
            : undefined;
        const options = channelOptions(
            sourceChannel,
            source,
            target,
            roleMap,
            targetParentId,
            !targetChannel
        );

        if (targetChannel) {
            await targetChannel.edit(options);
            updated++;
        } else {
            targetChannel = await target.channels.create({
                ...options,
                reason: "Automated 24-hour main-to-vault server sync"
            });
            created++;
        }
        channelMap.set(sourceChannel.id, targetChannel.id);
        retainedTargetIds.add(targetChannel.id);
    }

    const extraChannels = targetChannels
        .filter(channel => !retainedTargetIds.has(channel.id))
        .sort((left, right) => {
            const leftCategory = left.type === ChannelType.GuildCategory ? 1 : 0;
            const rightCategory = right.type === ChannelType.GuildCategory ? 1 : 0;
            return leftCategory - rightCategory;
        });
    for (const channel of extraChannels) {
        await channel.delete("Automated 24-hour main-to-vault server sync");
    }

    return { channelMap, created, updated, deleted: extraChannels.length };
}

async function performFullMirror(client) {
    const source = await getGuild(client, configManager.getMainGuildId());
    const target = await getGuild(client, configManager.getVaultGuildId());
    await Promise.all([
        source.roles.fetch(),
        target.roles.fetch(),
        source.channels.fetch(),
        target.channels.fetch(),
        source.emojis.fetch(),
        target.emojis.fetch()
    ]);
    const unsupported = [
        ...getUnsupportedChannels(source).map(channel => `Main: ${channel.name} (${channel.type})`),
        ...getUnsupportedChannels(target).map(channel => `Vault: ${channel.name} (${channel.type})`)
    ];
    if (unsupported.length) {
        throw new Error(
            `Unsupported channel types prevent an exact sync: ${unsupported.join(", ")}`
        );
    }
    const roles = await syncRoles(source, target);
    const channels = await syncChannels(source, target, roles.roleMap);
    const syncedAt = new Date().toISOString();
    configManager.updateVaultConfigIds(
        roles.roleMap,
        channels.channelMap,
        client.config,
        syncedAt
    );
    saveState({ lastSuccessfulSyncAt: syncedAt });
    scheduleNext(client);
    console.log(
        `[server-sync] completed at ${syncedAt}: ` +
        `roles +${roles.created}/~${roles.updated}/-${roles.deleted}, ` +
        `channels +${channels.created}/~${channels.updated}/-${channels.deleted}.`
    );
}

async function runSync(client, options = {}) {
    if (activeSync) {
        console.warn("[server-sync] a sync is already running; skipping this request.");
        return;
    }

    activeSync = true;
    try {
        const source = await getGuild(client, configManager.getMainGuildId());
        if (!options.bypassCircuitBreaker) {
            let changes;
            try {
                changes = await getRecentChanges(source);
            } catch (error) {
                await alertForApproval(
                    client,
                    `Could not verify the Main server's audit log for the last 24 hours: ${error.message}`
                );
                return;
            }

            if (getTriggeredThresholds(changes).length) {
                await alertForApproval(
                    client,
                    "The Main server crossed a deletion/creation circuit-breaker threshold. No changes were applied.",
                    changes
                );
                return;
            }
        }
        await performFullMirror(client);
    } catch (error) {
        console.error("[server-sync] full mirror failed:", error);
        await notifySyncFailure(client, error);
    } finally {
        activeSync = false;
    }
}

function scheduleNext(client, delay = SYNC_INTERVAL_MS) {
    if (scheduleTimer) clearTimeout(scheduleTimer);
    scheduleTimer = setTimeout(async () => {
        await runSync(client);
        scheduleNext(client);
    }, Math.max(0, delay));
    scheduleTimer.unref?.();
}

function hasVaultConfigBeenSynchronized() {
    const vaultConfigPath = path.join(__dirname, "..", "vault-config.json");
    try {
        const vaultConfig = JSON.parse(fs.readFileSync(vaultConfigPath, "utf8"));
        return typeof vaultConfig.serverSync?.lastSynchronizedAt === "string"
            && Number.isFinite(Date.parse(vaultConfig.serverSync.lastSynchronizedAt));
    } catch (error) {
        throw new Error(`Could not check Vault config sync status: ${error.message}`);
    }
}

async function start(client) {
    if (scheduleTimer) return;
    let syncState;
    try {
        syncState = readState();
    } catch (error) {
        console.error("[server-sync] scheduler could not read sync state:", error);
        syncState = {};
    }

    const lastSuccess = Date.parse(syncState.lastSuccessfulSyncAt || "");
    if (!Number.isFinite(lastSuccess) || !hasVaultConfigBeenSynchronized()) {
        await runSync(client);
        scheduleNext(client);
        return;
    }

    scheduleNext(client, lastSuccess + SYNC_INTERVAL_MS - Date.now());
}

module.exports = {
    start,
    runSync,
    handleInteraction,
    getRecentChanges,
    getTriggeredThresholds,
    getUnsupportedChannels,
    THRESHOLDS
};
