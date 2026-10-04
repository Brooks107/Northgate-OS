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
const {
    ProgressFailure,
    createInteractionProgress
} = require("../utils/progress-embed");

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
    async createTicket(interaction, client, config, user, progress) {
        await progress.runStep(0, () => client.refreshActiveTicketIds(interaction.guild));
        const ticketId = client.getNextTicketId();
        if (!ticketId) {
            throw new ProgressFailure("All 20 ticket slots are currently in use. Please wait for a ticket to close.");
        }

        client.activeTicketIds.add(ticketId);
        const operationsRoles = getRoleIds(config.operationsroles);
        let ticketChannel;

        try {
            ticketChannel = await progress.runStep(1, () => interaction.guild.channels.create({
                name: `interrogation-${ticketId}`,
                type: ChannelType.GuildText,
                parent: config.interrogationticketcategory,
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
            }));
        } catch (error) {
            client.activeTicketIds.delete(ticketId);
            throw error;
        }

        await progress.runStep(2, () => ticketChannel.send({
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
        }));

        await progress.runStep(3, () => ticketTracker.createTicketEmbed(ticketChannel, {
                id: ticketId,
                title: "Interrogation Ticket",
                userId: user.id,
                description: `Interrogation ticket opened for ${user.tag}.`,
                createdAt: new Date().toLocaleString()
        }, client, config));

        await progress.runStep(4, async () => {
            if (typeof client.notifyAdminPanelRefresh === "function") {
                await client.notifyAdminPanelRefresh();
            }
        });
        await progress.complete(`✅ Interrogation ticket (#${ticketId}) created: <#${ticketChannel.id}>`);

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
            const ticketState = ticketTopic.parse(interaction.channel.topic);
            if (ticketState.claimedBy) {
                return interaction.reply({
                    content: `❌ This ticket is already claimed by <@${ticketState.claimedBy}>.`,
                    flags: MessageFlags.Ephemeral
                });
            }
            const progress = createInteractionProgress(interaction, "Claiming interrogation ticket", [
                "Update the ticket claim button",
                "Save the claim to the channel topic",
                "Sync the ticket tracker"
            ]);
            await progress.start();

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
            await progress.runStep(0, () => interaction.message.edit({ components: [claimedRow] }));
            await progress.runStep(1, () => interaction.channel.setTopic(ticketTopic.build({
                ownerId: ticketState.ownerId,
                claimedBy: interaction.user.id
            })));
            await progress.runStep(2, () => ticketTracker.syncTicket(interaction.channel, {
                type: "claimed",
                status: `🟡 Claimed by ${interaction.user.tag}`,
                userId: interaction.user.id
            }));
            await progress.complete("📝 You have claimed this interrogation ticket.");
            return;
        }

        if (interaction.customId === "intero_close") {
            const channel = interaction.channel;
            const match = channel.name.match(/^interrogation-(\d+)/);
            if (match) client.activeTicketIds.delete(Number(match[1]));

            const progress = createInteractionProgress(interaction, `Closing #${channel.name}`, [
                "Save the ticket transcript",
                "Remove the ticket from tracking",
                "Schedule ticket channel deletion"
            ]);
            await progress.start();
            const transcriptSaved = await progress.runStep(0, () =>
                saveTranscript(channel, interaction.user, config)
            );
            if (!transcriptSaved) await progress.warnStep(0);
            await progress.runStep(1, () => ticketTracker.removeTracking(channel));
            await progress.runStep(2, async () => {
                setTimeout(() => channel.delete().catch(error => {
                    console.error(`[interrogation-close] failed to delete ${channel.name}:`, error);
                }), 3000);
            });
            await progress.complete(
                `🔒 Ticket #${channel.name} closed. ` +
                (transcriptSaved ? "Transcript saved." : "⚠️ Transcript could not be saved; check the bot logs.") +
                " Channel deletion is queued."
            );
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
    if (!transcriptChannel) {
        console.error(`[interrogation-transcript] transcript channel is unavailable for ${channel.name}.`);
        return false;
    }

    await transcriptChannel.send({
        content: `📄 Transcript for **${channel.name}**`,
        files: [new AttachmentBuilder(Buffer.from(lines.join("\n"), "utf8"), {
            name: `${channel.name}-transcript.txt`
        })]
    });
    return true;
}
