const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder
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
            option.setName("commissioner")
                .setDescription("Person requesting the commission")
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName("payment")
                .setDescription("Payment agreed for the commission")
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
        const commissioner = interaction.options.getString("commissioner");
        const payment = interaction.options.getString("payment");
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
        const activeCommissionsChannel = interaction.guild.channels.cache.get(config.channels.activeCommissionsChannelId);

        if (!activeCommissionsChannel) {
            return interaction.editReply("⚠️ Active commissions channel is missing from config.");
        }

        const thread = await activeCommissionsChannel.threads.create({
            name: `commission-${id}`,
            autoArchiveDuration: 10080, // 7 days
            reason: "Commission approved"
        });

        // -------------------------------------------------
        // EMBED FOR COMMISSION DETAILS
        // -------------------------------------------------
        const channelId = config.channels?.activeCommissionsChannelId ?? config.activeCommissionsChannelId;
        const activeCommissionsChannel = interaction.guild.channels.cache.get(channelId);
        const embed = new EmbedBuilder()
            .setTitle(`Commission #${id} Details`)
            .setColor("Green")
            .addFields(
                { name: "Commissioner", value: commissioner, inline: true },
                { name: "Payment Decided", value: payment, inline: true }
            )
            .setTimestamp();

        // -------------------------------------------------
        // BUTTON: COMPLETE
        // -------------------------------------------------
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`commission_complete_${id}`)
                .setLabel("Complete")
                .setStyle(ButtonStyle.Success)
        );

        if (!activeCommissionsChannel.isThread()) {
            await thread.send({
                content: `📝 **Commission #${id} is now active.**`,
                embeds: [embed],
                components: [row]
            });
        }

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
