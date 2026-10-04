const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");
const {
    ProgressFailure,
    createInteractionProgress
} = require("../utils/progress-embed");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("remove")
        .setDescription("Remove a user from a ticket by ID.")
        .addIntegerOption(option =>
            option.setName("id")
                .setDescription("The ticket ID.")
                .setRequired(true)
        )
        .addUserOption(option =>
            option.setName("user")
                .setDescription("The user to remove from the ticket.")
                .setRequired(true)
        ),

    async execute(interaction, client, config) {
        const isAuthorized = (config.supportTeamRoles?.some(roleId =>
            interaction.member?.roles?.cache?.has(roleId)
        ) || config.commissionticketaccess?.some(roleId =>
            interaction.member?.roles?.cache?.has(roleId)
        ));

        if (!isAuthorized) {
            return interaction.reply({
                content: "❌ You are not authorized to use `/remove`.",
                ephemeral: true
            });
        }

        const id = interaction.options.getInteger("id");
        const user = interaction.options.getUser("user");
        const progress = createInteractionProgress(interaction, "Removing member from ticket", [
            `Find ticket #${id} and verify access`,
            `Remove ${user.tag}'s ticket access`
        ]);
        await progress.start();

        let ticketChannel;
        try {
            await progress.runStep(0, async () => {
                ticketChannel = interaction.guild.channels.cache.find(ch =>
                    ["commission", "support", "appeal", "hiring", "partnership", "interrogation"]
                        .some(prefix => ch.name.startsWith(`${prefix}-${id}`))
                );
                if (!ticketChannel) throw new ProgressFailure(`Ticket #${id} does not exist.`);
                if (!ticketChannel.permissionOverwrites.cache.has(user.id)) {
                    throw new ProgressFailure(`${user.tag} is not part of ticket #${id}.`);
                }
            });
            await progress.runStep(1, () => ticketChannel.permissionOverwrites.edit(user.id, {
                ViewChannel: false,
                SendMessages: false,
                ReadMessageHistory: false
            }));
            await progress.complete(`👤 Removed **${user.tag}** from ticket #${id}.`);
        } catch (error) {
            if (error instanceof ProgressFailure) return;
            throw error;
        }
    }
};
