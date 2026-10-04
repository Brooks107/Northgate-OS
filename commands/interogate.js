const { SlashCommandBuilder, MessageFlags } = require("discord.js");

const interoHandler = require("../handlers/interohandler");
const {
    ProgressFailure,
    createInteractionProgress
} = require("../utils/progress-embed");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("interrogate")
        .setDescription("Open an interrogation ticket with a user.")
        .addUserOption(option =>
            option.setName("user")
                .setDescription("The user to include in the interrogation ticket.")
                .setRequired(true)
        ),

    async execute(interaction, client, config) {
            if (config.locked) {
                return interaction.reply({
                    content: "🚫 NorthGate OS is currently locked.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const operationsRoles = Array.isArray(config.operationsroles)
                ? config.operationsroles
                : [config.operationsroles].filter(Boolean);
            const isOperations = operationsRoles.some(roleId =>
                interaction.member?.roles?.cache?.has(roleId)
            );

            if (!isOperations) {
                return interaction.reply({
                    content: "❌ Only Operations staff can open an interrogation ticket.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const user = interaction.options.getUser("user");
            if (!user || user.bot) {
                return interaction.reply({
                    content: "❌ Choose a real server member for the interrogation ticket.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const progress = createInteractionProgress(interaction, "Creating interrogation ticket", [
                "Find an available ticket slot",
                "Create the private interrogation channel",
                "Post the ticket details and controls",
                "Create the ticket tracker entry",
                "Refresh the admin panel"
            ]);
            await progress.start();
            try {
                await interoHandler.createTicket(interaction, client, config, user, progress);
            } catch (error) {
                if (error instanceof ProgressFailure) return;
                throw error;
            }
    }
};
