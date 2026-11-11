const fs = require("fs");
const path = require("path");
const {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder
} = require("discord.js");
const { logCommand } = require("../utils/command-logger");
const { createMessageProgress } = require("../utils/progress-embed");
const state = require("../state");
const ticketTracker = require("../ticket-tracker");
const { NORTHGATE_OS_PREFIX, OTHER_BOT_COMMANDS } = require("../utils/help");

const CONFIG_FILE = path.join(__dirname, "..", "config.json");

const GROUP_CONFIG_KEYS = {
    operations: "operationsroles",
    support: "supportTeamRoles",
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
const LOCKDOWN_ROLE = "1536806576202186842";

function getGroupValues(config, configKey) {
    const value = config[configKey];
    return Array.isArray(value) ? [...value] : value ? [value] : [];
}

function saveGroupConfig(configKey, values) {
    const storedConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    storedConfig[configKey] = values;

    const temporaryFile = `${CONFIG_FILE}.${process.pid}.tmp`;
    try {
        fs.writeFileSync(temporaryFile, `${JSON.stringify(storedConfig, null, 4)}\n`, "utf8");
        fs.renameSync(temporaryFile, CONFIG_FILE);
    } catch (error) {
        if (fs.existsSync(temporaryFile)) {
            try {
                fs.unlinkSync(temporaryFile);
            } catch (cleanupError) {
                console.error("[devhandler] could not remove temporary config file:", cleanupError);
            }
        }
        throw error;
    }
}

async function resolveGroupDisplayValue(client, guild, group, value) {
    const rawValue = String(value ?? "").trim();
    if (!rawValue) return "(empty value)";

    if (ROLE_GROUPS.has(group)) {
        const role = guild?.roles?.cache?.get(rawValue)
            || (guild ? await guild.roles.fetch(rawValue).catch(() => null) : null);

        if (role) return `${rawValue} → @${role.name}`;
        return `${rawValue} → (role not found in this guild)`;
    }

    const user = await client.users.fetch(rawValue).catch(() => null);
    if (user) return `${rawValue} → ${user.tag}`;
    return `${rawValue} → (not found / not a user)`;
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

    if (commandName === "n!ping" || commandName === "!help") {
        return { result: "allowed", reason: "Available to everyone." };
    }

    if (commandName === "n!purge") {
        return member.permissions.has("ManageMessages")
            ? { result: "allowed", reason: "Requires Manage Messages permission." }
            : { result: "blocked", reason: "Requires Manage Messages permission." };
    }

    if (["n!links", "n!rules", "n!ticketrules"].includes(commandName)) {
        return isAdministrator
            ? { result: "allowed", reason: "Requires Administrator permission." }
            : { result: "blocked", reason: "Requires Administrator permission." };
    }

    if (["n!inject", "n!sub"].includes(commandName)) {
        const canUse = isDeveloper || hasAnyRole(config.supportTeamRoles);
        return canUse
            ? { result: "allowed", reason: "Requires a support access role or developer access." }
            : { result: "blocked", reason: "Requires a support access role or developer access." };
    }

    if (["d!addgroup", "d!delgroup", "d!showgroup", "d!forceclaim", "d!forceclose", "d!forcerestart", "d!impersonate"].includes(commandName)) {
        return isDeveloper
            ? { result: "allowed", reason: "Developer-only command; other context requirements may also apply." }
            : { result: "blocked", reason: "Developer-only command." };
    }

    if (commandName === "a!forcelock" || commandName === "a!forceunlock") {
        return hasAnyRole(LOCKDOWN_ROLE)
            ? { result: "allowed", reason: "Requires the lockdown role." }
            : { result: "blocked", reason: "Requires the lockdown role." };
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

    if (commandName === "frequest") {
        return hasAnyRole(config.staffrole)
            ? { result: "allowed", reason: "Requires the configured staff role." }
            : { result: "blocked", reason: "Requires the configured staff role." };
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
        return hasAnyRole(config.supportTeamRoles)
            ? { result: "allowed", reason: "Support access role." }
            : { result: "blocked", reason: "Requires a support access role." };
    }

    if (["close", "autoclose", "autocloseabort"].includes(commandName)) {
        return member.permissions.has("ManageChannels") || isDeveloper || isOwner
            ? { result: "allowed", reason: "Manage Channels permission, developer access, or ownership access." }
            : { result: "blocked", reason: "Requires Manage Channels permission." };
    }

    if (["ticketpanel", "hiringpanel", "partnerpanel", "reactionpanel"].includes(commandName)) {
        return isDeveloper || isOwner || isAdministrator || member.permissions.has("ManageChannels")
            ? { result: "allowed", reason: "Developer, ownership, administrator, or staff panel access." }
            : { result: "blocked", reason: "Requires developer, ownership, administrator, or panel access." };
    }

    if (["itsupport", "requestmanagementvc"].includes(commandName)) {
        return { result: "allowed", reason: "This command is available to server members." };
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
            return false;
        }

        await logChannel.send({
            content: `📄 Transcript for **${channel.name}** (closed by ${closedBy.tag})`,
            files: [file],
            allowedMentions: { parse: [] }
        });
        return true;
    } catch (err) {
        console.error("[devhandler] transcript failed:", err);
        return false;
    }
}

module.exports = async function handleDeveloperCommand(message, config) {
    if (message.author.bot || !message.content.startsWith("d!")) return false;

    const args = message.content.slice(2).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();
    if (!["addgroup", "delgroup", "showgroup", "forceclose", "impersonate", "power", "forcerestart"].includes(command)) return false;

    // d!forcerestart names the bot: core (this one), ops (Staff Management),
    // shield (North Shield) or frontier (Frontier OS). Another bot's name is left to that bot. With no
    // name, only this bot answers, with the usage.
    if (command === "forcerestart") {
        const target = args[0]?.toLowerCase();
        if (target && target !== "core") return false;
        if (!target) {
            await message.reply("❌ Usage: `d!forcerestart <core|ops|shield|frontier>` (core = NorthGate OS, ops = Staff Management, shield = North Shield, frontier = Frontier OS)");
            return true;
        }
    }

    // d!impersonate only checks permissions. Say so in the log, or it reads as if
    // the impersonated command had really been run.
    await logCommand(message, config, `d!${command}`, command === "impersonate" ? "Impersonation check (nothing was run)" : "Developer command", args);

    const isDeveloper = config.developers?.includes(message.author.id);
    const ownershipRoles = Array.isArray(config.ownershiprole)
        ? config.ownershiprole
        : [config.ownershiprole].filter(Boolean);
    const isOwner = ownershipRoles.some(roleId =>
        message.member?.roles?.cache?.has(roleId)
    );
    const powerAction = command === "power" ? args.shift()?.toLowerCase() : null;
    if (command === "forcerestart") {
        if (!isDeveloper) {
            await message.reply("❌ This command is developer only - Please contact a member of the IT team to have them run it");
            return true;
        }
        await message.reply("🔄 Restarting **NorthGate OS**...");
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
        const progress = createMessageProgress(message, "Updating role group", [
            `Update the **${group}** group in memory`,
            "Update config.json",
            "Save the updated groups to runtime state"
        ]);
        await progress.start();

        let configSaved = false;
        let stateSaved = false;
        try {
            await progress.runStep(0, async () => {
                config[configKey] = values;
            });
            await progress.runStep(1, async () => {
                try {
                    saveGroupConfig(configKey, values);
                    configSaved = true;
                } catch (error) {
                    console.error(`[devhandler] could not update config.json for ${group}:`, error);
                }
            });
            if (!configSaved) await progress.warnStep(1);
            await progress.runStep(2, async () => {
                stateSaved = state.save({
                    groupArrays: {
                        ...currentGroups,
                        [configKey]: values
                    }
                });
            });
            if (!stateSaved) await progress.warnStep(2);
            await progress.complete(
                `${command === "addgroup" ? "✅ Added" : "🗑️ Removed"} \`${id}\` ${command === "addgroup" ? "to" : "from"} the **${group}** group.` +
                (configSaved ? "" : "\n⚠️ config.json could not be updated; check the bot logs." +
                    (stateSaved ? " The change was saved to runtime state." : " The change may reset after restart.")) +
                (stateSaved || !configSaved ? "" : "\n⚠️ Runtime state could not be saved; config.json has the change.")
            );
        } catch (error) {
            console.error(`[devhandler] failed to ${command} ${id} in ${group}:`, error);
        }
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

        const guild = message.guild || (config.guildId ? message.client.guilds.cache.get(config.guildId) : null);

        const resolved = await Promise.all(values.map(async value => {
            return resolveGroupDisplayValue(message.client, guild, group, value);
        }));

        await message.reply([
            `📋 **${group}** group values (${values.length}):`,
            ...resolved.map(entry => `• ${entry}`)
        ].join("\n"));
        return true;
    }

    if (command === "impersonate") {
        if (["list", "commands"].includes(args[0]?.toLowerCase())) {
            const registeredCommands = [...(message.client.commands?.values() || [])]
                .map(registered => registered.data.toJSON())
                .sort((a, b) => a.name.localeCompare(b.name));

            const slashLines = registeredCommands.map(registered =>
                `• \`/${registered.name}\` — ${registered.description || "No description provided."}`
            );
            const prefixLines = NORTHGATE_OS_PREFIX.map(([name, description]) =>
                `• \`${name}\` — ${description}`
            );
            const pages = [];
            let page = "";
            const appendSection = (heading, lines) => {
                if (!lines.length) return;
                const headingText = `${heading}\n`;
                if (page && page.length + headingText.length > 1900) {
                    pages.push(page);
                    page = "";
                }
                page += headingText;

                for (const line of lines) {
                    if (page.length + line.length + 1 > 1900) {
                        pages.push(page);
                        page = `${heading} (continued)\n`;
                    }
                    page += `${line}\n`;
                }
            };
            appendSection("📋 **Registered slash commands:**", slashLines);
            appendSection("📋 **NorthGate prefix commands:**", prefixLines);
            if (page) pages.push(page);
            pages[pages.length - 1] += "\nℹ️ Staff Management, North Shield and Frontier OS answer `d!impersonate` for their own commands.";

            for (const content of pages) {
                await message.reply(content);
            }
            return true;
        }

        const target = args.shift();
        const targetCommand = args.shift()?.toLowerCase()?.replace(/^\//, "");
        const targetPowerAction = args.shift()?.toLowerCase();
        const targetId = target?.match(/^<@!?(\d+)>$/)?.[1] || target;

        if (!/^\d{17,20}$/.test(targetId || "") || !targetCommand) {
            await message.reply("❌ Usage: `d!impersonate <user ID or mention> <command>`");
            return true;
        }

        // Another NorthGate bot's command: that bot answers with its own settings.
        if (OTHER_BOT_COMMANDS.has(targetCommand) && !message.client.commands?.has(targetCommand)) {
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
            `🔎 **${resultLabel}**: **${member.user.tag}** running \`${/^(?:[dna]!|!)/.test(targetCommand) ? targetCommand : `/${targetCommand}`}\` (NorthGate OS)`,
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
        const progress = createMessageProgress(message, "Updating bot power mode", [
            "Save the maintenance state",
            "Update the bot presence"
        ]);
        await progress.start();

        let saved;
        try {
            await progress.runStep(0, async () => {
                config.maintenanceMode = maintenanceMode;
                saved = state.save({ maintenanceMode });
            });
            await progress.runStep(1, async () => {
                message.client.user.setPresence({
                    status: maintenanceMode ? "invisible" : "online",
                    activities: []
                });
            });
            await progress.complete(
                maintenanceMode
                    ? `🔴 Bot set to **invisible maintenance mode**.${saved ? "" : "\n⚠️ Could not save this state to disk."}`
                    : `🟢 Bot is **online** again.${saved ? "" : "\n⚠️ Could not save this state to disk."}`
            );
        } catch (error) {
            console.error(`[devhandler] failed to set power mode to ${action}:`, error);
        }
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
            config.hiringticketcategory,
            config.partnershipticketcategory
        ].filter(Boolean));

        const isTicketChannel =
            Boolean(channel) &&
            (
                channel.name.match(/^(?:support|appeal|hiring|partnership)-(\d+)(?:-|$)/) ||
                (channel.parentId && ticketCategoryIds.has(channel.parentId))
            );

        if (!isTicketChannel) {
            await message.reply("❌ d!forceclose must be used inside a ticket channel.");
            return true;
        }

        const match = channel.name.match(/^(?:support|appeal|hiring|partnership)-(\d+)(?:-|$)/);
        const id = match ? Number(match[1]) : null;
        const progress = createMessageProgress(message, `Force-closing ${channel.name}`, [
            "Release the ticket slot and refresh the admin panel",
            "Save the ticket transcript",
            "Remove the ticket from tracking",
            "Schedule ticket channel deletion"
        ]);
        await progress.start();
        await progress.runStep(0, async () => {
            if (id !== null && message.client?.activeTicketIds) {
                message.client.activeTicketIds.delete(id);
            }
            if (message.client && typeof message.client.notifyAdminPanelRefresh === "function") {
                await message.client.notifyAdminPanelRefresh();
            }
        });
        const transcriptSaved = await progress.runStep(1, () =>
            saveTranscript(channel, message.author, config)
        );
        if (!transcriptSaved) await progress.warnStep(1);
        await progress.runStep(2, () => ticketTracker.removeTracking(channel));
        await progress.runStep(3, async () => {
            setTimeout(() => {
                channel.delete("Developer force close").catch(error => {
                    console.error(`[forceclose] failed to delete ${channel.name}:`, error);
                });
            }, 3000);
        });
        await progress.complete(
            `🔒 ${channel.name} closed. ` +
            (transcriptSaved ? "Transcript saved." : "⚠️ Transcript could not be saved; check the bot logs.") +
            " Channel deletion is queued."
        );

        return true;
    }

    return true;
};
