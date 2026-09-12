const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const state = require("../state");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("comunlock")
        .setDescription("Unlocks the commission button so commission tickets can be opened."),

    async execute(interaction, client, config) {
        const isAuthorized = config.commissionticketaccess?.some(roleId =>
            interaction.member?.roles?.cache?.has(roleId)
        );

        if (!isAuthorized) {
            return interaction.reply({
                content: "❌ You are not authorized to use `/comunlock`.",
                ephemeral: true
            });
        }

        config.commissionLocked = false;
        const saved = state.save({ commissionLocked: false });

        if (interaction.client && typeof interaction.client.notifyAdminPanelRefresh === "function") {
            await interaction.client.notifyAdminPanelRefresh();
        }

        await interaction.reply({
            content: saved
                ? "🔓 Commission system unlocked. The commission button is now enabled."
                : "🔓 Commission system unlocked.\n⚠️ Could not save to disk, so this will reset on the next restart.",
            flags: MessageFlags.Ephemeral
        });
    }
};
