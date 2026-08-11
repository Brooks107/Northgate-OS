const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags
} = require("discord.js");

const ticketTopic = require("../ticket-topic");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("claim")
        .setDescription("Claim a commission ticket by ID.")
        .addIntegerOption(option =>
            option.setName("id")
                .setDescription("The commission ticket ID to claim")
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction, client, config) {

        // 🔒 GLOBAL LOCK CHECK
        if (config.locked) {
            return interaction.reply({
                content: "🚫 NorthGate OS is currently **locked**. Command `/claim` cannot be used.",
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const id = interaction.options.getInteger("id");

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
        // CHECK IF ALREADY CLAIMED
        // -------------------------------------------------
        const topic = ticketTopic.parse(ticketChannel.topic);

        if (topic.claimedBy) {
            return interaction.editReply(`❌ Ticket #${id} is already claimed by <@${topic.claimedBy}>.`);
        }

        // -------------------------------------------------
        // FETCH TICKET MESSAGE
        // -------------------------------------------------
        const messages = await ticketChannel.messages.fetch({ limit: 10 });
        const ticketMessage = messages.find(m => m.author.id === client.user.id);

        if (!ticketMessage) {
            return interaction.editReply("❌ Could not find the ticket message.");
        }

        // -------------------------------------------------
        // UPDATE BUTTONS (remove claim button)
        // -------------------------------------------------
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("ticket_close")
                .setLabel("🔒 Close Ticket")
                .setStyle(ButtonStyle.Danger)
        );

        await ticketMessage.edit({ components: [row] });

        // -------------------------------------------------
        // STORE CLAIMER IN CHANNEL TOPIC
        // -------------------------------------------------
        // Rebuilt from the parsed topic so claiming does not wipe the owner id
        // that /approve and /deny need to DM the person who opened the ticket.
        await ticketChannel.setTopic(
            ticketTopic.build({ ownerId: topic.ownerId, claimedBy: interaction.user.id })
        );

        // -------------------------------------------------
        // CONFIRM TO STAFF
        // -------------------------------------------------
        await interaction.editReply(`📝 You have claimed commission ticket #${id}.`);

        // -------------------------------------------------
        // KEEP ACTIVE ID (ticket still open)
        // -------------------------------------------------
    }
};
