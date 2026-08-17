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
        // PARTNERSHIP BUTTON → OPEN MODAL
        // -------------------------------------------------
        if (interaction.isButton() && interaction.customId === "ticket_partnership") {
            const modal = new ModalBuilder()
                .setCustomId("modal_ticket_partnership")
                .setTitle("Partnership Request");

            const companyInput = new TextInputBuilder()
                .setCustomId("company_name")
                .setLabel("What is your company or brand name?")
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const ideaInput = new TextInputBuilder()
                .setCustomId("partnership_idea")
                .setLabel("What do you want to partner on?")
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const goalsInput = new TextInputBuilder()
                .setCustomId("partnership_goals")
                .setLabel("What are your goals for the partnership?")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);

            const detailsInput = new TextInputBuilder()
                .setCustomId("partnership_details")
                .setLabel("Tell us more about your proposal")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);

            return interaction.showModal(
                modal.addComponents(
                    new ActionRowBuilder().addComponents(companyInput),
                    new ActionRowBuilder().addComponents(ideaInput),
                    new ActionRowBuilder().addComponents(goalsInput),
                    new ActionRowBuilder().addComponents(detailsInput)
                )
            );
        }

        // -------------------------------------------------
        // CLAIM BUTTON
        // -------------------------------------------------
        if (
            interaction.isButton() &&
            (interaction.customId === "ticket_claim" || interaction.customId === "partnership_claim")
        ) {
            const staffRoleIds = [
                ...(config.supportTeamRoles || []),
                ...(config.operationsroles || [])
            ];

            const isStaff = staffRoleIds.some(roleId =>
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
                    .setCustomId("partnership_claim")
                    .setLabel(`Claimed by ${interaction.user.username}`)
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(true),

                new ButtonBuilder()
                    .setCustomId("partnership_close")
                    .setLabel("🔒 Close Ticket")
                    .setStyle(ButtonStyle.Danger)
            );

            await message.edit({ components: [newRow] });

            return interaction.editReply("📝 You have claimed this ticket.");
        }

        // -------------------------------------------------
        // PARTNERSHIP MODAL → CREATE TICKET
        // -------------------------------------------------
        if (interaction.isModalSubmit() && interaction.customId === "modal_ticket_partnership") {
            const categoryId = config.partnershipticketcategory || config.generalticketcategory || config.reportsticketcategory;
            const prefix = "partnership";
            const ticketId = client.getNextTicketId();

            if (!ticketId) {
                return interaction.reply({
                    content: "❌ All 20 ticket slots are currently in use. Please wait for a ticket to close.",
                    flags: MessageFlags.Ephemeral
                });
            }

            client.activeTicketIds.add(ticketId);

            const companyName = interaction.fields.getTextInputValue("company_name");
            const partnershipIdea = interaction.fields.getTextInputValue("partnership_idea");
            const partnershipGoals = interaction.fields.getTextInputValue("partnership_goals");
            const partnershipDetails = interaction.fields.getTextInputValue("partnership_details");

            let ticketChannel;

            try {
                const allowedRoleIds = [
                    ...(config.supportTeamRoles || []),
                    ...(config.operationsroles || [])
                ];

                ticketChannel = await interaction.guild.channels.create({
                    name: `${prefix}-${ticketId}`,
                    type: ChannelType.GuildText,
                    parent: categoryId,
                    topic: ticketTopic.build({ ownerId: interaction.user.id }),
                    permissionOverwrites: [
                        { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                        {
                            id: interaction.user.id,
                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.SendMessages,
                                PermissionFlagsBits.ReadMessageHistory
                            ]
                        },
                        ...[...new Set(allowedRoleIds)].map(roleId => ({
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
                client.activeTicketIds.delete(ticketId);
                throw err;
            }

            const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("partnership_claim")
                    .setLabel("📝 Claim Ticket")
                    .setStyle(ButtonStyle.Primary),

                new ButtonBuilder()
                    .setCustomId("partnership_close")
                    .setLabel("🔒 Close Ticket")
                    .setStyle(ButtonStyle.Danger)
            );

            await ticketChannel.send({
                content: "<@&1535764412923781270> <@&1536398802783572058> <@&1536398786346225684> <@&1535023189246345277>",
                allowedMentions: { roles: ["1535764412923781270", "1536398802783572058", "1536398786346225684", "1535023189246345277"] },
                embeds: [
                    {
                        title: `🤝 Partnership Ticket #${ticketId}`,
                        description: "A new partnership request has been created.",
                        color: 0x2ecc71,
                        fields: [
                            { name: "👤 User", value: interaction.user.tag, inline: true },
                            { name: "🏢 Company", value: companyName, inline: true },
                            { name: "💡 Idea", value: partnershipIdea, inline: true },
                            { name: "🎯 Goals", value: partnershipGoals },
                            { name: "📝 Details", value: partnershipDetails }
                        ]
                    }
                ],
                components: [buttons]
            });

            return interaction.reply({
                content: `✅ Your partnership ticket (#${ticketId}) has been created: <#${ticketChannel.id}>`,
                flags: MessageFlags.Ephemeral
            });
        }

        // -------------------------------------------------
        // PARTNERSHIP CLOSE BUTTON → TRANSCRIPT + FREE ID + SAFE DELETE
        // -------------------------------------------------
        if (
            interaction.isButton() &&
            (interaction.customId === "partnership_close" || interaction.customId === "ticket_close")
        ) {
            const channel = interaction.channel;
            const match = channel.name.match(/^partnership-(\d+)-/);
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
