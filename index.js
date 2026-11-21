process.loadEnvFile(require("path").join(__dirname, ".env"));
const configManager = require("./configManager");
const config = configManager.loadConfig();
config.token = process.env.DISCORD_TOKEN;
config.clientId = process.env.CLIENT_ID;

const { Client, GatewayIntentBits, Partials, Events, MessageFlags } = require("discord.js");

const supportHandler = require("./handlers/supporthandler");
const interoHandler = require("./handlers/interohandler");
const hiringHandler = require("./handlers/hiringhandler");
const partnershipHandler = require("./handlers/partnershiphandler");
const reactionRoles = require("./handlers/reactionroles");
const adminHandler = require("./handlers/adminhandler");
const developerHandler = require("./handlers/devhandler");
const prefixHandler = require("./handlers/prefixhandler");
const joinHandler = require("./handlers/joinhandler");
const gitSync = require("./git-sync");
const commandRegistry = require("./command-registry");
const state = require("./state");
const { hasDefconCommandAccess } = require("./utils/defcon-access");
const ticketTracker = require("./ticket-tracker");
const {
    setTicketPanelsLocked,
    TICKET_CREATION_INTERACTION_IDS
} = require("./utils/ticket-panel-lock");
const autocloseScheduler = require("./autoclose-scheduler");
const { startHeartbeat } = require("./heartbeat");
const { logCommand } = require("./utils/command-logger");
const { isStoredServerBackupMessage } = require("./utils/server-backup");
const serverSync = require("./utils/server-sync");
const featureRequestHandler = require("./handlers/feature-request-handler");
const {
    ProgressFailure,
    createInteractionProgress
} = require("./utils/progress-embed");
const adminPanelCommand = require("./commands/adminpanel");

const COMMAND_RATE_LIMIT_WINDOW_MS = 60_000;
const COMMAND_RATE_LIMIT_COUNT = 5;
const DISTINCT_COMMAND_WINDOW_MS = 120_000;
const DISTINCT_COMMAND_COUNT = 10;
const commandInvocations = new Map();
const distinctCommands = new Map();

function trackCommandInvocation(commandName) {
    const now = Date.now();
    const recentInvocations = (commandInvocations.get(commandName) || [])
        .filter(timestamp => now - timestamp < COMMAND_RATE_LIMIT_WINDOW_MS);

    recentInvocations.push(now);
    commandInvocations.set(commandName, recentInvocations);

    return recentInvocations.length >= COMMAND_RATE_LIMIT_COUNT;
}

function trackDistinctCommand(commandName) {
    const now = Date.now();

    for (const [name, timestamp] of distinctCommands) {
        if (now - timestamp >= DISTINCT_COMMAND_WINDOW_MS) {
            distinctCommands.delete(name);
        }
    }

    distinctCommands.set(commandName, now);
    return distinctCommands.size >= DISTINCT_COMMAND_COUNT;
}

const runtimeState = state.load();
Object.assign(config, runtimeState);
const activeEnvironment = configManager.getActiveEnvironment();
const runtimeGroups = runtimeState.groupArraysByEnvironment?.[activeEnvironment]
    || (activeEnvironment === "main" ? runtimeState.groupArrays : null)
    || {};
const boardOfDirectors = { ...(config.boardOfDirectors || {}) };
for (const [legacyKey, boardKey] of [
    ["hrdirectorrole", "hrdir"],
    ["techdirrole", "techdir"]
]) {
    if (runtimeGroups[legacyKey] !== undefined) {
        boardOfDirectors[boardKey] = runtimeGroups[legacyKey];
    }
}
if (
    runtimeGroups.boardOfDirectors &&
    typeof runtimeGroups.boardOfDirectors === "object" &&
    !Array.isArray(runtimeGroups.boardOfDirectors)
) {
    Object.assign(boardOfDirectors, runtimeGroups.boardOfDirectors);
}
config.boardOfDirectors = boardOfDirectors;

for (const [key, values] of Object.entries(runtimeGroups)) {
    if (key !== "boardOfDirectors" && key !== "hrdirectorrole" && key !== "techdirrole" && Array.isArray(values)) {
        config[key] = values;
    }
}

const client = new Client({
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ]
});

client.commands = new Map();
client.config = config;

client.on(Events.MessageReactionAdd, async (reaction, user) => {
    try {
        await reactionRoles.handleAdd(reaction, user, config);
    } catch (error) {
        console.error("[reaction-roles] failed to add role:", error);
    }
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
    try {
        await reactionRoles.handleRemove(reaction, user, config);
    } catch (error) {
        console.error("[reaction-roles] failed to remove role:", error);
    }
});

client.on(Events.GuildMemberAdd, joinHandler);

startHeartbeat(client);

client.activeTicketIds = new Set();

// Channel pattern matching support-1, hiring-4, partnership-2, etc.
const TICKET_CHANNEL_PATTERN = /(?:support|appeal|hiring|partnership|interrogation)[^\d]*(\d+)/i;

client.refreshActiveTicketIds = async function () {
    const seen = new Set();

    for (const guild of client.guilds.cache.values()) {
        try {
            const channels = await guild.channels.fetch();
            for (const channel of channels.values()) {
                if (!channel || !channel.name) continue;

                const match = channel.name.match(TICKET_CHANNEL_PATTERN);
                if (match) {
                    const ticketId = Number(match[1]);
                    seen.add(ticketId);
                    console.log(`[tickets] Found active ticket: #${channel.name} (ID: ${ticketId}) in ${guild.name}`);
                }
            }
        } catch (error) {
            console.error(`[tickets] Failed to fetch channels for guild ${guild.name}:`, error);
        }
    }

    client.activeTicketIds = seen;
    const sorted = [...seen].sort((a, b) => a - b);
    console.log(`[tickets] Active ticket IDs synced: ${sorted.join(", ") || "None"}`);
};

client.getNextTicketId = function () {
    for (let i = 1; i <= 20; i++) {
        if (!client.activeTicketIds.has(i)) return i;
    }
    return null;
};

client.once(Events.ClientReady, async () => {
    client.user.setPresence({
        status: config.maintenanceMode ? "invisible" : "online",
        activities: []
    });
    console.log(`[presence] bot is ${config.maintenanceMode ? "invisible" : "online"}.`);
    await serverSync.start(client);

    // Fetch and aggregate active ticket IDs across all guilds
    await client.refreshActiveTicketIds();

    ticketTracker.init();
    await ticketTracker.reconcileActiveTickets(client, config);
    ticketTracker.startHourlyReconciliation(client, config);
    autocloseScheduler.init(client, config);
    await adminPanelCommand.restore(client, config);
    if (config.forceLocked) {
        try {
            const changedButtons = await setTicketPanelsLocked(
                client,
                config.channels.ticketchannelid,
                true
            );
            console.log(`[lock] force lock restored; disabled ${changedButtons} ticket panel button(s).`);
        } catch (error) {
            console.error("[lock] could not restore ticket panel button lock:", error);
        }
    }

    if (typeof client.notifyAdminPanelRefresh === "function") {
        await client.notifyAdminPanelRefresh();
    }
});

client.on(Events.ChannelCreate, async channel => {
    if (!channel.guild) return;

    if (TICKET_CHANNEL_PATTERN.test(channel.name)) {
        await client.refreshActiveTicketIds();
        if (typeof client.notifyAdminPanelRefresh === "function") {
            await client.notifyAdminPanelRefresh();
        }
    }
});

client.on(Events.ChannelDelete, async channel => {
    if (!channel.guild) return;

    if (TICKET_CHANNEL_PATTERN.test(channel.name)) {
        const trackedTicket = ticketTracker.getTracking(channel.id);
        if (trackedTicket && trackedTicket.status !== "🔴 Closed") {
            await ticketTracker.removeTracking(channel);
        }

        await client.refreshActiveTicketIds();
        if (typeof client.notifyAdminPanelRefresh === "function") {
            await client.notifyAdminPanelRefresh();
        }
    }
});

client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
    if (!newChannel.guild) return;

    const oldMatches = TICKET_CHANNEL_PATTERN.test(oldChannel.name);
    const newMatches = TICKET_CHANNEL_PATTERN.test(newChannel.name);

    if (oldMatches || newMatches) {
        await client.refreshActiveTicketIds();
        if (typeof client.notifyAdminPanelRefresh === "function") {
            await client.notifyAdminPanelRefresh();
        }
    }
});

async function reportInteractionFailure(interaction, err) {
    console.error(`[interaction] handler failed for "${interaction.commandName ?? interaction.customId}":`, err);

    const response = { content: "⚠️ Something went wrong handling that.", flags: MessageFlags.Ephemeral };

    try {
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(response);
        } else {
            await interaction.reply(response);
        }
    } catch {
        /* interaction already expired or was consumed elsewhere */
    }
}

client.on("interactionCreate", async interaction => {
    try {
        if (
            configManager.isVaultMode() &&
            interaction.guildId === configManager.getMainGuildId()
        ) {
            return interaction.reply({
                content: "🔒 NorthGate Studios security protocol is active. This bot has been detached from this server and is currently operating in secure vault mode.",
                flags: MessageFlags.Ephemeral
            });
        }

        if (await serverSync.handleInteraction(interaction)) return;

        if (interaction.isButton() && interaction.customId.startsWith("backupload_")) {
            const match = interaction.customId.match(
                /^backupload_(confirm|override|cancel)_(\d{17,20})_(\d{17,20})$/
            );
            const isActive = match &&
                client.activeBackupRestoreConfirmations?.has(match[3]);

            if (!isActive) {
                return interaction.reply({
                    content: "⌛ This backup restore confirmation is no longer active. Run `/backupload` again.",
                    flags: MessageFlags.Ephemeral
                });
            }

            if (interaction.user.id !== match[2]) {
                return interaction.reply({
                    content: "❌ Only the person who started this backup restore can respond.",
                    flags: MessageFlags.Ephemeral
                });
            }

            if (
                match[1] === "override" &&
                !(Array.isArray(config.developers) ? config.developers : [])
                    .some(id => String(id) === interaction.user.id)
            ) {
                return interaction.reply({
                    content: "❌ Only a configured developer can override the backup similarity protection.",
                    flags: MessageFlags.Ephemeral
                });
            }

            return;
        }

        if (interaction.isButton() && interaction.customId.startsWith("force_lock_")) {
            const match = interaction.customId.match(
                /^force_lock_(?:proceed|abort)_(\d{17,20})_(\d{17,20})$/
            );
            const isActive = match &&
                client.activeForceLockConfirmations?.has(match[2]);

            if (!isActive) {
                return interaction.reply({
                    content: "⌛ This force lock confirmation is no longer active. Run the command again.",
                    flags: MessageFlags.Ephemeral
                });
            }

            if (interaction.user.id !== match[1]) {
                return interaction.reply({
                    content: "❌ Only the person who started this force lock confirmation can respond.",
                    flags: MessageFlags.Ephemeral
                });
            }

            return;
        }

        if (interaction.isButton() && interaction.customId.startsWith("defcon_owner_")) {
            const match = interaction.customId.match(
                /^defcon_owner_(?:agree|cancel)_(\d{17,20})_(\d{17,20})$/
            );
            const isActive = match &&
                client.activeDefconOwnerConfirmations?.has(match[2]);

            if (!isActive) {
                return interaction.reply({
                    content: "⌛ This DEFCON confirmation is no longer active. Run the command again.",
                    flags: MessageFlags.Ephemeral
                });
            }

            if (interaction.user.id !== match[1]) {
                return interaction.reply({
                    content: "❌ Only the ownership member who started this DEFCON command can respond.",
                    flags: MessageFlags.Ephemeral
                });
            }

            return;
        }

        if (interaction.isButton() && interaction.customId.startsWith("backup_delete_")) {
            const match = interaction.customId.match(/^backup_delete_(\d+)$/);
            const isDeveloper = (Array.isArray(config.developers) ? config.developers : [])
                .some(id => String(id) === interaction.user.id);
            if (!isDeveloper) {
                return interaction.reply({
                    content: "❌ Only configured developers can delete server backups.",
                    flags: MessageFlags.Ephemeral
                });
            }
            if (
                !match ||
                !interaction.guild ||
                interaction.channelId !== config.defconBackupChannelId ||
                interaction.message.author.id !== client.user.id ||
                !isStoredServerBackupMessage(interaction.message, match[1], config.guildId)
            ) {
                return interaction.reply({
                    content: "❌ This is not a valid stored server-backup message.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const sourceGuild = client.guilds.cache.get(config.guildId);
            if (!sourceGuild) {
                return interaction.reply({
                    content: "❌ The source server is unavailable; backup deletion was blocked.",
                    flags: MessageFlags.Ephemeral
                });
            }
            let sourceMember;
            try {
                sourceMember = await sourceGuild.members.fetch(interaction.user.id);
            } catch (error) {
                console.error("[backup-delete] could not verify the developer in the source server:", error);
                return interaction.reply({
                    content: "❌ Could not verify your source-server membership; backup deletion was blocked.",
                    flags: MessageFlags.Ephemeral
                });
            }
            if (!hasDefconCommandAccess(
                interaction.user.id,
                sourceMember,
                config,
                "d!delbackup"
            )) {
                return interaction.reply({
                    content: "🚫 Backup deletion is restricted by the active DEFCON level.",
                    flags: MessageFlags.Ephemeral
                });
            }

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            try {
                await interaction.message.delete();
                return interaction.editReply(`✅ Deleted server backup **#${match[1]}**.`);
            } catch (error) {
                console.error(`[backup-delete] failed to delete backup ${match[1]}:`, error);
                return interaction.editReply(`❌ Could not delete backup **#${match[1]}**: ${error.message}`);
            }
        }

        if (interaction.isButton() && (
            interaction.customId.startsWith("group_confirm_") ||
            interaction.customId.startsWith("group_cancel_")
        )) {
            return;
        }

        if (config.maintenanceMode && !config.developers?.includes(interaction.user.id)) {
            return interaction.reply({
                content: "🔴 The bot is currently offline for maintenance.",
                flags: MessageFlags.Ephemeral
            });
        }

        if (
            (interaction.isButton() || interaction.isModalSubmit()) &&
            interaction.customId.startsWith("frequest:")
        ) {
            return featureRequestHandler.execute(interaction, client, config);
        }

        if (interaction.isChatInputCommand()) {
            const cmd = client.commands.get(interaction.commandName);

            if (!hasDefconCommandAccess(
                interaction.user.id,
                interaction.member,
                config,
                `/${interaction.commandName}`
            )) {
                return interaction.reply({
                    content: "🚫 Commands are restricted by the active DEFCON level.",
                    flags: MessageFlags.Ephemeral
                });
            }

            if (!cmd) {
                console.warn(`[interaction] no handler loaded for /${interaction.commandName}`);
                return interaction.reply({
                    content: "❌ That command is currently unavailable. Please try again later or contact staff.",
                    flags: MessageFlags.Ephemeral
                });
            }

            if (!config.locked) {
                const sameCommandLimitReached = trackCommandInvocation(interaction.commandName);
                const distinctCommandLimitReached = trackDistinctCommand(interaction.commandName);

                if (sameCommandLimitReached || distinctCommandLimitReached) {
                    config.locked = true;
                    state.save({ locked: true });
                    commandInvocations.clear();
                    distinctCommands.clear();
                    if (client.notifyAdminPanelRefresh) {
                        await client.notifyAdminPanelRefresh();
                    }
                    console.warn(
                        `[lock] automatically locked after a command rate limit was reached ` +
                        `(${sameCommandLimitReached ? `${COMMAND_RATE_LIMIT_COUNT} uses of one command in one minute` : `${DISTINCT_COMMAND_COUNT} different commands in two minutes`})`
                    );
                }
            }

            const commandArguments = interaction.options.data.map(option =>
                `${option.name}=${option.value ?? option.options?.map(nested => `${nested.name}=${nested.value ?? ""}`).join(",") ?? ""}`
            );
            await logCommand(interaction, config, `/${interaction.commandName}`, "Slash command", commandArguments);
            await cmd.execute(interaction, client, config);
            return;
        }

        if (interaction.isButton() && interaction.customId.startsWith("management_vc_accept:")) {
            const requesterId = interaction.customId.split(":")[1];
            const progress = createInteractionProgress(interaction, "Accepting management VC request", [
                "Find the management channel and both members",
                "Confirm you are in the management voice channel",
                "Grant the requester connection access",
                "Move the requester if already connected to voice",
                "Mark the request as accepted"
            ]);
            await progress.start();

            let channel;
            let acceptor;
            let requester;
            try {
                await progress.runStep(0, async () => {
                    const channelId = config.managementVoiceChannelId;
                    channel = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;
                    acceptor = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
                    requester = await interaction.guild?.members.fetch(requesterId).catch(() => null);

                    if (!channel || !channel.isVoiceBased?.() || !acceptor || !requester) {
                        throw new ProgressFailure("The management voice channel or requester could not be found.");
                    }
                });

                await progress.runStep(1, async () => {
                    if (acceptor.voice.channelId !== channel.id) {
                        throw new ProgressFailure("You must already be in the management VC to accept requests.");
                    }
                });
                await progress.runStep(2, () =>
                    channel.permissionOverwrites.edit(requester, { Connect: true })
                );
                const requesterInVoice = Boolean(requester.voice.channelId);
                await progress.runStep(3, () => requesterInVoice
                    ? requester.voice.setChannel(channel, "Management VC request accepted")
                    : Promise.resolve()
                );
                await progress.runStep(4, () =>
                    interaction.message.edit({
                        content: `✅ Accepted by ${interaction.user}.`,
                        components: []
                    })
                );
                await progress.complete(requesterInVoice
                    ? "✅ The requester now has access to the management voice channel."
                    : "✅ The requester now has access and can join the management voice channel."
                );
            } catch (error) {
                if (error instanceof ProgressFailure) return;
                throw error;
            }
            return;
        }

        if (interaction.isButton() && (
            interaction.customId.startsWith("itsupport_completed:") ||
            interaction.customId.startsWith("itsupport_denied:")
        )) {
            const isDeveloper = config.developers?.some(userId =>
                String(userId) === interaction.user.id
            );

            if (!isDeveloper) {
                return interaction.reply({
                    content: "❌ Only developers can mark a IT REPORT as completed",
                    flags: MessageFlags.Ephemeral
                });
            }

            const [action, reporterId] = interaction.customId.split(":");
            const isCompleted = action === "itsupport_completed";
            const progress = createInteractionProgress(
                interaction,
                isCompleted ? "Closing IT support report" : "Dismissing IT support report",
                isCompleted
                    ? ["Find the report author", "Notify the author", "Remove the report"]
                    : ["Remove the report"]
            );
            await progress.start();

            if (isCompleted) {
                let reporter;
                await progress.runStep(0, async () => {
                    try {
                        reporter = await client.users.fetch(reporterId);
                    } catch (error) {
                        console.error(`[itsupport] could not fetch reporter ${reporterId}:`, error.message);
                    }
                });
                if (reporter) {
                    const dmSent = await progress.runStep(1, async () => {
                        try {
                            await reporter.send(
                                "✅ Your IT support report has been handled. Thank you for taking the time to report it; your contributions are appreciated."
                            );
                            return true;
                        } catch (error) {
                            console.error(`[itsupport] could not DM reporter ${reporterId}:`, error.message);
                            return false;
                        }
                    });
                    if (!dmSent) await progress.warnStep(1);
                } else {
                    await progress.runStep(1, async () => {});
                    await progress.warnStep(1);
                }
                await progress.runStep(2, () => interaction.message.delete());
            } else {
                await progress.runStep(0, () => interaction.message.delete());
            }

            await progress.complete(isCompleted
                ? `✅ IT support report completed by ${interaction.user}.`
                : `🛑 IT support report dismissed by ${interaction.user}.`);
            return;
        }

        if (interaction.isButton() || interaction.isModalSubmit()) {
            const channelName = interaction.channel?.name || "";
            const isSupportTicket = interaction.customId === "ticket_support" || interaction.customId === "ticket_appeal" || interaction.customId === "modal_ticket_support" || interaction.customId === "modal_ticket_appeal" || interaction.customId === "support_claim" || interaction.customId === "support_close" || (interaction.customId === "ticket_claim" && (channelName.startsWith("support-") || channelName.startsWith("appeal-"))) || (interaction.customId === "ticket_close" && (channelName.startsWith("support-") || channelName.startsWith("appeal-")));
            const isHiringTicket = interaction.customId === "ticket_hire" || interaction.customId === "modal_ticket_hire" || interaction.customId === "hiring_claim" || interaction.customId === "hiring_close" || (interaction.customId === "ticket_claim" && channelName.startsWith("hiring-")) || (interaction.customId === "ticket_close" && channelName.startsWith("hiring-"));
            const isPartnershipTicket = interaction.customId === "ticket_partnership" || interaction.customId === "modal_ticket_partnership" || interaction.customId === "partnership_claim" || interaction.customId === "partnership_close" || (interaction.customId === "ticket_claim" && channelName.startsWith("partnership-")) || (interaction.customId === "ticket_close" && channelName.startsWith("partnership-"));
            const isInterrogationTicket = interaction.customId === "intero_claim" || interaction.customId === "intero_close";
            if (
                config.forceLocked &&
                TICKET_CREATION_INTERACTION_IDS.has(interaction.customId)
            ) {
                return interaction.reply({
                    content: "🚫 Ticket creation is currently locked. Please try again later.",
                    flags: MessageFlags.Ephemeral
                });
            }

            if (isInterrogationTicket) return await interoHandler.execute(interaction, client, config);
            if (isSupportTicket) return await supportHandler.execute(interaction, client, config);
            if (isHiringTicket) return await hiringHandler.execute(interaction, client, config);
            if (isPartnershipTicket) return await partnershipHandler.execute(interaction, client, config);

            console.warn(`[interaction] no route for component "${interaction.customId}" in #${channelName || "unknown"}`);
            return interaction.reply({
                content: "❌ This button is no longer active. Please open a new ticket or contact staff.",
                flags: MessageFlags.Ephemeral
            });
        }
    } catch (err) {
        await reportInteractionFailure(interaction, err);
    }
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    if (!newState.channelId) return;
    if (newState.channelId !== config.managementVoiceChannelId) return;
    if (newState.member?.user.bot) return;

    const everyoneOverwrite = newState.channel.permissionOverwrites.cache.get(
        newState.guild.roles.everyone.id
    );
    const channelIsLocked = config.managementVoiceChannelLocked ||
        everyoneOverwrite?.deny.has("Connect");
    if (!channelIsLocked) return;

    const toArray = value => Array.isArray(value) ? value : value ? [value] : [];
    const board = config.boardOfDirectors || {};
    const allowedRoleIds = [
        ...toArray(config.hrmanagerrole),
        ...toArray(board.hrdir),
        ...toArray(board.techdir),
        ...toArray(board.prdir),
        ...toArray(board.devdir),
        ...toArray(board.comdir),
        ...toArray(config.ownershiprole)
    ].filter(Boolean);

    const isAllowed = allowedRoleIds.some(roleId => newState.member.roles.cache.has(roleId));
    const hasRoleConnectOverride = newState.channel.permissionOverwrites.cache.some(override =>
        override.type === "role" &&
        newState.member.roles.cache.has(override.id) &&
        override.allow.has("Connect")
    );
    const memberOverwrite = newState.channel.permissionOverwrites.cache.get(newState.member.id);
    const hasExplicitAccess = memberOverwrite?.allow.has("Connect");
    if (isAllowed || hasRoleConnectOverride || hasExplicitAccess) return;

    try {
        await newState.disconnect("Management voice channel is locked");
        console.log(`[management-vc] disconnected unauthorized member ${newState.member.user.tag}`);
    } catch (err) {
        console.error(`[management-vc] could not disconnect ${newState.member?.user?.tag}:`, err.message);
    }
});

process.on("unhandledRejection", err => {
    console.error("[fatal-guard] unhandled promise rejection:", err);
});

// discord.js waits out a Discord rate limit silently, so a command stuck on
// "is thinking..." looks identical to a bug. This puts the wait in the log.
// Channel topic/name edits (claim, unclaim, force claim, transfer) are the
// usual cause: Discord allows 2 per channel every 10 minutes.
client.rest.on("rateLimited", info => {
    console.warn(
        `[rate-limit] waiting ${Math.ceil(info.timeToReset / 1000)}s on ${info.method} ${info.route}` +
        `${info.global ? " (global)" : ""}`
    );
});

process.on("uncaughtException", err => {
    console.error("[fatal-guard] uncaught exception:", err);
});

client.on("messageCreate", async message => {
    if (message.author.bot) return;

    const content = message.content.trimStart();
    const prefixedCommand = content.match(/^(d!|n!|a!)(\S+)/i);
    const standaloneCommand = content.match(/^(!(?:help|msg))\b/i);
    const commandName = prefixedCommand
        ? `${prefixedCommand[1].toLowerCase()}${prefixedCommand[2].toLowerCase()}`
        : standaloneCommand?.[1].toLowerCase();

    if (commandName && !hasDefconCommandAccess(
        message.author.id,
        message.member,
        config,
        commandName
    )) {
        await message.reply("🚫 Commands are restricted by the active DEFCON level.");
        return;
    }

    if (await adminHandler(message, config)) return;
    if (await developerHandler(message, config)) return;

    const handledByPrefix = await prefixHandler(message, config);
    if (handledByPrefix) return;

});

async function main() {
    try {
        const result = await commandRegistry.registerGuildCommands(config);

        client.commands = new Map(
            [...result.loaded].map(([name, entry]) => [name, entry.command])
        );

        if (result.skipped && result.skipped.length > 0) {
            console.warn(
                `[commands] ${result.skipped.length} command file(s) were skipped and are NOT available:`,
                result.skipped.map(s => s.file).join(", ")
            );
        }

        await client.login(process.env.DISCORD_TOKEN);

        gitSync.startAutoSync(config.gitSync, {
            onBeforeRestart: async () => {
                try {
                    await client.destroy();
                } catch {
                    /* already disconnected */
                }
            }
        });
    } catch (err) {
        console.error("Fatal startup error:", err);
    }
}

main();