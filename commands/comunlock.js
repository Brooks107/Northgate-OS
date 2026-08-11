const { SlashCommandBuilder } = require("discord.js");
const fs = require("fs");
const config = require("../config.json");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("comunlock")
        .setDescription("Unlocks the commission button so commission tickets can be opened."),

    async execute(interaction) {

        config.commissionLocked = false;
        fs.writeFileSync("./config.json", JSON.stringify(config, null, 4));

        await interaction.reply({
            content: "🔓 Commission system unlocked. The commission button is now enabled.",
            ephemeral: true
        });
    }
};
