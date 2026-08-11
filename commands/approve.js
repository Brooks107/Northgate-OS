const {
    SlashCommandBuilder,
    PermissionFlagsBits
} = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("approve")
        .setDescription("Approve a commission ticket by ID.")
        .addIntegerOption(option =>
            option.setName("id")
                .setDescription("The commission ticket ID to approve")
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName("message")
                .setDescription("Optional approval message")
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction, client, config) {

        // 🔒 GLOBAL LOCK CHECK
        if (config.locked) {
            return interaction.reply({
                content: "🚫 NorthGate OS is currently **locked**. Command `/approve` cannot be used.",
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        const id = interaction.options.getInteger("id");
        const message = interaction.options.getString("message") || "Your commission has been approved.";

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
                content: `✅ Your commission ticket (#${id}) has been **approved**.\n${message}`
            }).catch(() => {});
        }

        // -------------------------------------------------
        // CLEAN UP ACTIVE ID
        // -------------------------------------------------
        client.activeTicketIds.delete(id);

        // -------------------------------------------------
        // CONFIRM TO STAFF
        // -------------------------------------------------
        await interaction.editReply(`✅ Commission ticket #${id} approved.`);

        // -------------------------------------------------
        // SAFE DELETE
        // -------------------------------------------------
        setTimeout(() => {
            interaction.guild.channels.delete(ticketChannel.id).catch(() => {});
        }, 1000);
    }
};
