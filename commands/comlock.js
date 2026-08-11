const { SlashCommandBuilder } = require("discord.js");
const fs = require("fs");
const config = require("../config.json");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("comlock")
        .setDescription("Locks the commission button so no commission tickets can be opened."),

    async execute(interaction) {

        config.commissionLocked = true;
        fs.writeFileSync("./config.json", JSON.stringify(config, null, 4));

        await interaction.reply({
            content: "🔒 Commission system locked. The commission button is now disabled.",
            ephemeral: true
        });
    }
};
