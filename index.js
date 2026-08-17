const config = require("./config.json");
const { Client, GatewayIntentBits, Events, MessageFlags } = require("discord.js");

const supportHandler = require("./handlers/supporthandler");
const commissionsHandler = require("./handlers/commissionshandler");
const hiringHandler = require("./handlers/hiringhandler");
const partnershipHandler = require("./handlers/partnershiphandler");
const gitSync = require("./git-sync");
const commandRegistry = require("./command-registry");
const state = require("./state");
const ticketTracker = require("./ticket-tracker");

// Lock flags are runtime state, not deployment config. Apply the persisted
// values over the config.json defaults before anything can read them, so a
// lock survives the restarts that git-sync triggers on every push.
Object.assign(config, state.load());

// -------------------------------------------------
// Create client
// -------------------------------------------------

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

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

// The set above only lives in memory, and git-sync restarts this process on
// every push. Without this, a restart forgets every open ticket and hands out
// #1 again while support-1 is still open -- two channels then share an ID and
// /close picks whichever one it finds first. Ticket channel names carry the ID,
// so the channels themselves are the source of truth on boot. Match both bare
// names like support-2 and suffixed names like support-2-someone.
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

    // Initialize ticket tracker
    ticketTracker.init();
});

// -------------------------------------------------
// Load slash commands, and register them with Discord
// only when the command set has actually changed
// -------------------------------------------------

client.commands = new Map();

(async () => {
    const result = await commandRegistry.registerCommands(config);

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

// -------------------------------------------------
// Interaction router
// -------------------------------------------------

// A throw inside an async event listener becomes an unhandled rejection,
// which terminates the process. Every handler below is wrapped so that one
// failing command cannot take the whole bot offline.
async function reportInteractionFailure(interaction, err) {
    console.error(`[interaction] handler failed for "${interaction.commandName ?? interaction.customId}":`, err);

    const message = { content: "⚠️ Something went wrong handling that.", flags: MessageFlags.Ephemeral };

    try {
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(message);
        } else {
            await interaction.reply(message);
        }
    } catch {
        /* interaction already expired or was consumed elsewhere */
    }
}

client.on("interactionCreate", async interaction => {
  try {

    if (interaction.isChatInputCommand()) {
        const cmd = client.commands.get(interaction.commandName);

        // A command file that failed to load is still registered with Discord,
        // so it stays visible in the picker. Say so instead of timing out.
        if (!cmd) {
            console.warn(`[interaction] no handler loaded for /${interaction.commandName}`);
            return interaction.reply({
                content: "❌ That command is currently unavailable. Please try again later or contact staff.",
                flags: MessageFlags.Ephemeral
            });
        }

        await cmd.execute(interaction, client, config);
        return;
    }

    if (interaction.isButton() || interaction.isModalSubmit()) {
        const channelName = interaction.channel?.name || "";

        const isCommissionTicket =
            interaction.customId === "ticket_commission" ||
            interaction.customId === "modal_ticket_commission" ||
            interaction.customId === "commission_claim" ||
            interaction.customId.startsWith("commission_complete_") ||
            (interaction.customId === "ticket_claim" && channelName.startsWith("commission-")) ||
            (interaction.customId === "ticket_close" && channelName.startsWith("commission-"));

        const isSupportTicket =
            interaction.customId === "ticket_support" ||
            interaction.customId === "ticket_appeal" ||
            interaction.customId === "modal_ticket_support" ||
            interaction.customId === "modal_ticket_appeal" ||
            interaction.customId === "support_claim" ||
            interaction.customId === "support_close" ||
            (interaction.customId === "ticket_claim" && (channelName.startsWith("support-") || channelName.startsWith("appeal-"))) ||
            (interaction.customId === "ticket_close" && (channelName.startsWith("support-") || channelName.startsWith("appeal-")));

        const isHiringTicket =
            interaction.customId === "ticket_hire" ||
            interaction.customId === "modal_ticket_hire" ||
            interaction.customId === "hiring_claim" ||
            interaction.customId === "hiring_close" ||
            (interaction.customId === "ticket_claim" && channelName.startsWith("hiring-")) ||
            (interaction.customId === "ticket_close" && channelName.startsWith("hiring-"));

        const isPartnershipTicket =
            interaction.customId === "ticket_partnership" ||
            interaction.customId === "modal_ticket_partnership" ||
            interaction.customId === "partnership_claim" ||
            interaction.customId === "partnership_close" ||
            (interaction.customId === "ticket_claim" && channelName.startsWith("partnership-")) ||
            (interaction.customId === "ticket_close" && channelName.startsWith("partnership-"));

        if (isCommissionTicket) {
            return await commissionsHandler.execute(interaction, client, config);
        }

        if (isSupportTicket) {
            return await supportHandler.execute(interaction, client, config);
        }

        if (isHiringTicket) {
            return await hiringHandler.execute(interaction, client, config);
        }

        if (isPartnershipTicket) {
            return await partnershipHandler.execute(interaction, client, config);
        }

        // Nothing claimed it. Answer anyway -- an unrouted component otherwise
        // leaves the user staring at Discord's "This interaction failed".
        console.warn(
            `[interaction] no route for component "${interaction.customId}" in #${channelName || "unknown"}`
        );

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

// Last-resort guards so a stray async error does not silently kill the bot.
process.on("unhandledRejection", err => {
    console.error("[fatal-guard] unhandled promise rejection:", err);
});

process.on("uncaughtException", err => {
    console.error("[fatal-guard] uncaught exception:", err);
});

// -------------------------------------------------
// Login
// -------------------------------------------------

client.login(config.token);

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
