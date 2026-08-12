const { SlashCommandBuilder } = require("discord.js");
const fs = require("fs");

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
        fs.writeFileSync("./config.json", JSON.stringify(config, null, 4));

        await interaction.reply({
            content: "🔒 Commission system locked. The commission button is now disabled.",
            ephemeral: true
        });
    }
};
