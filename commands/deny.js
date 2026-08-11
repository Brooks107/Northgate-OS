const {
    SlashCommandBuilder,
    PermissionFlagsBits
} = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("deny")
        .setDescription("Deny a commission ticket by ID.")
        .addIntegerOption(option =>
            option.setName("id")
                .setDescription("The commission ticket ID to deny")
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName("reason")
                .setDescription("Reason for denial")
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction, client, config) {

        // 🔒 GLOBAL LOCK CHECK
        if (config.locked) {
            return interaction.reply({
                content: "🚫 NorthGate OS is currently **locked**. Command `/deny` cannot be used.",
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        const id = interaction.options.getInteger("id");
        const reason = interaction.options.getString("reason");

        // -------------------------------------------------
        // FIND COMMISSION TICKET ONLY
        // -------------------------------------------------
        const ticketChannel = interaction.guild.channels.cache.find(
            ch => ch.name.startsWith(`commission-${id}-`)
        );

        if (!ticketChannel) {
            return interaction.editReply(`❌ Commission ticket #${id} does not exist.`);
        }

        // -------------------------------------------------
        // GET USER ID FROM CHANNEL TOPIC
        // -------------------------------------------------
        const userId = ticketChannel.topic; // You store user ID here

        let user = null;
        if (userId) {
            user = await interaction.client.users.fetch(userId).catch(() => null);
        }

        // -------------------------------------------------
        // SEND DM TO USER
        // -------------------------------------------------
        if (user) {
            user.send({
                content: `❌ Your commission ticket (#${id}) has been **denied**.\n**Reason:** ${reason}`
            }).catch(() => {});
        }

        // -------------------------------------------------
        // CLEAN UP ACTIVE ID
        // -------------------------------------------------
        client.activeTicketIds.delete(id);

        // -------------------------------------------------
        // CONFIRM TO STAFF
        // -------------------------------------------------
        await interaction.editReply(`❌ Commission ticket #${id} denied.`);

        // -------------------------------------------------
        // SAFE DELETE
        // -------------------------------------------------
        setTimeout(() => {
            interaction.guild.channels.delete(ticketChannel.id).catch(() => {});
        }, 1000);
    }
};
