const {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder
} = require("discord.js");
const { logCommand } = require("../utils/command-logger");
const state = require("../state");
const ticketTracker = require("../ticket-tracker");

const GROUP_CONFIG_KEYS = {
    operations: "operationsroles",
    support: "supportTeamRoles",
    commissions: "commissionticketaccess",
    dev: "developers",
    general: "generalticketaccess",
    appeal: "appealsticketaccess",
    partnership: "partnershipticketaccess",
    hiring: "hiringticketaccess",
    pr: "prrole",
    community: "communityrole",
    developergame: "devrole",
    staff: "staffrole",
    hrdir: "hrdirectorrole",
    hrman: "hrmanagerrole",
    ownership: "ownershiprole"
};

const ROLE_GROUPS = new Set(Object.keys(GROUP_CONFIG_KEYS).filter(group => group !== "dev"));

function getGroupValues(config, configKey) {
    const value = config[configKey];
    return Array.isArray(value) ? [...value] : value ? [value] : [];
}

async function confirmRoleGroupChange(message, action, group, id) {
    const warning = new EmbedBuilder()
        .setTitle("⚠️ Role group change warning")
        .setColor(0xf59e0b)
        .setDescription(
            `You are about to **${action}** \`${id}\` in the **${group}** role group.\n\n` +
            "This group contains Discord role IDs. Confirm that the value is a role ID before proceeding."
        )
        .setFooter({ text: "No change has been made yet." });
    const confirmation = await message.reply({
        embeds: [warning],
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`group_confirm_${message.id}`)
                .setLabel("Proceed")
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`group_cancel_${message.id}`)
                .setLabel("Cancel")
                .setStyle(ButtonStyle.Secondary)
        )]
    });

    try {
        const choice = await confirmation.awaitMessageComponent({
            filter: interaction => interaction.user.id === message.author.id,
            time: 30_000
        });
        const confirmed = choice.customId === `group_confirm_${message.id}`;
        await choice.update({
            content: confirmed ? "⚠️ Confirmed. Applying the group change..." : "🛑 Group change cancelled.",
            embeds: [],
            components: []
        });
        return confirmed;
    } catch {
        await confirmation.edit({
            content: "⌛ Group change confirmation expired. No changes were made.",
            embeds: [],
            components: []
        });
        return false;
    }
}

function evaluateCommandAccess(commandName, member, config, client, commandArguments = []) {
    const hasAnyRole = roleIds => {
        const ids = Array.isArray(roleIds) ? roleIds : [roleIds];
        return ids.filter(Boolean).some(roleId => member.roles.cache.has(roleId));
    };
    const isDeveloper = config.developers?.includes(member.id) === true;
    const ownershipRoles = Array.isArray(config.ownershiprole)
        ? config.ownershiprole
        : [config.ownershiprole].filter(Boolean);
    const isOwner = hasAnyRole(ownershipRoles);
    const isAdministrator = member.permissions.has("Administrator");
    const isManageRoles = member.permissions.has("ManageRoles");

    if (commandName === "d!power") {
        const powerAction = commandArguments[0];
        const canUse = isDeveloper || (powerAction === "off" && isOwner);
        return canUse
            ? { result: "allowed", reason: "Developer access, or ownership for power off." }
            : { result: "blocked", reason: powerAction === "on" ? "Only developers can power the bot on." : "Requires developer or ownership access." };
    }

    if (["d!addgroup", "d!delgroup", "d!forceclose", "d!forceclaim", "!msg"].includes(commandName)) {
        return isDeveloper
            ? { result: "allowed", reason: "Developer-only command." }
            : { result: "blocked", reason: "Developer-only command." };
    }

    if (!client.commands?.has(commandName)) {
        return { result: "unknown", reason: "That command is not currently registered." };
    }

    if (config.maintenanceMode && !isDeveloper) {
        return { result: "blocked", reason: "Maintenance mode allows slash commands only for developers." };
    }

    if (commandName === "available") {
        return isDeveloper
            ? { result: "allowed", reason: "Developer-only command." }
            : { result: "blocked", reason: "Developer-only command." };
    }

    if (commandName === "adminpanel") {
        return isDeveloper || isOwner
            ? { result: "allowed", reason: "Developer or ownership access." }
            : { result: "blocked", reason: "Requires a developer ID or ownership role." };
    }

    if (["cmdlock", "cmdunlock"].includes(commandName)) {
        return isAdministrator
            ? { result: "allowed", reason: "Requires Administrator permission." }
            : { result: "blocked", reason: "Requires Administrator permission." };
    }

    if (commandName === "interrogate") {
        return hasAnyRole(config.operationsroles)
            ? { result: "allowed", reason: "Operations access role." }
            : { result: "blocked", reason: "Requires an Operations access role." };
    }

    if (["add", "claim", "remove", "transfer", "unclaim"].includes(commandName)) {
        return hasAnyRole([...(config.supportTeamRoles || []), ...(config.commissionticketaccess || [])])
            ? { result: "allowed", reason: "Support or commission access role." }
            : { result: "blocked", reason: "Requires a support or commission access role." };
    }

    if (["approve", "deny", "comlock", "comunlock"].includes(commandName)) {
        return hasAnyRole(config.commissionticketaccess)
            ? { result: "allowed", reason: "Commission access role." }
            : { result: "blocked", reason: "Requires a commission access role." };
    }

    if (["close", "autoclose", "autocloseabort"].includes(commandName)) {
        return member.permissions.has("ManageChannels") || isDeveloper || isOwner
            ? { result: "allowed", reason: "Manage Channels permission, developer access, or ownership access." }
            : { result: "blocked", reason: "Requires Manage Channels permission." };
    }

    if (["ticketpanel", "commissionspanel", "hiringpanel", "partnerpanel", "reactionpanel"].includes(commandName)) {
        return isDeveloper || isOwner || isAdministrator || member.permissions.has("ManageChannels")
            ? { result: "allowed", reason: "Developer, ownership, administrator, or staff panel access." }
            : { result: "blocked", reason: "Requires developer, ownership, administrator, or panel access." };
    }

    if (["itsupport", "requestmanagementvc"].includes(commandName)) {
        return { result: "allowed", reason: "This command is available to server members." };
    }

    if (commandName === "hire") {
        return isManageRoles || isAdministrator || hasAnyRole(config.supportTeamRoles)
            ? { result: "allowed", reason: "Manage Roles, Administrator, or support access." }
            : { result: "blocked", reason: "Requires Manage Roles, Administrator, or support access." };
    }

    if (commandName === "managementvclock") {
        return isDeveloper || isOwner || hasAnyRole(config.hrdirectorrole)
            ? { result: "allowed", reason: "Developer, ownership, or HR director access." }
            : { result: "blocked", reason: "Requires developer, ownership, or HR director access." };
    }

    return {
        result: "unknown",
        reason: "The command has additional context-dependent checks; no action was executed."
    };
}

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
    if (!["addgroup", "delgroup", "showgroup", "forceclose", "impersonate", "power", "forcerestart"].includes(command)) return false;

    await logCommand(message, config, `d!${command}`, "Developer command", args);

    const isDeveloper = config.developers?.includes(message.author.id);
    const ownershipRoles = Array.isArray(config.ownershiprole)
        ? config.ownershiprole
        : [config.ownershiprole].filter(Boolean);
    const isOwner = ownershipRoles.some(roleId =>
        message.member?.roles?.cache?.has(roleId)
    );
    const powerAction = command === "power" ? args.shift()?.toLowerCase() : null;
    if (command === "forcerestart") {
        await message.reply("🔄 Restarting the bot...");
        await message.client.destroy();
        process.exit(0);
        return true;
    }
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

    if (command === "addgroup" || command === "delgroup") {
        const group = args.shift()?.toLowerCase();
        const suppliedId = args.shift();
        const id = suppliedId?.match(/^<@&?(\d+)>$/)?.[1] || suppliedId;
        const configKey = GROUP_CONFIG_KEYS[group];

        if (!configKey || !/^\d{17,20}$/.test(id || "")) {
            await message.reply([
                "❌ Usage: `d!addgroup <group> <Discord ID or mention>` or `d!delgroup <group> <Discord ID or mention>`",
                `Groups: ${Object.keys(GROUP_CONFIG_KEYS).join(", ")}`
            ].join("\n"));
            return true;
        }

        if (command === "addgroup" && ROLE_GROUPS.has(group)) {
            const confirmed = await confirmRoleGroupChange(message, "add", group, id);
            if (!confirmed) return true;
        }

        const values = getGroupValues(config, configKey);
        if (command === "addgroup") {
            if (values.includes(id)) {
                await message.reply(`ℹ️ \`${id}\` is already in the **${group}** group.`);
                return true;
            }
            values.push(id);
        } else {
            if (!values.includes(id)) {
                await message.reply(`ℹ️ \`${id}\` is not in the **${group}** group.`);
                return true;
            }
            values.splice(values.indexOf(id), 1);
        }

        const currentGroups = state.load().groupArrays || {};
        const saved = state.save({
            groupArrays: {
                ...currentGroups,
                [configKey]: values
            }
        });
        config[configKey] = values;

        await message.reply(
            `${command === "addgroup" ? "✅ Added" : "🗑️ Removed"} \`${id}\` ${command === "addgroup" ? "to" : "from"} the **${group}** group.` +
            (saved ? "" : "\n⚠️ The change could not be saved to disk and may reset after restart.")
        );
        return true;
    }

    if (command === "showgroup") {
        const group = args.shift()?.toLowerCase();
        const configKey = GROUP_CONFIG_KEYS[group];

        if (!configKey) {
            await message.reply([
                "❌ Usage: `d!showgroup <group>`",
                `Groups: ${Object.keys(GROUP_CONFIG_KEYS).join(", ")}`
            ].join("\n"));
            return true;
        }

        const values = getGroupValues(config, configKey);
        if (values.length === 0) {
            await message.reply(`ℹ️ The **${group}** group is empty.`);
            return true;
        }

        const resolved = await Promise.all(values.map(async value => {
            const user = await message.client.users.fetch(value).catch(() => null);
            return user ? `${value} → ${user.tag}` : `${value} → (not found / not a user)`;
        }));

        await message.reply([
            `📋 **${group}** group values (${values.length}):`,
            ...resolved.map(entry => `• ${entry}`)
        ].join("\n"));
        return true;
    }

    if (command === "impersonate") {
        const target = args.shift();
        const targetCommand = args.shift()?.toLowerCase()?.replace(/^\//, "");
        const targetPowerAction = args.shift()?.toLowerCase();
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

        const access = evaluateCommandAccess(
            targetCommand,
            member,
            config,
            message.client,
            [targetPowerAction, ...args]
        );
        const resultLabel = {
            allowed: "✅ WOULD EXECUTE",
            blocked: "❌ WOULD BE BLOCKED",
            unknown: "⚠️ CANNOT DETERMINE"
        }[access.result];

        await message.reply([
            `🔎 **${resultLabel}**: **${member.user.tag}** running \`${targetCommand.startsWith("d!") || targetCommand === "!msg" ? targetCommand : `/${targetCommand}`}\``,
            "",
            access.reason,
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
