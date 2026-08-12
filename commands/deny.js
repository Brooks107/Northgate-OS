const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");

const ticketTopic = require("../ticket-topic");

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
        ),

    async execute(interaction, client, config) {
        const isAuthorized = config.commissionticketaccess?.some(roleId =>
            interaction.member?.roles?.cache?.has(roleId)
        );

        if (!isAuthorized) {
            return interaction.reply({
                content: "❌ You are not authorized to use `/deny`.",
                ephemeral: true
            });
        }

        // 🔒 GLOBAL LOCK CHECK
        if (config.locked) {
            return interaction.reply({
                content: "🚫 NorthGate OS is currently **locked**. Command `/deny` cannot be used.",
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const id = interaction.options.getInteger("id");
        const reason = interaction.options.getString("reason");

        // -------------------------------------------------
        // FIND COMMISSION TICKET ONLY
        // -------------------------------------------------
        const ticketChannel = interaction.guild.channels.cache.find(
            ch => ch.name.startsWith(`commission-${id}`)
        );

        if (!ticketChannel) {
            return interaction.editReply(`❌ Commission ticket #${id} does not exist.`);
        }

        // -------------------------------------------------
        // GET THE TICKET OPENER FROM THE CHANNEL TOPIC
        // -------------------------------------------------
        const { ownerId } = ticketTopic.parse(ticketChannel.topic);

        let user = null;
        if (ownerId) {
            user = await interaction.client.users.fetch(ownerId).catch(() => null);
        }

        // -------------------------------------------------
        // POST DENIAL MESSAGE IN THE TICKET
        // -------------------------------------------------
        await ticketChannel.send({
            content: `❌ **Your commission has been denied.**\n**Reason:** ${reason}`
        });

        // -------------------------------------------------
        // SEND DM TO USER
        // -------------------------------------------------
        if (user) {
            user.send({
                content: `❌ Your commission ticket (#${id}) has been **denied**.\n**Reason:** ${reason}`
            }).catch(() => {});
        }

        // -------------------------------------------------
        // CONFIRM TO STAFF
        // -------------------------------------------------
        // The ticket ID stays reserved while commission-<id>-<user> still exists;
        // /close frees it when the channel is actually deleted.
        await interaction.editReply(`❌ Commission ticket #${id} denied. A denial message has been posted in the ticket.`);
    }
};
