const ticketTopic = require("../ticket-topic");

const CHECK_INTERVAL_MS = 60 * 1000;
const INACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;
const TICKET_PREFIXES = ["support-", "appeal-", "commission-", "hiring-", "partnership-"];
const lastPingByKey = new Map();
let autoPingInterval = null;

function isTicketChannel(channelName) {
    return TICKET_PREFIXES.some(prefix => channelName?.startsWith(prefix));
}

function isStaffMember(member, config) {
    if (!member || !config?.staffrole) return false;

    return member.roles?.cache?.has(String(config.staffrole));
}

function shouldPing(channelId, reason) {
    const now = Date.now();
    const key = `${channelId}:${reason}`;
    const last = lastPingByKey.get(key) || 0;

    if (now - last >= INACTIVE_WINDOW_MS) {
        lastPingByKey.set(key, now);
        return true;
    }

    return false;
}

async function getInitialRoleMentions(channel, config) {
    const fallbackIds = config.staffrole ? [String(config.staffrole)] : [];

    try {
        const messages = await channel.messages.fetch({ limit: 50 });
        const ordered = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

        for (const message of ordered) {
            const mentionedRoleIds = [...new Set([
                ...message.mentions.roles.keys(),
                ...[...message.content.matchAll(/<@&(\d+)>/g)].map(match => match[1])
            ])];

            if (mentionedRoleIds.length > 0) return mentionedRoleIds;
        }
    } catch {
        // Ignore message fetch issues and fall back to configured role IDs.
    }

    return [...new Set(fallbackIds.map(String))];
}

async function sendPing(channel, content, roleIds = []) {
    if (!channel || !content) return;

    try {
        await channel.send({
            content: roleIds.length > 0 ? `${roleIds.map(id => `<@&${id}>`).join(" ")} ${content}` : content,
            allowedMentions: roleIds.length > 0 ? { roles: roleIds } : { parse: [] }
        });
    } catch (err) {
        console.error(`[autoping] failed to send ping in ${channel.name}:`, err.message);
    }
}

async function checkTicketChannel(channel, client, config) {
    if (!channel || !isTicketChannel(channel.name)) return;

    const state = ticketTopic.parse(channel.topic);
    const ownerId = state.ownerId;
    const claimedBy = state.claimedBy;

    if (!ownerId) return;

    const guild = channel.guild;
    const currentTime = Date.now();

    const messages = await channel.messages.fetch({ limit: 200 }).catch(() => new Map());
    const sorted = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    const lastStaffMessage = [...sorted].reverse().find(msg =>
        !msg.author.bot &&
        isStaffMember(guild.members.cache.get(msg.author.id) || null, config)
    ) || null;

    const lastClaimedMessage = claimedBy
        ? sorted.find(msg => msg.author.id === claimedBy) || null
        : null;

    const lastClientMessage = sorted.find(msg => msg.author.id === ownerId) || null;

    const noStaffReplySinceOpen = !lastStaffMessage && (currentTime - channel.createdTimestamp) >= INACTIVE_WINDOW_MS;
    const staffReplyOldEnough = !!lastStaffMessage && (currentTime - lastStaffMessage.createdTimestamp) >= INACTIVE_WINDOW_MS;

    if (noStaffReplySinceOpen || staffReplyOldEnough) {
        const roleIds = await getInitialRoleMentions(channel, config);
        if (roleIds.length > 0 && shouldPing(channel.id, "staff-role-ping")) {
            await sendPing(
                channel,
                "This ticket has been inactive for 24 hours without a staff reply. Please check in.",
                roleIds
            );
        }
        return;
    }

    if (claimedBy) {
        const claimedInactive = !lastClaimedMessage
            ? (currentTime - channel.createdTimestamp) >= INACTIVE_WINDOW_MS
            : (currentTime - lastClaimedMessage.createdTimestamp) >= INACTIVE_WINDOW_MS;

        if (claimedInactive && shouldPing(channel.id, `claimed:${claimedBy}`)) {
            await sendPing(channel, `This ticket has been inactive for 24 hours. Please respond.`, [claimedBy]);
            return;
        }

        const clientInactive = !lastClientMessage
            ? (currentTime - channel.createdTimestamp) >= INACTIVE_WINDOW_MS
            : (currentTime - lastClientMessage.createdTimestamp) >= INACTIVE_WINDOW_MS;

        if (clientInactive && shouldPing(channel.id, `client:${ownerId}`)) {
            await sendPing(channel, "This ticket has been inactive for 24 hours. Please respond.", [ownerId]);
        }
    }
}

async function checkAll(client, config) {
    if (!client || !client.guilds) return;

    for (const guild of client.guilds.cache.values()) {
        for (const channel of guild.channels.cache.values()) {
            if (!isTicketChannel(channel.name)) continue;
            try {
                await checkTicketChannel(channel, client, config);
            } catch (err) {
                console.error(`[autoping] error checking ${channel.name}:`, err.message);
            }
        }
    }
}

function start(client, config) {
    if (autoPingInterval) return;

    autoPingInterval = setInterval(() => {
        checkAll(client, config).catch(err => {
            console.error("[autoping] interval error:", err.message);
        });
    }, CHECK_INTERVAL_MS);
}

function stop() {
    if (autoPingInterval) {
        clearInterval(autoPingInterval);
        autoPingInterval = null;
    }
}

module.exports = { start, stop, checkAll };
