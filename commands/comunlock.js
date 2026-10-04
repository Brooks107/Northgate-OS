const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const state = require("../state");
const { createInteractionProgress } = require("../utils/progress-embed");

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

        const progress = createInteractionProgress(interaction, "Unlocking commission requests", [
            "Save the commission unlock state",
            "Refresh the admin panel"
        ]);
        await progress.start();

        let saved;
        await progress.runStep(0, async () => {
            config.commissionLocked = false;
            saved = state.save({ commissionLocked: false });
        });
        await progress.runStep(1, async () => {
            if (interaction.client && typeof interaction.client.notifyAdminPanelRefresh === "function") {
                await interaction.client.notifyAdminPanelRefresh();
            }
        });
        await progress.complete(saved
            ? "🔓 Commission system unlocked. The commission button is now enabled."
            : "🔓 Commission system unlocked.\n⚠️ Could not save to disk, so this will reset on the next restart.");
    }
};
