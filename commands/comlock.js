const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const config = require("../config.json");
const state = require("../state");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("comlock")
        .setDescription("Locks the commission button so no commission tickets can be opened."),

    async execute(interaction) {
        config.commissionLocked = true;
        const saved = state.save({ commissionLocked: true });

        await interaction.reply({
            content: saved
                ? "🔒 Commission system locked. The commission button is now disabled."
                : "🔒 Commission system locked.\n⚠️ Could not save to disk, so this will reset on the next restart.",
            flags: MessageFlags.Ephemeral
        });
    }
};
