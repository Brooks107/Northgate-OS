const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("claim")
        .setDescription("Claim a commission ticket by ID.")
        .addIntegerOption(option =>
            option.setName("id")
                .setDescription("The commission ticket ID to claim")
                .setRequired(true)
        ),

    async execute(interaction, client, config) {

        // 🔒 GLOBAL LOCK CHECK
        if (config.locked) {
            return interaction.reply({
                content: "🚫 NorthGate OS is currently **locked**. Command `/claim` cannot be used.",
                ephemeral: true
            });
        }

        const isAuthorized = (config.supportTeamRoles?.some(roleId =>
            interaction.member?.roles?.cache?.has(roleId)
        ) || config.commissionticketaccess?.some(roleId =>
            interaction.member?.roles?.cache?.has(roleId)
        ));

        if (!isAuthorized) {
            return interaction.reply({
                content: "❌ You are not authorized to use `/claim`.",
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

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
        if (ticketChannel.topic && ticketChannel.topic.startsWith("claimed:")) {
            const claimerId = ticketChannel.topic.split(":")[1];
            return interaction.editReply(`❌ Ticket #${id} is already claimed by <@${claimerId}>.`);
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
        await ticketChannel.setTopic(`claimed:${interaction.user.id}`);

        // -------------------------------------------------
        // CONFIRM TO STAFF
        // -------------------------------------------------
        await interaction.editReply(`📝 You have claimed commission ticket #${id}.`);

        // -------------------------------------------------
        // KEEP ACTIVE ID (ticket still open)
        // -------------------------------------------------
    }
};
