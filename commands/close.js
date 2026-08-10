const {
    SlashCommandBuilder,
    PermissionFlagsBits
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
        await interaction.deferReply();

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

        client.activeTicketIds.delete(id);

        await interaction.editReply(`🔒 Ticket #${id} closed.`);

        setTimeout(() => {
            ticketChannel.delete().catch(() => {});
        }, 1500);
    }
};
