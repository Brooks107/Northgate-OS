const {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    EmbedBuilder,
    MessageFlags,
    PermissionFlagsBits
} = require("discord.js");

const ticketTopic = require("../ticket-topic");
const ticketTracker = require("../ticket-tracker");

function getRoleIds(value) {
    return Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];
}

function ticketButtons() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("intero_claim")
            .setLabel("📝 Claim Ticket")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId("intero_close")
            .setLabel("🔒 Close Ticket")
            .setStyle(ButtonStyle.Danger)
    );
}

module.exports = {
    async createTicket(interaction, client, config, user) {
        client.refreshActiveTicketIds(interaction.guild);
        const ticketId = client.getNextTicketId();
        if (!ticketId) {
            return { error: "❌ All 20 ticket slots are currently in use. Please wait for a ticket to close." };
        }

        client.activeTicketIds.add(ticketId);
        const operationsRoles = getRoleIds(config.operationsroles);
        let ticketChannel;

        try {
            ticketChannel = await interaction.guild.channels.create({
                name: `interrogation-${ticketId}`,
                type: ChannelType.GuildText,
                parent: config.generalticketcategory,
                topic: ticketTopic.build({ ownerId: user.id }),
                permissionOverwrites: [
                    {
                        id: interaction.guild.id,
                        deny: [PermissionFlagsBits.ViewChannel]
                    },
                    {
                        id: user.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory
                        ]
                    },
                    ...[...new Set(operationsRoles)].map(roleId => ({
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

            await ticketChannel.send({
                content: `${user}`,
                allowedMentions: { users: [user.id] },
                embeds: [new EmbedBuilder()
                    .setColor(0x8e44ad)
                    .setTitle(`New interrogation ticket opened #${ticketId}`)
                    .setDescription(
                        `Welcome ${user}, a member of the Human Resources team has opened this ticket with you, please wait until they respond.`
                    )
                    .setTimestamp()],
                components: [ticketButtons()]
            });

            await ticketTracker.createTicketEmbed(ticketChannel, {
                id: ticketId,
                title: "Interrogation Ticket",
                userId: user.id,
                description: `Interrogation ticket opened for ${user.tag}.`,
                createdAt: new Date().toLocaleString()
            }, client, config);
        } catch (error) {
            client.activeTicketIds.delete(ticketId);
            throw error;
        }

        if (typeof client.notifyAdminPanelRefresh === "function") {
            await client.notifyAdminPanelRefresh();
        }

        return { ticketId, ticketChannel };
    },

    async execute(interaction, client, config) {
        const operationsRoles = getRoleIds(config.operationsroles);
        const isOperationsOrAdministrator = operationsRoles.some(roleId =>
            interaction.member?.roles?.cache?.has(roleId)
        ) || interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);

        if (!isOperationsOrAdministrator) {
            return interaction.reply({
                content: "❌ Only Operations staff or Administrators can manage this ticket.",
                flags: MessageFlags.Ephemeral
            });
        }

        if (interaction.customId === "intero_claim") {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const ticketState = ticketTopic.parse(interaction.channel.topic);
            if (ticketState.claimedBy) {
                return interaction.editReply(`❌ This ticket is already claimed by <@${ticketState.claimedBy}>.`);
            }

            const claimedRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("intero_claim")
                    .setLabel(`Claimed by ${interaction.user.username}`)
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId("intero_close")
                    .setLabel("🔒 Close Ticket")
                    .setStyle(ButtonStyle.Danger)
            );
            await interaction.message.edit({ components: [claimedRow] });
            await interaction.channel.setTopic(ticketTopic.build({
                ownerId: ticketState.ownerId,
                claimedBy: interaction.user.id
            }));
            await ticketTracker.syncTicket(interaction.channel, {
                type: "claimed",
                status: `🟡 Claimed by ${interaction.user.tag}`,
                userId: interaction.user.id
            });
            return interaction.editReply("📝 You have claimed this interrogation ticket.");
        }

        if (interaction.customId === "intero_close") {
            const channel = interaction.channel;
            const match = channel.name.match(/^interrogation-(\d+)/);
            if (match) client.activeTicketIds.delete(Number(match[1]));

            await interaction.reply({
                content: "🔒 Ticket closed. Saving transcript...",
                flags: MessageFlags.Ephemeral
            });
            await saveTranscript(channel, interaction.user, config);
            await ticketTracker.removeTracking(channel);
            setTimeout(() => channel.delete().catch(() => {}), 3000);
        }
    }
};

async function saveTranscript(channel, closedBy, config) {
    const messages = [];
    let lastId = null;

    while (true) {
        const options = { limit: 100 };
        if (lastId) options.before = lastId;
        const batch = await channel.messages.fetch(options);
        if (batch.size === 0) break;
        messages.push(...batch.values());
        lastId = batch.last().id;
    }

    const lines = [
        `Transcript for #${channel.name}`,
        `Closed by: ${closedBy.tag}`,
        `Saved: ${new Date().toLocaleString()}`,
        `Messages: ${messages.length}`,
        "=".repeat(50),
        ""
    ];

    for (const message of messages.reverse()) {
        lines.push(`[${message.createdAt.toLocaleString()}] ${message.author.tag}: ${message.content || "(no text)"}`);
        for (const attachment of message.attachments.values()) {
            lines.push(`    [file] ${attachment.name}: ${attachment.url}`);
        }
        for (const embed of message.embeds) {
            lines.push(`    [embed] ${embed.title || ""} ${embed.description || ""}`);
        }
    }

    const transcriptChannelId = config?.channels?.transcriptschannelid || config?.transcriptschannelid;
    const transcriptChannel = transcriptChannelId
        ? await channel.guild.channels.fetch(transcriptChannelId).catch(() => null)
        : null;
    if (!transcriptChannel) return;

    await transcriptChannel.send({
        content: `📄 Transcript for **${channel.name}**`,
        files: [new AttachmentBuilder(Buffer.from(lines.join("\n"), "utf8"), {
            name: `${channel.name}-transcript.txt`
        })]
    });
}
