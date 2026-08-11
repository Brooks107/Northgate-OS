const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const config = require("../config.json");
const state = require("../state");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("comunlock")
        .setDescription("Unlocks the commission button so commission tickets can be opened."),

    async execute(interaction) {
        config.commissionLocked = false;
        const saved = state.save({ commissionLocked: false });

        await interaction.reply({
            content: saved
                ? "🔓 Commission system unlocked. The commission button is now enabled."
                : "🔓 Commission system unlocked.\n⚠️ Could not save to disk, so this will reset on the next restart.",
            flags: MessageFlags.Ephemeral
        });
    }
};
