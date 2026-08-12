const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    ChannelType,
    PermissionFlagsBits,
    ButtonBuilder,
    ButtonStyle,
    AttachmentBuilder,
    MessageFlags
} = require("discord.js");

const ticketTopic = require("../ticket-topic");

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
                    flags: MessageFlags.Ephemeral
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
        if (
            interaction.isButton() &&
            (interaction.customId === "ticket_claim" || interaction.customId === "commission_claim")
        ) {

            const isStaff = config.supportTeamRoles.some(roleId =>
                interaction.member?.roles?.cache?.has(roleId)
            );

            if (!isStaff) {
                return interaction.reply({
                    content: "❌ Only staff can claim this ticket.",
                    flags: MessageFlags.Ephemeral
                });
            }

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const message = interaction.message;

            const newRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("commission_claim")
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
        if (
            interaction.isButton() &&
            (interaction.customId === "ticket_close" || interaction.customId === "support_close")
        ) {

            const channel = interaction.channel;

            const match = channel.name.match(/^commission-(\d+)-/);
            if (match) {
                const id = parseInt(match[1]);
                client.activeTicketIds.delete(id);
            }

            await interaction.reply({
                content: "🔒 Ticket closed. Saving transcript...",
                flags: MessageFlags.Ephemeral
            });

            await saveTranscript(channel, interaction.user, config);

            setTimeout(() => {
                interaction.guild.channels.delete(channel.id).catch(() => {});
            }, 3000);
        }

        // -------------------------------------------------
        // COMPLETE BUTTON (posted by /approve in the active-commission thread)
        // -------------------------------------------------
        if (interaction.isButton() && interaction.customId.startsWith("commission_complete_")) {

            const isStaff = config.supportTeamRoles.some(roleId =>
                interaction.member?.roles?.cache?.has(roleId)
            );

            if (!isStaff) {
                return interaction.reply({
                    content: "❌ Only staff can mark a commission as complete.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const id = interaction.customId.slice("commission_complete_".length);

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const completedRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(interaction.customId)
                    .setLabel(`Completed by ${interaction.user.username}`)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true)
            );

            await interaction.message.edit({ components: [completedRow] });

            await interaction.channel.send({
                content: `✅ **Commission #${id} marked complete** by ${interaction.user}.`,
                allowedMentions: { parse: [] }
            });

            // Threads are only archivable by their creator or someone with
            // ManageThreads; never let a missing permission fail the whole action.
            if (interaction.channel.isThread()) {
                await interaction.channel.setArchived(true).catch(() => {});
            }

            return interaction.editReply(`✅ Commission #${id} marked as complete.`);
        }

        // -------------------------------------------------
        // COMMISSION MODAL SUBMISSION
        // -------------------------------------------------
        if (interaction.isModalSubmit() && interaction.customId === "modal_ticket_commission") {

            // 🔒 COMMISSION LOCK CHECK (failsafe)
            if (config.commissionLocked) {
                return interaction.reply({
                    content: "🚫 Commission requests are currently locked.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const categoryId = config.commissionsticketcategory;
            const prefix = "commission";

            const ticketId = client.getNextTicketId();

            if (!ticketId) {
                return interaction.reply({
                    content: "❌ All 20 ticket slots are currently in use. Please wait for a ticket to close.",
                    flags: MessageFlags.Ephemeral
                });
            }

            client.activeTicketIds.add(ticketId);

            const mapSize = interaction.fields.getTextInputValue("map_size");
            const payment = interaction.fields.getTextInputValue("payment_amount");
            const waitTime = interaction.fields.getTextInputValue("wait_time");
            const quality = interaction.fields.getTextInputValue("quality_level");

            let ticketChannel;

            try {
                ticketChannel = await interaction.guild.channels.create({
                    name: `${prefix}-${ticketId}-${interaction.user.username}`,
                    type: ChannelType.GuildText,
                    parent: categoryId,
                    // Records who opened the ticket so /approve and /deny can DM them.
                    topic: ticketTopic.build({ ownerId: interaction.user.id }),
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
            } catch (err) {
                // The slot was reserved before the API call; hand it back, or a
                // failed attempt burns one of the 20 ticket IDs permanently.
                client.activeTicketIds.delete(ticketId);
                throw err;
            }

            const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("commission_claim")
                    .setLabel("📝 Claim Ticket")
                    .setStyle(ButtonStyle.Primary),

                new ButtonBuilder()
                    .setCustomId("ticket_close")
                    .setLabel("🔒 Close Ticket")
                    .setStyle(ButtonStyle.Danger)
            );

            await ticketChannel.send({
                content: "<@&1535764411510161519> <@&1517982021782339684> <@&1535764196459806850>",
                allowedmentions: { roles: ["1535764411510161519", "1517982021782339684", "1535764196459806850"] },
                embeds: [
                    {
                        title: `🛠️ Commission Request #${ticketId}`,
                        description: "A new commission ticket has been created.",
                        color: 0x00aaff,
                        fields: [
                            { name: "👤 User", value: interaction.user.tag, inline: true },
                            { name: "📏 Map Size", value: mapSize,  inline: true },
                            { name: "💵 Payment (No Tax)", value: payment, inline: true },
                            { name: "⏳ Wait Time", value: waitTime, inline: true },
                            { name: "🎨 Quality Level", value: quality, inline: true }
                        ]
                    }
                ],
                components: [buttons]
            });

            return interaction.reply({
                content: `✅ Your commission ticket (#${ticketId}) has been created: <#${ticketChannel.id}>`,
                flags: MessageFlags.Ephemeral
            });
        }
    }
};

async function saveTranscript(channel, closedBy, config) {
    try {
        const all = [];
        let lastId = null;

        while (true) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;

            const batch = await channel.messages.fetch(options);
            if (batch.size === 0) break;

            all.push(...batch.values());
            lastId = batch.last().id;
        }

        const messages = all.reverse();

        const lines = [];
        lines.push(`Transcript for #${channel.name}`);
        lines.push(`Closed by: ${closedBy.tag}`);
        lines.push(`Saved: ${new Date().toLocaleString()}`);
        lines.push(`Messages: ${messages.length}`);
        lines.push("=".repeat(50));
        lines.push("");

        for (const msg of messages) {
            const time = msg.createdAt.toLocaleString();
            lines.push(`[${time}] ${msg.author.tag}: ${msg.content || "(no text)"}`);

            for (const att of msg.attachments.values()) {
                lines.push(`    [file] ${att.name}: ${att.url}`);
            }
            for (const emb of msg.embeds) {
                lines.push(`    [embed] ${emb.title || ""} ${emb.description || ""}`);
            }
        }

        const file = new AttachmentBuilder(
            Buffer.from(lines.join("\n"), "utf-8"),
            { name: `${channel.name}-transcript.txt` }
        );

        const transcriptChannelId = config?.channels?.transcriptschannelid || config?.transcriptschannelid;
        const logChannel = transcriptChannelId
            ? await channel.guild.channels.fetch(transcriptChannelId).catch(() => null)
            : null;

        if (!logChannel) {
            console.error("Transcript failed: transcriptschannelid is wrong or the bot can't see that channel.");
            return;
        }

        await logChannel.send({
            content: `📄 Transcript for **${channel.name}** (closed by ${closedBy.tag})`,
            files: [file],
            allowedMentions: { parse: [] }
        });

    } catch (err) {
        console.error("Transcript failed:", err);
    }
}
