const config = require("./config.json");
const { Client, GatewayIntentBits } = require("discord.js");

const supportHandler = require("./handlers/supporthandler");
const commissionsHandler = require("./handlers/commissionshandler");
const gitSync = require("./git-sync");
const commandRegistry = require("./command-registry");

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

client.getNextTicketId = function () {
    for (let i = 1; i <= 20; i++) {
        if (!client.activeTicketIds.has(i)) return i;
    }
    return null;
};

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

    const message = { content: "⚠️ Something went wrong handling that.", ephemeral: true };

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
        if (cmd) await cmd.execute(interaction, client, config);
        return;
    }

    if (interaction.isButton() || interaction.isModalSubmit()) {

        if (
            interaction.customId === "ticket_commission" ||
            interaction.customId === "modal_ticket_commission" ||
            interaction.customId === "ticket_claim" ||
            interaction.customId === "ticket_close"
        ) {
            return await commissionsHandler.execute(interaction, client, config);
        }

        if (
            interaction.customId === "ticket_support" ||
            interaction.customId === "ticket_appeal" ||
            interaction.customId === "modal_ticket_support" ||
            interaction.customId === "modal_ticket_appeal" ||
            interaction.customId === "support_close"
        ) {
            return await supportHandler.execute(interaction, client, config);
        }
    }

  } catch (err) {
      await reportInteractionFailure(interaction, err);
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
