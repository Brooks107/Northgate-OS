const { AttachmentBuilder } = require("discord.js");
const { logCommand } = require("../utils/command-logger");
const state = require("../state");
const ticketTracker = require("../ticket-tracker");

async function saveTranscript(channel, closedBy, config) {
    try {
        const all = [];
        let lastId = null;

        while (true) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;

            const batch = await channel.messages.fetch(options);
            if (batch.size === 0) break;

            all.push(...batch.values());
            lastId = batch.last().id;
        }

        const messages = all.reverse();
        const lines = [];
        lines.push(`Transcript for #${channel.name}`);
        lines.push(`Closed by: ${closedBy.tag}`);
        lines.push(`Saved: ${new Date().toLocaleString()}`);
        lines.push(`Messages: ${messages.length}`);
        lines.push("=".repeat(50));
        lines.push("");

        for (const msg of messages) {
            const time = msg.createdAt.toLocaleString();
            lines.push(`[${time}] ${msg.author.tag}: ${msg.content || "(no text)"}`);

            for (const att of msg.attachments.values()) {
                lines.push(`    [file] ${att.name}: ${att.url}`);
            }
            for (const emb of msg.embeds) {
                lines.push(`    [embed] ${emb.title || ""} ${emb.description || ""}`);
            }
        }

        const file = new AttachmentBuilder(Buffer.from(lines.join("\n"), "utf-8"), {
            name: `${channel.name}-transcript.txt`
        });

        const transcriptChannelId = config?.channels?.transcriptschannelid || config?.transcriptschannelid;
        const logChannel = transcriptChannelId
            ? await channel.guild.channels.fetch(transcriptChannelId).catch(() => null)
            : null;

        if (!logChannel) {
            console.error("[devhandler] transcript failed: transcriptschannelid is wrong or the bot cannot see that channel.");
            return;
        }

        await logChannel.send({
            content: `📄 Transcript for **${channel.name}** (closed by ${closedBy.tag})`,
            files: [file],
            allowedMentions: { parse: [] }
        });
    } catch (err) {
        console.error("[devhandler] transcript failed:", err);
    }
}

module.exports = async function handleDeveloperCommand(message, config) {
    if (message.author.bot || !message.content.startsWith("d!")) return false;

    const args = message.content.slice(2).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();
    if (!["forceclose", "impersonate", "power"].includes(command)) return false;

    await logCommand(message, config, `d!${command}`, "Developer command", args);

    const isDeveloper = config.developers?.includes(message.author.id);
    const ownershipRoles = Array.isArray(config.ownershiprole)
        ? config.ownershiprole
        : [config.ownershiprole].filter(Boolean);
    const isOwner = ownershipRoles.some(roleId =>
        message.member?.roles?.cache?.has(roleId)
    );
    const powerAction = command === "power" ? args.shift()?.toLowerCase() : null;

    if (command === "power") {
        const canUsePower = isDeveloper || (powerAction === "off" && isOwner);

        if (!canUsePower) {
            await message.reply(
                powerAction === "on"
                    ? "❌ Only developers can turn the bot back on."
                    : "❌ Only developers or ownership can turn the bot off."
            );
            return true;
        }
    } else if (!isDeveloper) {
        await message.reply("❌ This command is developer only - Please contact a member of the IT team to have them run it");
        return true;
    }

    if (command === "impersonate") {
        const target = args.shift();
        const targetCommand = args.shift()?.toLowerCase();
        const targetId = target?.match(/^<@!?(\d+)>$/)?.[1] || target;

        if (!/^\d{17,20}$/.test(targetId || "") || !targetCommand) {
            await message.reply("❌ Usage: `d!impersonate <user ID or mention> <command>`");
            return true;
        }

        const guild = await message.client.guilds.fetch(config.guildId).catch(() => null);
        const member = guild ? await guild.members.fetch(targetId).catch(() => null) : null;

        if (!member) {
            await message.reply("❌ That user could not be found in the configured server.");
            return true;
        }

        const hasAnyRole = roleIds => {
            const ids = Array.isArray(roleIds) ? roleIds : [roleIds];
            return ids.filter(Boolean).some(roleId => member.roles.cache.has(roleId));
        };
        const ownershipRoles = Array.isArray(config.ownershiprole)
            ? config.ownershiprole
            : [config.ownershiprole].filter(Boolean);
        const access = {
            Developer: config.developers?.includes(targetId),
            Owner: hasAnyRole(ownershipRoles),
            "Support team": hasAnyRole(config.supportTeamRoles),
            "Commission access": hasAnyRole(config.commissionticketaccess),
            "Hiring access": hasAnyRole(config.hiringticketaccess),
            "Partnership access": hasAnyRole(config.partnershipticketaccess),
            "General ticket access": hasAnyRole(config.generalticketaccess)
        };

        const accessLines = Object.entries(access)
            .map(([label, allowed]) => `${allowed ? "✅" : "❌"} ${label}`)
            .join("\n");

        await message.reply([
            `🔎 Permission preview for **${member.user.tag}** running \`${targetCommand}\``,
            "",
            accessLines,
            "",
            "No command was executed."
        ].join("\n"));
        return true;
    }

    if (command === "power") {
        const action = powerAction;

        if (!["off", "on", "status"].includes(action)) {
            await message.reply("❌ Usage: `d!power <off|on|status>`");
            return true;
        }

        if (action === "status") {
            await message.reply(
                config.maintenanceMode
                    ? "🔴 Power mode: **off** (invisible maintenance mode)."
                    : "🟢 Power mode: **on**."
            );
            return true;
        }

        const maintenanceMode = action === "off";
        config.maintenanceMode = maintenanceMode;
        const saved = state.save({ maintenanceMode });

        message.client.user.setPresence({
            status: maintenanceMode ? "invisible" : "online",
            activities: []
        });

        await message.reply(
            maintenanceMode
                ? `🔴 Bot set to **invisible maintenance mode**.${saved ? "" : "\n⚠️ Could not save this state to disk."}`
                : `🟢 Bot is **online** again.${saved ? "" : "\n⚠️ Could not save this state to disk."}`
        );
        return true;
    }

    if (command === "forceclose") {
        if (!config.developers?.includes(message.author.id)) {
            await message.reply("❌ This command is restricted to developers only.");
            return true;
        }

        const channel = message.channel;
        const ticketCategoryIds = new Set([
            config.generalticketcategory,
            config.appealsticketcategory,
            config.commissionsticketcategory,
            config.hiringticketcategory,
            config.partnershipticketcategory
        ].filter(Boolean));

        const isTicketChannel =
            Boolean(channel) &&
            (
                channel.name.match(/^(?:support|appeal|commission|hiring|partnership)-(\d+)(?:-|$)/) ||
                (channel.parentId && ticketCategoryIds.has(channel.parentId))
            );

        if (!isTicketChannel) {
            await message.reply("❌ d!forceclose must be used inside a ticket channel.");
            return true;
        }

        const match = channel.name.match(/^(?:support|appeal|commission|hiring|partnership)-(\d+)(?:-|$)/);
        const id = match ? Number(match[1]) : null;
        if (id !== null && message.client?.activeTicketIds) {
            message.client.activeTicketIds.delete(id);
        }

        await message.reply("🔒 Force closing ticket and saving transcript...");
        await saveTranscript(channel, message.author, config);
        await ticketTracker.removeTracking(channel);

        if (message.client && typeof message.client.notifyAdminPanelRefresh === "function") {
            await message.client.notifyAdminPanelRefresh();
        }

        setTimeout(() => {
            channel.delete("Developer force close").catch(() => {});
        }, 3000);

        return true;
    }

    return true;
};
