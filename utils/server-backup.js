const {
    AttachmentBuilder,
    ChannelType,
    PermissionFlagsBits
} = require("discord.js");

const BACKUP_FORMAT = "northgate-server-config";
const BACKUP_VERSION = 1;
const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
const SUPPORTED_CHANNEL_TYPES = new Set([
    ChannelType.GuildText,
    ChannelType.GuildVoice,
    ChannelType.GuildCategory,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildStageVoice,
    ChannelType.GuildForum,
    ChannelType.GuildMedia
]);
const TEXT_CHANNEL_TYPES = new Set([
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildForum,
    ChannelType.GuildMedia
]);
const VOICE_CHANNEL_TYPES = new Set([
    ChannelType.GuildVoice,
    ChannelType.GuildStageVoice
]);

function serializeOverwrite(overwrite) {
    return {
        id: overwrite.id,
        type: overwrite.type,
        allow: overwrite.allow.bitfield.toString(),
        deny: overwrite.deny.bitfield.toString()
    };
}

function serializeRole(role) {
    return {
        id: role.id,
        name: role.name,
        color: role.color,
        hoist: role.hoist,
        position: role.position,
        permissions: role.permissions.bitfield.toString(),
        mentionable: role.mentionable,
        managed: role.managed,
        unicodeEmoji: role.unicodeEmoji
    };
}

function serializeChannel(channel) {
    const record = {
        id: channel.id,
        name: channel.name,
        type: channel.type,
        parentId: channel.parentId,
        position: channel.position,
        permissionOverwrites: [...channel.permissionOverwrites.cache.values()].map(serializeOverwrite)
    };
    const properties = [
        "topic",
        "nsfw",
        "rateLimitPerUser",
        "bitrate",
        "userLimit",
        "rtcRegion",
        "videoQualityMode",
        "defaultAutoArchiveDuration",
        "defaultThreadRateLimitPerUser",
        "defaultSortOrder",
        "defaultForumLayout"
    ];

    for (const property of properties) {
        if (property in channel) record[property] = channel[property];
    }

    if (Array.isArray(channel.availableTags)) {
        record.availableTags = channel.availableTags.map(tag => ({
            name: tag.name,
            moderated: tag.moderated,
            emoji: tag.emoji
                ? { id: tag.emoji.id, name: tag.emoji.name }
                : null
        }));
    }
    if ("defaultReactionEmoji" in channel) {
        record.defaultReactionEmoji = channel.defaultReactionEmoji
            ? {
                id: channel.defaultReactionEmoji.id,
                name: channel.defaultReactionEmoji.name
            }
            : null;
    }

    return record;
}

function serializeGuildSettings(guild) {
    const settings = {
        name: guild.name,
        verificationLevel: guild.verificationLevel,
        defaultMessageNotifications: guild.defaultMessageNotifications,
        explicitContentFilter: guild.explicitContentFilter,
        afkChannelId: guild.afkChannelId,
        afkTimeout: guild.afkTimeout,
        systemChannelId: guild.systemChannelId,
        rulesChannelId: guild.rulesChannelId,
        publicUpdatesChannelId: guild.publicUpdatesChannelId,
        preferredLocale: guild.preferredLocale,
        description: guild.description,
        premiumProgressBarEnabled: guild.premiumProgressBarEnabled
    };
    if (guild.systemChannelFlags) {
        settings.systemChannelFlags = guild.systemChannelFlags.bitfield.toString();
    }
    if (guild.safetyAlertsChannelId !== undefined) {
        settings.safetyAlertsChannelId = guild.safetyAlertsChannelId;
    }
    return settings;
}

async function createServerBackup(guild, client, channelId) {
    if (!/^\d{17,20}$/.test(String(channelId || ""))) {
        throw new Error("The DEFCON backup channel ID is missing or invalid.");
    }

    const backupChannel = await client.channels.fetch(channelId).catch(error => {
        throw new Error(`Could not fetch the configured backup channel: ${error.message}`);
    });
    if (
        ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(backupChannel?.type) ||
        typeof backupChannel.send !== "function" ||
        backupChannel.guildId !== guild.id
    ) {
        throw new Error("The configured backup destination must be a text channel in this server.");
    }

    const botMember = guild.members.me || await guild.members.fetchMe();
    const channelPermissions = backupChannel.permissionsFor(botMember);
    if (!channelPermissions?.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AttachFiles
    ])) {
        throw new Error("The bot needs View Channel, Send Messages, and Attach Files in the backup channel.");
    }

    await Promise.all([guild.roles.fetch(), guild.channels.fetch()]);

    const channelRecords = [];
    const unsupportedChannels = [];
    let excludedThreadCount = 0;
    for (const channel of guild.channels.cache.values()) {
        if (channel.isThread?.()) {
            excludedThreadCount++;
            continue;
        }
        if (!SUPPORTED_CHANNEL_TYPES.has(channel.type)) {
            unsupportedChannels.push({ id: channel.id, type: channel.type });
            continue;
        }
        channelRecords.push(serializeChannel(channel));
    }

    const backup = {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        guildId: guild.id,
        createdAt: new Date().toISOString(),
        guildSettings: serializeGuildSettings(guild),
        roles: [...guild.roles.cache.values()].map(serializeRole),
        channels: channelRecords,
        unsupportedChannels,
        excludedThreadCount
    };
    const json = Buffer.from(JSON.stringify(backup, null, 2), "utf8");
    if (json.length > MAX_BACKUP_BYTES) {
        throw new Error("The server configuration backup exceeds the 20 MB attachment limit.");
    }

    const filename = `northgate-server-backup-${backup.createdAt.replace(/[:.]/g, "-")}.json`;
    const backupMessage = await backupChannel.send({
        content: [
            `DEFCON 1 server configuration backup for **${guild.name}**.`,
            `Roles: ${backup.roles.length} • Channels: ${backup.channels.length}.`,
            `Threads excluded: ${excludedThreadCount}. Messages and member lists are not included.`
        ].join("\n"),
        files: [new AttachmentBuilder(json, { name: filename })],
        allowedMentions: { parse: [] }
    });

    return {
        filename,
        url: backupMessage.url,
        roleCount: backup.roles.length,
        channelCount: backup.channels.length,
        unsupportedChannelCount: unsupportedChannels.length,
        excludedThreadCount
    };
}

function isSnowflake(value) {
    return typeof value === "string" && /^\d{17,20}$/.test(value);
}

function validateServerBackup(backup, guild) {
    if (!backup || typeof backup !== "object" || Array.isArray(backup)) {
        throw new Error("The selected file is not a valid server backup.");
    }
    if (backup.format !== BACKUP_FORMAT || backup.version !== BACKUP_VERSION) {
        throw new Error("This server backup format or version is not supported.");
    }
    if (backup.guildId !== guild.id) {
        throw new Error("This backup belongs to a different server.");
    }
    if (
        !Array.isArray(backup.roles) ||
        backup.roles.length > 250 ||
        !Array.isArray(backup.channels) ||
        backup.channels.length > 500 ||
        !backup.guildSettings ||
        typeof backup.guildSettings !== "object" ||
        !Array.isArray(backup.unsupportedChannels || []) ||
        (backup.unsupportedChannels || []).length > 500 ||
        !Number.isInteger(backup.excludedThreadCount || 0) ||
        backup.excludedThreadCount < 0 ||
        backup.excludedThreadCount > 10_000
    ) {
        throw new Error("The backup is missing required server configuration data.");
    }

    const settings = backup.guildSettings;
    if (
        typeof settings.name !== "string" ||
        settings.name.length > 100 ||
        !Number.isInteger(settings.verificationLevel) ||
        settings.verificationLevel < 0 ||
        settings.verificationLevel > 4 ||
        !Number.isInteger(settings.defaultMessageNotifications) ||
        settings.defaultMessageNotifications < 0 ||
        settings.defaultMessageNotifications > 1 ||
        !Number.isInteger(settings.explicitContentFilter) ||
        settings.explicitContentFilter < 0 ||
        settings.explicitContentFilter > 2 ||
        ![60, 300, 900, 1800, 3600].includes(settings.afkTimeout) ||
        typeof settings.preferredLocale !== "string" ||
        settings.preferredLocale.length > 20 ||
        (settings.description !== null && typeof settings.description !== "string") ||
        (settings.description?.length > 120) ||
        typeof settings.premiumProgressBarEnabled !== "boolean"
    ) {
        throw new Error("The backup contains invalid server settings.");
    }
    for (const field of [
        "afkChannelId",
        "systemChannelId",
        "rulesChannelId",
        "publicUpdatesChannelId",
        "safetyAlertsChannelId"
    ]) {
        if (settings[field] !== undefined && settings[field] !== null && !isSnowflake(settings[field])) {
            throw new Error(`The backup contains an invalid ${field} reference.`);
        }
    }
    if (
        settings.systemChannelFlags !== undefined &&
        (typeof settings.systemChannelFlags !== "string" || !/^\d{1,30}$/.test(settings.systemChannelFlags))
    ) {
        throw new Error("The backup contains invalid system-channel flags.");
    }

    const roleIds = new Set();
    for (const role of backup.roles) {
        if (
            !role ||
            !isSnowflake(role.id) ||
            roleIds.has(role.id) ||
            typeof role.name !== "string" ||
            role.name.length > 100 ||
            typeof role.permissions !== "string" ||
            !/^\d{1,30}$/.test(role.permissions) ||
            !Number.isInteger(role.position) ||
            !Number.isInteger(role.color) ||
            role.color < 0 ||
            role.color > 0xffffff ||
            typeof role.hoist !== "boolean" ||
            typeof role.mentionable !== "boolean" ||
            typeof role.managed !== "boolean" ||
            (role.unicodeEmoji !== undefined && role.unicodeEmoji !== null && typeof role.unicodeEmoji !== "string")
        ) {
            throw new Error("The backup contains an invalid role record.");
        }
        roleIds.add(role.id);
    }
    if (!backup.roles.some(role => role.id === guild.id)) {
        throw new Error("The backup is missing the server's @everyone role.");
    }

    const channelIds = new Set();
    for (const channel of backup.channels) {
        if (
            !channel ||
            !isSnowflake(channel.id) ||
            channelIds.has(channel.id) ||
            typeof channel.name !== "string" ||
            channel.name.length > 100 ||
            !SUPPORTED_CHANNEL_TYPES.has(channel.type) ||
            !Number.isInteger(channel.position) ||
            (channel.parentId !== null && !isSnowflake(channel.parentId)) ||
            !Array.isArray(channel.permissionOverwrites) ||
            channel.permissionOverwrites.length > 100
        ) {
            throw new Error("The backup contains an invalid or unsupported channel record.");
        }
        channelIds.add(channel.id);
        for (const overwrite of channel.permissionOverwrites) {
            if (
                !overwrite ||
                !isSnowflake(overwrite.id) ||
                ![0, 1].includes(overwrite.type) ||
                typeof overwrite.allow !== "string" ||
                !/^\d{1,30}$/.test(overwrite.allow) ||
                typeof overwrite.deny !== "string" ||
                !/^\d{1,30}$/.test(overwrite.deny)
            ) {
                throw new Error("The backup contains an invalid permission overwrite.");
            }
        }
    }

    for (const channel of backup.unsupportedChannels || []) {
        if (!channel || !isSnowflake(channel.id) || !Number.isInteger(channel.type)) {
            throw new Error("The backup contains invalid unsupported-channel metadata.");
        }
    }

    return backup;
}

async function downloadServerBackup(attachment, guild) {
    if (!attachment || !attachment.name?.toLowerCase().endsWith(".json")) {
        throw new Error("Attach a `.json` server backup file.");
    }
    if (attachment.size > MAX_BACKUP_BYTES) {
        throw new Error("The attached backup exceeds the 20 MB limit.");
    }

    const url = new URL(attachment.url);
    if (
        url.protocol !== "https:" ||
        !["cdn.discordapp.com", "media.discordapp.net"].includes(url.hostname)
    ) {
        throw new Error("The attached file must be hosted by Discord.");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let response;
    try {
        response = await fetch(url, { signal: controller.signal, redirect: "error" });
    } finally {
        clearTimeout(timeout);
    }
    if (!response.ok) {
        throw new Error(`Could not download the attached backup (HTTP ${response.status}).`);
    }
    const finalUrl = new URL(response.url);
    if (
        finalUrl.protocol !== "https:" ||
        !["cdn.discordapp.com", "media.discordapp.net"].includes(finalUrl.hostname)
    ) {
        throw new Error("The backup download redirected outside Discord's file hosts.");
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_BACKUP_BYTES) {
        throw new Error("The downloaded backup exceeds the 20 MB limit.");
    }

    let backup;
    try {
        backup = JSON.parse(bytes.toString("utf8"));
    } catch (error) {
        throw new Error(`The attached backup is not valid JSON: ${error.message}`);
    }
    return validateServerBackup(backup, guild);
}

function mapPermissionOverwrites(overwrites, roleIds, warnings) {
    const mapped = [];
    const seen = new Set();
    for (const overwrite of overwrites) {
        const id = overwrite.type === 0
            ? roleIds.get(overwrite.id)
            : overwrite.id;
        if (!id) {
            warnings.push(`Skipped an overwrite for missing role ${overwrite.id}.`);
            continue;
        }
        if (seen.has(id)) continue;
        seen.add(id);
        mapped.push({
            id,
            type: overwrite.type,
            allow: BigInt(overwrite.allow),
            deny: BigInt(overwrite.deny)
        });
    }
    return mapped;
}

function channelEditOptions(record, parentId, overwrites) {
    const options = {
        name: record.name,
        position: record.position,
        permissionOverwrites: overwrites
    };
    if (record.type !== ChannelType.GuildCategory) options.parent = parentId || null;

    const properties = record.type === ChannelType.GuildCategory
        ? []
        : TEXT_CHANNEL_TYPES.has(record.type)
            ? [
                "topic",
                "nsfw",
                "rateLimitPerUser",
                "defaultAutoArchiveDuration",
                "defaultThreadRateLimitPerUser",
                "availableTags",
                "defaultReactionEmoji",
                "defaultSortOrder",
                "defaultForumLayout"
            ]
            : VOICE_CHANNEL_TYPES.has(record.type)
                ? ["nsfw", "bitrate", "userLimit", "rtcRegion", "videoQualityMode"]
                : [];
    for (const property of properties) {
        if (property in record) options[property] = record[property];
    }
    return options;
}

async function restoreRoles(guild, backup, warnings) {
    const rolesById = await guild.roles.fetch();
    const roleIds = new Map([[backup.guildId, guild.id]]);
    const createdIds = new Set();
    const updatedIds = new Set();
    const roleRecords = [...backup.roles].sort((a, b) => a.position - b.position);

    for (const record of roleRecords) {
        if (record.id === backup.guildId) {
            roleIds.set(record.id, guild.id);
            await guild.roles.everyone.edit({
                permissions: BigInt(record.permissions),
                reason: "Restore NorthGate server configuration backup"
            });
            continue;
        }

        let role = rolesById.get(record.id);
        if (!role) {
            const sameName = [...rolesById.values()].filter(candidate =>
                candidate.name === record.name &&
                !candidate.managed &&
                candidate.id !== guild.id
            );
            if (sameName.length === 1) role = sameName[0];
        }
        if (record.managed) {
            if (!role) warnings.push(`Managed role "${record.name}" no longer exists and cannot be recreated.`);
            else roleIds.set(record.id, role.id);
            continue;
        }

        const options = {
            name: record.name,
            color: record.color,
            hoist: record.hoist,
            permissions: BigInt(record.permissions),
            mentionable: record.mentionable
        };
        if (record.unicodeEmoji !== undefined) options.unicodeEmoji = record.unicodeEmoji;

        if (!role) {
            role = await guild.roles.create({
                ...options,
                reason: "Restore NorthGate server configuration backup"
            });
            rolesById.set(role.id, role);
            createdIds.add(role.id);
        } else {
            if (role.managed) {
                warnings.push(`Managed role "${record.name}" could not be edited.`);
                roleIds.set(record.id, role.id);
                continue;
            }
            if (!role.editable) {
                warnings.push(`Role "${record.name}" is above the bot's role and could not be edited.`);
                roleIds.set(record.id, role.id);
                continue;
            }
            role = await role.edit({
                ...options,
                reason: "Restore NorthGate server configuration backup"
            });
            rolesById.set(role.id, role);
            updatedIds.add(role.id);
        }
        roleIds.set(record.id, role.id);
    }

    const positionUpdates = [];
    for (const record of roleRecords) {
        const roleId = roleIds.get(record.id);
        if (!roleId || roleId === guild.id) continue;
        const role = rolesById.get(roleId);
        if (role?.editable) positionUpdates.push({ role: roleId, position: record.position });
    }
    if (positionUpdates.length) await guild.roles.setPositions(positionUpdates);

    return {
        roleIds,
        createdCount: createdIds.size,
        updatedCount: updatedIds.size
    };
}

async function restoreChannels(guild, backup, roleIds, warnings) {
    const channelIds = new Map([[backup.guildId, guild.id]]);
    const currentChannels = await guild.channels.fetch();
    const createdIds = new Set();
    const updatedIds = new Set();
    const records = [...backup.channels].sort((a, b) =>
        Number(b.type === ChannelType.GuildCategory) - Number(a.type === ChannelType.GuildCategory) ||
        a.position - b.position
    );

    for (const record of records) {
        const parentId = record.parentId ? channelIds.get(record.parentId) : null;
        if (record.parentId && !parentId) {
            warnings.push(`Channel "${record.name}" has a category that could not be restored.`);
        }
        const overwrites = mapPermissionOverwrites(record.permissionOverwrites, roleIds, warnings);
        let channel = currentChannels.get(record.id);
        if (channel?.type !== record.type) channel = null;
        if (!channel) {
            const matching = [...currentChannels.values()].filter(candidate =>
                !candidate.isThread?.() &&
                candidate.type === record.type &&
                candidate.name === record.name &&
                candidate.parentId === parentId
            );
            if (matching.length === 1) channel = matching[0];
        }

        const options = channelEditOptions(record, parentId, overwrites);
        if (!channel) {
            channel = await guild.channels.create({
                ...options,
                type: record.type,
                reason: "Restore NorthGate server configuration backup"
            });
            currentChannels.set(channel.id, channel);
            createdIds.add(channel.id);
        } else {
            channel = await channel.edit({
                ...options,
                reason: "Restore NorthGate server configuration backup"
            });
            updatedIds.add(channel.id);
        }
        channelIds.set(record.id, channel.id);
    }

    return {
        channelIds,
        createdCount: createdIds.size,
        updatedCount: updatedIds.size
    };
}

async function restoreGuildSettings(guild, settings, channelIds, warnings) {
    const options = {};
    for (const property of [
        "name",
        "verificationLevel",
        "defaultMessageNotifications",
        "explicitContentFilter",
        "afkTimeout",
        "preferredLocale",
        "description",
        "premiumProgressBarEnabled"
    ]) {
        if (property in settings) options[property] = settings[property];
    }

    for (const [source, target] of [
        ["afkChannelId", "afkChannel"],
        ["systemChannelId", "systemChannel"],
        ["rulesChannelId", "rulesChannel"],
        ["publicUpdatesChannelId", "publicUpdatesChannel"],
        ["safetyAlertsChannelId", "safetyAlertsChannel"]
    ]) {
        if (source in settings) {
            options[target] = settings[source] ? channelIds.get(settings[source]) || null : null;
            if (settings[source] && !channelIds.has(settings[source])) {
                warnings.push(`Server setting "${source}" referenced a channel that could not be restored.`);
            }
        }
    }
    if (settings.systemChannelFlags !== undefined) {
        options.systemChannelFlags = BigInt(settings.systemChannelFlags);
    }

    if (Object.keys(options).length) {
        await guild.edit({
            ...options,
            reason: "Restore NorthGate server configuration backup"
        });
    }
}

async function restoreServerBackup(guild, backup) {
    const warnings = [];
    if (backup.excludedThreadCount) {
        warnings.push(`${backup.excludedThreadCount} thread(s) are not included in server configuration backups.`);
    }
    if (backup.unsupportedChannels?.length) {
        warnings.push(`${backup.unsupportedChannels.length} unsupported channel(s) were not included.`);
    }
    await Promise.all([guild.roles.fetch(), guild.channels.fetch(), guild.members.fetchMe()]);
    const roleResult = await restoreRoles(guild, backup, warnings);
    const channelResult = await restoreChannels(guild, backup, roleResult.roleIds, warnings);
    await restoreGuildSettings(guild, backup.guildSettings, channelResult.channelIds, warnings);

    return {
        roleCreatedCount: roleResult.createdCount,
        roleUpdatedCount: roleResult.updatedCount,
        channelCreatedCount: channelResult.createdCount,
        channelUpdatedCount: channelResult.updatedCount,
        warnings
    };
}

module.exports = {
    BACKUP_FORMAT,
    BACKUP_VERSION,
    MAX_BACKUP_BYTES,
    createServerBackup,
    downloadServerBackup,
    restoreServerBackup,
    validateServerBackup
};
