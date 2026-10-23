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
        .setName("add")
        .setDescription("Add a user to a ticket by ID.")
        .addIntegerOption(option =>
            option.setName("id")
                .setDescription("The ticket ID.")
                .setRequired(true)
        )
        .addUserOption(option =>
            option.setName("user")
                .setDescription("The user to add to the ticket.")
                .setRequired(true)
        ),

    async execute(interaction, client, config) {

        if (config.locked) {
            return interaction.reply({
            content: '🚫 NorthGate OS is currently **locked**. Command `/close` cannot be used.',
            flags: MessageFlags.Ephemeral
            });
        }

        
        const isAuthorized = config.supportTeamRoles?.some(roleId =>
            interaction.member?.roles?.cache?.has(roleId)
        );

        if (!isAuthorized) {
            return interaction.reply({
                content: "❌ You are not authorized to use `/add`.",
                ephemeral: true
            });
        }

        const id = interaction.options.getInteger("id");
        const user = interaction.options.getUser("user");
        const progress = createInteractionProgress(interaction, "Adding member to ticket", [
            `Find ticket #${id}`,
            `Grant ${user.tag} access to the ticket`
        ]);
        await progress.start();

        let ticketChannel;
        try {
            await progress.runStep(0, async () => {
                ticketChannel = interaction.guild.channels.cache.find(ch =>
                    ["support", "appeal", "hiring", "partnership", "interrogation"]
                        .some(prefix => ch.name.startsWith(`${prefix}-${id}`))
                );
                if (!ticketChannel) throw new ProgressFailure(`Ticket #${id} does not exist.`);
            });
            await progress.runStep(1, () => ticketChannel.permissionOverwrites.edit(user.id, {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true
            }));
            await progress.complete(`👤 Added **${user.tag}** to ticket #${id}.`);
        } catch (error) {
            if (error instanceof ProgressFailure) return;
            throw error;
        }
    }
};
