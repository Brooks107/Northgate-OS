const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const featureRequestHandler = require("../handlers/feature-request-handler");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("frequest")
        .setDescription("Submit a feature request for a NorthGate Studios bot")
        .addStringOption(option =>
            option.setName("bot")
                .setDescription("Select the bot you wish to request a feature for")
                .setRequired(true)
                .addChoices(
                    { name: "NorthCore", value: "NorthCore" },
                    { name: "NorthOps", value: "NorthOps" },
                    { name: "NorthShield", value: "NorthShield" },
                    { name: "Frontier OS", value: "Frontier OS" }
                )
        )
        .addStringOption(option =>
            option.setName("description")
                .setDescription("Describe what you would like the feature to do")
                .setMaxLength(4000)
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName("timeframe")
                .setDescription("When would you like this completed by?")
                .setMaxLength(1000)
                .setRequired(true)
        ),

    async execute(interaction, client, config) {
        if (config.locked) {
            return interaction.reply({
                content: "🚫 NorthGate OS is currently **locked**. Command `/frequest` cannot be used.",
                flags: MessageFlags.Ephemeral
            });
        }

        return featureRequestHandler.submit(interaction, client, config);
    }
};
