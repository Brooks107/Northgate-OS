const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("close")
        .setDescription("Close a ticket by ID.")
        .addIntegerOption(option =>
            option.setName("id")
                .setDescription("The ticket ID to close")
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction, client, config) {

        // 🔒 GLOBAL LOCK CHECK
        if (config.locked) {
            return interaction.reply({
                content: '🚫 NorthGate OS is currently **locked**. Command `/close` cannot be used.',
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const id = interaction.options.getInteger("id");

        const ticketChannel = interaction.guild.channels.cache.find(
            ch =>
                ch.name.startsWith(`commission-${id}-`) ||
                ch.name.startsWith(`support-${id}-`) ||
                ch.name.startsWith(`appeal-${id}-`)
        );

        if (!ticketChannel) {
            return interaction.editReply(`❌ Ticket #${id} does not exist.`);
        }

        if (client.activeTicketIds.has(id)) {
            client.activeTicketIds.delete(id);
        }

        await interaction.editReply(`🔒 Ticket #${id} closed.`);

        setTimeout(() => {
            interaction.guild.channels.delete(ticketChannel.id).catch(() => {});
        }, 1000);
    }
};
