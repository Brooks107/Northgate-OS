const { SlashCommandBuilder } = require("discord.js");
const fs = require("fs");

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
        fs.writeFileSync("./config.json", JSON.stringify(config, null, 4));

        await interaction.reply({
            content: "🔓 Commission system unlocked. The commission button is now enabled.",
            ephemeral: true
        });
    }
};
