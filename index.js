process.loadEnvFile(require("path").join(__dirname, ".env"));
const config = require("./config.json");
config.token = process.env.DISCORD_TOKEN;
config.clientId = process.env.CLIENT_ID;
config.guildId = process.env.GUILD_ID;
const { Client, GatewayIntentBits, Partials, Events, MessageFlags } = require("discord.js");

const supportHandler = require("./handlers/supporthandler");
const commissionsHandler = require("./handlers/commissionshandler");
const hiringHandler = require("./handlers/hiringhandler");
const partnershipHandler = require("./handlers/partnershiphandler");
const reactionRoles = require("./handlers/reactionroles");
const developerHandler = require("./handlers/devhandler");
const prefixHandler = require("./handlers/prefixhandler");
const gitSync = require("./git-sync");
const commandRegistry = require("./command-registry");
const state = require("./state");
const ticketTracker = require("./ticket-tracker");
const { startHeartbeat } = require("./heartbeat");
const { logCommand } = require("./utils/command-logger");

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

// Lock flags are runtime state, not deployment config. Apply the persisted
// values over the config.json defaults before anything can read them, so a
// lock survives the restarts that git-sync triggers on every push.
Object.assign(config, state.load());
// -------------------------------------------------
// Create client
// -------------------------------------------------

const client = new Client({
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ]
});

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

startHeartbeat(client);

// -------------------------------------------------
// Ticket ID system (1–20)
// -------------------------------------------------

client.activeTicketIds = new Set();

client.refreshActiveTicketIds = function (guild) {
    if (!guild) return;

    const seen = new Set();
    for (const channel of guild.channels.cache.values()) {
        const match = channel.name.match(TICKET_CHANNEL_PATTERN);
        if (match) seen.add(Number(match[1]));
    }

    client.activeTicketIds = seen;
};

client.getNextTicketId = function () {
    for (let i = 1; i <= 20; i++) {
        if (!client.activeTicketIds.has(i)) return i;
    }
    return null;
};

const TICKET_CHANNEL_PATTERN = /^(?:support|appeal|commission|hiring|partnership)-(\d+)(?:-|$)/;

client.once(Events.ClientReady, () => {
    for (const guild of client.guilds.cache.values()) {
        client.refreshActiveTicketIds(guild);
    }

    const restored = [...client.activeTicketIds].sort((a, b) => a - b);
    console.log(
        `[tickets] restored ${restored.length} active ticket id(s)` +
        (restored.length ? `: ${restored.join(", ")}` : "")
    );

    ticketTracker.init();
});

// -------------------------------------------------
// Load slash commands, and register them with Discord
// only when the command set has actually changed
// -------------------------------------------------

client.commands = new Map();

(async () => {
    const result = await commandRegistry.registerGuildCommands(config);

    client.commands = new Map(
        [...result.loaded].map(([name, entry]) => [name, entry.command])
    );

    if (result.skipped.length > 0) {
        console.warn(
            `[commands] ${result.skipped.length} command file(s) were skipped and are NOT available:`,
            result.skipped.map(s => s.file).join(", ")
        );
    }
})();

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
        if (interaction.isChatInputCommand()) {
            const cmd = client.commands.get(interaction.commandName);

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
                    console.warn(
                        `[lock] automatically locked after a command rate limit was reached ` +
                        `(${sameCommandLimitReached ? `${COMMAND_RATE_LIMIT_COUNT} uses of one command in one minute` : `${DISTINCT_COMMAND_COUNT} different commands in two minutes`})`
                    );
                }
            }

            await logCommand(interaction, config, `/${interaction.commandName}`, "Slash command");
            await cmd.execute(interaction, client, config);
            return;
        }

        if (interaction.isButton() && interaction.customId.startsWith("management_vc_accept:")) {
            const channelId = config.managementVoiceChannelId;
            const channel = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;
            const requesterId = interaction.customId.split(":")[1];
            const acceptor = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
            const requester = await interaction.guild?.members.fetch(requesterId).catch(() => null);

            if (!channel || !channel.isVoiceBased?.() || !acceptor || !requester) {
                return interaction.reply({
                    content: "❌ The management voice channel or requester could not be found.",
                    flags: MessageFlags.Ephemeral
                });
            }

            if (acceptor.voice.channelId !== channel.id) {
                return interaction.reply({
                    content: "❌ You must already be in the management VC to accept requests.",
                    flags: MessageFlags.Ephemeral
                });
            }

            await channel.permissionOverwrites.edit(requester, { Connect: true });
            await requester.voice.setChannel(channel, "Management VC request accepted");
            await interaction.update({
                content: `✅ Accepted by ${interaction.user}.`,
                components: []
            });
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
            await interaction.deferUpdate();

            if (action === "itsupport_completed") {
                try {
                    const reporter = await client.users.fetch(reporterId);
                    await reporter.send(
                        "✅ Your IT support report has been handled. Thank you for taking the time to report it; your contributions are appreciated."
                    );
                } catch (error) {
                    console.error(`[itsupport] could not DM reporter ${reporterId}:`, error.message);
                }
            }

            await interaction.message.delete();
            return;
        }

        if (interaction.isButton() || interaction.isModalSubmit()) {
            const channelName = interaction.channel?.name || "";
            const isCommissionTicket = interaction.customId === "ticket_commission" || interaction.customId === "modal_ticket_commission" || interaction.customId === "commission_claim" || interaction.customId.startsWith("commission_complete_") || (interaction.customId === "ticket_claim" && channelName.startsWith("commission-")) || (interaction.customId === "ticket_close" && channelName.startsWith("commission-"));
            const isSupportTicket = interaction.customId === "ticket_support" || interaction.customId === "ticket_appeal" || interaction.customId === "modal_ticket_support" || interaction.customId === "modal_ticket_appeal" || interaction.customId === "support_claim" || interaction.customId === "support_close" || (interaction.customId === "ticket_claim" && (channelName.startsWith("support-") || channelName.startsWith("appeal-"))) || (interaction.customId === "ticket_close" && (channelName.startsWith("support-") || channelName.startsWith("appeal-")));
            const isHiringTicket = interaction.customId === "ticket_hire" || interaction.customId === "modal_ticket_hire" || interaction.customId === "hiring_claim" || interaction.customId === "hiring_close" || (interaction.customId === "ticket_claim" && channelName.startsWith("hiring-")) || (interaction.customId === "ticket_close" && channelName.startsWith("hiring-"));
            const isPartnershipTicket = interaction.customId === "ticket_partnership" || interaction.customId === "modal_ticket_partnership" || interaction.customId === "partnership_claim" || interaction.customId === "partnership_close" || (interaction.customId === "ticket_claim" && channelName.startsWith("partnership-")) || (interaction.customId === "ticket_close" && channelName.startsWith("partnership-"));

            if (isCommissionTicket) return await commissionsHandler.execute(interaction, client, config);
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

// -------------------------------------------------
// Message handling for prefix commands (!inject)
// -------------------------------------------------

client.on("messageCreate", async message => {
    try {
        if (message.author.bot) return;
        if (!message.content.startsWith("!inject ")) return;
        if (!message.channel.name?.match(/^(?:support|appeal|commission|hiring|partnership)-(\d+)/)) return;

        const isStaff = config.supportTeamRoles.some(roleId =>
            message.member?.roles?.cache?.has(roleId)
        ) || config.commissionticketaccess?.some(roleId =>
            message.member?.roles?.cache?.has(roleId)
        );

        if (!isStaff) {
            return message.reply({ content: "❌ Only staff can inject info.", ephemeral: true });
        }

        const info = message.content.slice(8).trim(); // Remove "!inject " prefix

        if (!info) {
            return message.reply({ content: "❌ Please provide info to inject: `!inject <info>`", ephemeral: true });
        }

        const result = await ticketTracker.injectInfo(message.channel, info, client);

        if (result.success) {
            await message.react("✅");
            console.log(`[inject] ${message.author.tag} injected info into ${message.channel.name}`);
        } else {
            await message.reply({ content: `❌ ${result.error}`, ephemeral: true });
        }
    } catch (err) {
        console.error("[messageCreate] error:", err);
    }
});

// Permission overwrites do not stop members with Administrator from joining.
// Enforce the management VC lock at the voice-state boundary as well.
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

    const allowedRoleIds = [
        config.hrdirectorrole,
        ...(Array.isArray(config.ownershiprole) ? config.ownershiprole : [config.ownershiprole])
    ].filter(Boolean);

    const isAllowed = allowedRoleIds.some(roleId => newState.member.roles.cache.has(roleId));
    const memberOverwrite = newState.channel.permissionOverwrites.cache.get(newState.member.id);
    const hasExplicitAccess = memberOverwrite?.allow.has("Connect");
    if (isAllowed || hasExplicitAccess) return;

    try {
        await newState.disconnect("Management voice channel is locked");
        console.log(`[management-vc] disconnected unauthorized member ${newState.member.user.tag}`);
    } catch (err) {
        console.error(`[management-vc] could not disconnect ${newState.member?.user?.tag}:`, err.message);
    }
});

// Last-resort guards so a stray async error does not silently kill the bot.
process.on("unhandledRejection", err => {
    console.error("[fatal-guard] unhandled promise rejection:", err);
});

process.on("uncaughtException", err => {
    console.error("[fatal-guard] uncaught exception:", err);
});


client.on("messageCreate", async message => {
    if (await developerHandler(message, config)) return;
    return prefixHandler(message, config);

    if (message.author.bot) return;

    const prefix = "n!";
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();

    if (command === "ping") {
        const sent = await message.reply("Pinging...");
        const latency = sent.createdTimestamp - message.createdTimestamp;
        await sent.edit(`🏓 Pong! Latency: **${latency}ms**`);
        return;
    }

    if (command === "links") {
        const linksChannelId = (
            config.channels?.linkschannel?.id ??
            config.channels?.linkschannelid ??
            config.channels?.linksChannelId ??
            config.linksChannelId ??
            config.linkschannelid
        );

        if (!linksChannelId || !/^[0-9]+$/.test(String(linksChannelId))) {
            console.warn("[links] no valid links channel configured");
            return message.reply("❌ The links channel is not configured yet.");
        }

        const linksChannel = await message.guild?.channels.fetch(linksChannelId).catch(() => null);
        if (!linksChannel || !linksChannel.isTextBased?.()) {
            console.warn(`[links] configured channel ${linksChannelId} is not a valid text channel`);
            return message.reply("❌ The configured links channel is invalid or not accessible.");
        }

        const embed = {
            title: "Northgate Studios Portfolio",
            description: "Below you can find our official links to our projects, website, social media platforms and more.",
            color: 0x00ff00,
            image: {
                url: "https://media.discordapp.net/attachments/1444636404801081448/1535285319123861534/Pixelated_Animated_Nostalgic_90s_Illustrations_Discord_Profile_Banner_13.gif?ex=6a98d3a0&is=6a978220&hm=ce2bb40a5d10ad11b9ec19aa3f0ba9a205639cbc6a95f8ef7b7f684111c81275&"
            },
            footer: {
                text: "Created by Brooks | Powered By Vortigern Industries"
            },
            fields: [
                {
                    name: "Our Website",
                    value: "[Our Website](https://northgate-studios.com/)"
                },
                {
                    name: "Our Website Status Page",
                    value: "[Status Page](https://status.vortigernindustries.com)"
                },
                {
                    name: "SPONSORS",
                    value: "[United Custom Servers Organisation](https://discord.gg/mSbgZbKAGa)\n[Vortigern Industries](https://discord.gg/XHZJ9qjs2B)"
                },
                {
                    name: "Our Youtube",
                    value: "[Northgate Studios](https://www.youtube.com/@NorthGate.Studios)"
                },
                {
                    name: "Our Roblox Group",
                    value: "[Northgate Studios](https://www.roblox.com/communities/33030494/NORTHGATE-Studios#!/about)"
                }
            ]
        };

        try {
            await linksChannel.send({ embeds: [embed] });
        } catch (err) {
            console.error("[links] failed to send links embed:", err);
            return message.reply("❌ I cannot send the links embed in that channel. Check channel permissions.");
        }

        return;
    }

    if (command === "rules") {
        const rulesChannelId = (
            config.channels?.ruleschannel?.id ??
            config.channels?.ruleschannelid ??
            config.channels?.rulesChannelId ??
            config.rulesChannelId ??
            config.ruleschannelid
        );

        if (!rulesChannelId || !/^[0-9]+$/.test(String(rulesChannelId))) {
            console.warn("[rules] no valid rules channel configured");
            return message.reply("❌ The rules channel is not configured yet.");
        }

        const rulesChannel = await message.guild?.channels.fetch(rulesChannelId).catch(() => null);
        if (!rulesChannel || !rulesChannel.isTextBased?.()) {
            console.warn(`[rules] configured channel ${rulesChannelId} is not a valid text channel`);
            return message.reply("❌ The configured rules channel is invalid or not accessible.");
        }

        const embed = {
            title: "Northgate Studios Rules",
            description: [
                "**NOTICE**",
                "",
                "By joining any Northgate Studios server, project, game, or community, you agree to follow all rules, policies, and staff decisions enforced by Northgate.",
                "",
                "These policies take effect across all Northgate Studios' projects.",
                "",
                "Northgate Studios reserves the right to warn, kick, remove, suspend, ban, or otherwise take administrative action against any community of staff member at any time with or without notice, for any reason deemed appropriate by staff members of ownership.",
                "",
                "",
                "---------------------------------------------------"
            ].join("\n"),
            image: {
                url: "https://cdn.discordapp.com/attachments/1172091235461238815/1518658520948408330/Copy_of_Studio_intro.gif?ex=6a98fbb6&is=6a97aa36&hm=e642fd4324eeb9a807652e1e1f6684b562058aec310c6c8bedf367267d3d81c9&"
            },
            footer: {
                text: "Created by Brooks | Powered By Vortigern Industries"
            },
            fields: [
                {
                    name: "Be respectful.",
                    value: "This means no derogatory, rude, or harassing comments. Treat others as you want to be treated."
                },
                {
                    name: "No inappropriate language.",
                    value: "Keep profanity to a reasonable minimum. Any derogatory language directed at any user is prohibited. Swearing is permitted only in casual channels, while profanity should be avoided in all other channels."
                },
                {
                    name: "No spamming.",
                    value: "Do not send a series of small messages one after another. These interupt the chat and can make it difficult to scroll through the server. Pleqase keep your messages to atleast 5 words long while chatting unless the situation is deemed appropriate by staff."
                },
                {
                    name: "No pornographic, explicit or adult content",
                    value: "Under no circumstances should any member of this server including staff members post pornographic, explicit or adult content. Here at Northgate we stride to provide a safe community for our members and younger users here at Northgate."
                },
                {
                    name: "No advertising.",
                    value: "Do not send invasive or unsolicited advertisements Whether it is other communities or streams, you can post your content in the media channel if it is relevant, follows all rules and is beneficial to the community. If you are unsure, please ask a staff member before posting."
                },
                {
                    name: "Do not share personally identifiable information (PII).",
                    value: "Do not share any personally identifiable information (PII) about yourself or others, including but not limited to addresses, phone numbers, email addresses, and social security numbers and other private information."
                },
                {
                    name: "Avoid any misleading or false information.",
                    value: "Please check the authenticity of any information before sharing it around our community, and only share from reliable and trusted sources, False or misleading information can be harmful, undermining trust and integrity between members of the community. If you are unsure, please ask a staff member before sharing."
                },
                {
                    name: "Follow the per-channel instructions.",
                    value: "Each channel on the server has its own set of rules about what kind of content is permitted. Please follow these guidelines and understand the purpose of each channel."
                },
                {
                    name: "Follow Discord's Terms of Service and Community Guidelines.",
                    value: "All members of this server must follow Discord's Terms of Service and Community Guidelines. Any violation of these rules may result in disciplinary action, including but not limited to warnings, temporary or permanent bans from the server, or legal action if necessary."
                },
                {
                    name: "Do not share or distribute hacks, cheats, or other unauthorized tools or services.",
                    value: "The server strictly prohibits the sharing or distribution of hacks, cheats, or other unauthorized tools or services."
                },
                {
                    name: "Do not share or distribute viruses or malicious software.",
                    value: "The server strictly prohibits the sharing or distribution of viruses or malicious software."
                },
                {
                    name: "Do not impersonate other users or staff members or any other organisation.",
                    value: "This includes but is not limited to using similar usernames, profile pictures, or other identifying information to mislead others into thinking you are someone else. Impersonation can cause confusion and harm to the community and is strictly prohibited."
                },
                {
                    name: "Do not abuse server bots or other automated systems.",
                    value: "Do not attempt to bypass, exploit or otherwise misuse our server bots - Especially our custom bots, spamming commands, features or constantly triggering automod responses can crash the bot and any other bots ran on the hosting service, distrupting bots for multiple different organisations throughout SCP:RP and Vortigern Industries."
                },
                {
                    name: "Do not engage in any illegal activities.",
                    value: [
                        "This includes but is not limited to sharing or distributing illegal content, engaging in illegal activities, or promoting illegal activities. Any illegal activities will be reported to the appropriate authorities and may result in legal action.",
                        "",
                        "",
                        "TL:DR",
                        "Have Common Sense"
                    ].join("\n")
                }
            ]
        };

        try {
            await rulesChannel.send({ embeds: [embed] });
        } catch (err) {
            console.error("[rules] failed to send rules embed:", err);
            return message.reply("❌ I cannot send the rules embed in that channel. Check channel permissions.");
        }

        return;
    }
});

// -------------------------------------------------
// Login
// -------------------------------------------------

client.login(process.env.DISCORD_TOKEN);

// -------------------------------------------------
// Automatic git sync from remote updates
// -------------------------------------------------

gitSync.startAutoSync(config.gitSync, {
    // Close the gateway connection cleanly before pm2 restarts us.
    onBeforeRestart: async () => {
        try {
            await client.destroy();
        } catch {
            /* already disconnected */
        }
    }
});
