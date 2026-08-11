const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    MessageFlags
} = require("discord.js");

const ticketTopic = require("../ticket-topic");

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
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const id = interaction.options.getInteger("id");
        const commissioner = interaction.options.getString("commissioner");
        const payment = interaction.options.getString("payment");
        const message = interaction.options.getString("message") || "Your commission has been approved.";

        // -------------------------------------------------
        // FIND COMMISSION TICKET CHANNEL
        // -------------------------------------------------
        const ticketChannel = interaction.guild.channels.cache.find(
            ch => ch.name.startsWith(`commission-${id}-`)
        );

        if (!ticketChannel) {
            return interaction.editReply(`❌ Commission ticket #${id} does not exist.`);
        }

        // -------------------------------------------------
        // GET USER FROM CHANNEL TOPIC
        // -------------------------------------------------
        // The topic holds "owner:<id>" (plus "claimed:<id>" once staff claim it),
        // so it has to be parsed -- the raw topic is never a bare user id.
        const { ownerId } = ticketTopic.parse(ticketChannel.topic);
        let user = null;

        if (ownerId) {
            user = await interaction.client.users.fetch(ownerId).catch(() => null);
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
        // RESOLVE ACTIVE COMMISSIONS CHANNEL
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

        // -------------------------------------------------
        // BUTTON ROW
        // -------------------------------------------------
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`commission_complete_${id}`)
                .setLabel("Complete")
                .setStyle(ButtonStyle.Success)
        );

        // -------------------------------------------------
        // CREATE FORUM THREAD WITH EMBED
        // -------------------------------------------------
        const thread = await activeCommissionsChannel.threads.create({
            name: `commission-${id}`,
            autoArchiveDuration: 10080,
            reason: "Commission approved",
            message: {
                content: `📝 **Commission #${id} is now active.**`,
                embeds: [
                    {
                        title: `Commission #${id} - ${commissioner}`,
                        description: `Commission approved for **${payment}**.\n\n${message}`,
                        color: 0x00ff00
                    }
                ],
                components: [row]
            }
        });

        // -------------------------------------------------
        // CONFIRM TO STAFF
        // -------------------------------------------------
        // The ticket ID stays reserved: commission-<id>-<user> still exists, and
        // releasing it now would let a new ticket take the same number, giving two
        // channels one ID. /close frees it when the channel is actually deleted.
        await interaction.editReply(`✅ Commission ticket #${id} approved.`);
    }
};
