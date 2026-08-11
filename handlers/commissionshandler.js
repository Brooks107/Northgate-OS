const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    ChannelType,
    PermissionFlagsBits,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");

module.exports = {
    async execute(interaction, client, config) {

        // -------------------------------------------------
        // COMMISSION BUTTON → OPEN MODAL (unless locked)
        // -------------------------------------------------
        if (interaction.isButton() && interaction.customId === "ticket_commission") {

            // 🔒 COMMISSION LOCK CHECK
            if (config.commissionLocked) {
                return interaction.reply({
                    content: "🚫 Commission requests are currently locked.",
                    flags: 64
                });
            }

            const modal = new ModalBuilder()
                .setCustomId("modal_ticket_commission")
                .setTitle("Commission Request");

            const q1 = new TextInputBuilder()
                .setCustomId("map_size")
                .setLabel("How big do you want the map?")
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const q2 = new TextInputBuilder()
                .setCustomId("payment_amount")
                .setLabel("How much can you pay (no tax)?")
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const q3 = new TextInputBuilder()
                .setCustomId("wait_time")
                .setLabel("How long can you wait for the end result?")
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const q4 = new TextInputBuilder()
                .setCustomId("quality_level")
                .setLabel("How good do you want the quality?")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);

            return interaction.showModal(
                modal.addComponents(
                    new ActionRowBuilder().addComponents(q1),
                    new ActionRowBuilder().addComponents(q2),
                    new ActionRowBuilder().addComponents(q3),
                    new ActionRowBuilder().addComponents(q4)
                )
            );
        }

        // -------------------------------------------------
        // CLAIM BUTTON
        // -------------------------------------------------
        if (interaction.isButton() && interaction.customId === "ticket_claim") {

            const isStaff = config.supportTeamRoles.some(roleId =>
                interaction.member.roles.cache.has(roleId)
            );

            if (!isStaff) {
                return interaction.reply({
                    content: "❌ Only staff can claim this ticket.",
                    flags: 64
                });
            }

            await interaction.deferReply({ flags: 64 });

            const message = interaction.message;

            const newRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("ticket_claim")
                    .setLabel(`Claimed by ${interaction.user.username}`)
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(true),

                new ButtonBuilder()
                    .setCustomId("ticket_close")
                    .setLabel("🔒 Close Ticket")
                    .setStyle(ButtonStyle.Danger)
            );

            await message.edit({ components: [newRow] });

            return interaction.editReply("📝 You have claimed this ticket.");
        }

        // -------------------------------------------------
        // CLOSE BUTTON → FREE ID + SAFE DELETE
        // -------------------------------------------------
        if (interaction.isButton() && interaction.customId === "ticket_close") {

            const match = interaction.channel.name.match(/^commission-(\d+)-/);
            if (match) {
                const id = parseInt(match[1]);
                client.activeTicketIds.delete(id);
            }

            await interaction.reply({
                content: "🔒 Closing ticket...",
                flags: 64
            });

            setTimeout(() => {
                interaction.guild.channels.delete(interaction.channel.id).catch(() => {});
            }, 500);
        }

        // -------------------------------------------------
        // COMMISSION MODAL SUBMISSION
        // -------------------------------------------------
        if (interaction.isModalSubmit() && interaction.customId === "modal_ticket_commission") {

            // 🔒 COMMISSION LOCK CHECK (failsafe)
            if (config.commissionLocked) {
                return interaction.reply({
                    content: "🚫 Commission requests are currently locked.",
                    flags: 64
                });
            }

            const categoryId = config.commissionsticketcategory;
            const prefix = "commission";

            const ticketId = client.getNextTicketId();

            if (!ticketId) {
                return interaction.reply({
                    content: "❌ All 20 ticket slots are currently in use. Please wait for a ticket to close.",
                    flags: 64
                });
            }

            client.activeTicketIds.add(ticketId);

            const mapSize = interaction.fields.getTextInputValue("map_size");
            const payment = interaction.fields.getTextInputValue("payment_amount");
            const waitTime = interaction.fields.getTextInputValue("wait_time");
            const quality = interaction.fields.getTextInputValue("quality_level");

            const ticketChannel = await interaction.guild.channels.create({
                name: `${prefix}-${ticketId}-${interaction.user.username}`,
                type: ChannelType.GuildText,
                parent: categoryId,
                permissionOverwrites: [
                    {
                        id: interaction.guild.id,
                        deny: [PermissionFlagsBits.ViewChannel]
                    },
                    {
                        id: interaction.user.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory
                        ]
                    },
                    ...config.commissionticketaccess.map(roleId => ({
                        id: roleId,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory
                        ]
                    })),
                    ...config.supportTeamRoles.map(roleId => ({
                        id: roleId,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory
                        ]
                    })),
                    {
                        id: client.user.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory,
                            PermissionFlagsBits.ManageChannels
                        ]
                    }
                ]
            });

            const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("ticket_claim")
                    .setLabel("📝 Claim Ticket")
                    .setStyle(ButtonStyle.Primary),

                new ButtonBuilder()
                    .setCustomId("ticket_close")
                    .setLabel("🔒 Close Ticket")
                    .setStyle(ButtonStyle.Danger)
            );

            await ticketChannel.send({
                embeds: [
                    {
                        title: `🛠️ Commission Request #${ticketId}`,
                        description: "A new commission ticket has been created.",
                        color: 0x00aaff,
                        fields: [
                            { name: "👤 User", value: interaction.user.tag, inline: true },
                            { name: "📏 Map Size", value: mapSize },
                            { name: "💵 Payment (No Tax)", value: payment },
                            { name: "⏳ Wait Time", value: waitTime },
                            { name: "🎨 Quality Level", value: quality }
                        ]
                    }
                ],
                components: [buttons]
            });

            return interaction.reply({
                content: `✅ Your commission ticket (#${ticketId}) has been created: <#${ticketChannel.id}>`,
                flags: 64
            });
        }
    }
};
