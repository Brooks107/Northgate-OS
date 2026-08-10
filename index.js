const config = require("./config.json");
const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits, REST, Routes } = require("discord.js");

const supportHandler = require("./handlers/supporthandler");
const commissionsHandler = require("./handlers/commissionshandler");

// -------------------------------------------------
// Auto‑register slash commands BEFORE login
// -------------------------------------------------

const commands = [];
const commandFiles = fs.readdirSync("./commands").filter(f => f.endsWith(".js"));

for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    commands.push(command.data.toJSON());
}

const rest = new REST({ version: "10" }).setToken(config.token);

(async () => {
    try {
        console.log(`🔧 Registering ${commands.length} slash commands...`);

        await rest.put(
            Routes.applicationGuildCommands(config.clientId, config.guildId),
            { body: commands }
        );

        console.log("✅ Slash commands registered successfully.");
    } catch (error) {
        console.error("❌ Failed to register slash commands:", error);
    }
})();

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
// Load slash commands into memory
// -------------------------------------------------

client.commands = new Map();

for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    client.commands.set(command.data.name, command);
}

// -------------------------------------------------
// Interaction router
// -------------------------------------------------

client.on("interactionCreate", async interaction => {

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
            return commissionsHandler.execute(interaction, client, config);
        }

        if (
            interaction.customId === "ticket_support" ||
            interaction.customId === "ticket_appeal" ||
            interaction.customId === "modal_ticket_support" ||
            interaction.customId === "modal_ticket_appeal" ||
            interaction.customId === "support_close"
        ) {
            return supportHandler.execute(interaction, client, config);
        }
    }
});

// -------------------------------------------------
// Login
// -------------------------------------------------

client.login(config.token);
