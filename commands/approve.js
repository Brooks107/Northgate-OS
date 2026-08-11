const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType
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
        const userId = ticketChannel.topic;
        let user = null;

        if (userId) {
            user = await interaction.client.users.fetch(userId).catch(() => null);
        }

        // -------------------------------------------------
        // SEND ACCEPTANCE MESSAGE IN ORIGINAL TICKET
        // -------------------------------------------------
        await ticketChannel.send({
            content: `✅ **Your commission has been accepted!**\n${message}`
        });

        // -------------------------------------------------
        // SEND DM TO USER (optional)
        // -------------------------------------------------
        if (user) {
            user.send({
                content: `✅ Your commission ticket (#${id}) has been **approved**.\n${message}`
            }).catch(() => {});
        }

        // -------------------------------------------------
        // CREATE THREAD IN ACTIVE COMMISSIONS CHANNEL
        // -------------------------------------------------
        const activeCommissionsChannelId =
            config?.channels?.activeCommissionsChannelId ??
            config?.channels?.activeCommissionsChannel ??
            config?.activeCommissionsChannelId ??
            config?.activeCommissionsChannel;

        const activeCommissionsChannel = activeCommissionsChannelId
            ? await interaction.guild.channels.fetch(activeCommissionsChannelId).catch(() => null)
            : null;

        if (!activeCommissionsChannel) {
            return interaction.editReply("⚠️ Active commissions channel is missing from config or cannot be accessed.");
        }

        if (activeCommissionsChannel.type !== ChannelType.GuildForum) {
            return interaction.editReply("⚠️ Active commissions channel must be a forum channel.");
        }

        const thread = await activeCommissionsChannel.threads.create({
            name: `commission-${id}`,
            autoArchiveDuration: 10080,
            reason: "Commission approved"
        });

        // -------------------------------------------------
        // BUTTON: COMPLETE
        // -------------------------------------------------
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`commission_complete_${id}`)
                .setLabel("Complete")
                .setStyle(ButtonStyle.Success)
        );

        await thread.send({
            content: `📝 **Commission #${id} is now active.**\nClick below when the commission is complete.`,
            components: [row]
        });

        // -------------------------------------------------
        // CLEAN UP ACTIVE ID
        // -------------------------------------------------
        client.activeTicketIds.delete(id);

        // -------------------------------------------------
        // CONFIRM TO STAFF
        // -------------------------------------------------
        await interaction.editReply(`✅ Commission ticket #${id} approved. Thread created in active commissions.`);
    }
};
