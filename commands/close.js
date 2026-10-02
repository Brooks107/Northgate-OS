const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    AttachmentBuilder
} = require("discord.js");

const ticketTracker = require("../ticket-tracker");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("close")
        .setDescription("Close a ticket by ID.")
        .addIntegerOption(option =>
            option.setName("id")
                .setDescription("The ticket ID to close")
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction, client, config) {

        // 🔒 GLOBAL LOCK CHECK
        if (config.locked) {
            return interaction.reply({
                content: '🚫 NorthGate OS is currently **locked**. Command `/close` cannot be used.',
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const id = interaction.options.getInteger("id");
        const ticketChannel = findTicketChannel(interaction.guild, id);

        if (!ticketChannel) {
            return interaction.editReply(`❌ Ticket #${id} does not exist.`);
        }

        await interaction.editReply(`🔒 Ticket #${id} closed. Saving transcript...`);
        await closeTicket(ticketChannel, client, config, interaction.user);
    }
};

function findTicketChannel(guild, id) {
    const ticketPattern = new RegExp(`^(?:commission|support|appeal|hiring|partnership|interrogation)-${id}(?:-|$)`, "i");
    return guild.channels.cache.find(channel => ticketPattern.test(channel.name));
}

async function closeTicket(ticketChannel, client, config, closedBy) {
    const ticketId = Number(ticketChannel.name.match(/-(\d+)(?:-|$)/)?.[1]);
    if (Number.isInteger(ticketId) && client.activeTicketIds?.has(ticketId)) {
        client.activeTicketIds.delete(ticketId);
    }

    if (client && typeof client.notifyAdminPanelRefresh === "function") {
        await client.notifyAdminPanelRefresh();
    }

    await saveTranscript(ticketChannel, closedBy, config);

    await ticketTracker.removeTracking(ticketChannel);

    setTimeout(() => {
        ticketChannel.guild.channels.delete(ticketChannel.id).catch(() => {});
    }, 3000);
}

module.exports.findTicketChannel = findTicketChannel;
module.exports.closeTicket = closeTicket;

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
        lines.push(`Closed by: ${closedBy.tag || "Autoclose timer"}`);
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
            content: `📄 Transcript for **${channel.name}** (closed by ${closedBy.tag || "Autoclose timer"})`,
            files: [file],
            allowedMentions: { parse: [] }
        });
    } catch (err) {
        console.error("Transcript failed:", err);
    }
}
