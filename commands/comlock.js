const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const state = require("../state");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("comlock")
        .setDescription("Locks the commission button so no commission tickets can be opened."),

    async execute(interaction, client, config) {
        const isAuthorized = config.commissionticketaccess?.some(roleId =>
            interaction.member?.roles?.cache?.has(roleId)
        );

        if (!isAuthorized) {
            return interaction.reply({
                content: "❌ You are not authorized to use `/comlock`.",
                ephemeral: true
            });
        }

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
