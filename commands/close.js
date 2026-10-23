const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    AttachmentBuilder
} = require("discord.js");

const ticketTracker = require("../ticket-tracker");
const {
    ProgressFailure,
    createInteractionProgress
} = require("../utils/progress-embed");

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

        const id = interaction.options.getInteger("id");
        const progress = createInteractionProgress(interaction, `Closing ticket #${id}`, [
            "Find the ticket channel",
            "Release the ticket slot and refresh the admin panel",
            "Save the ticket transcript",
            "Remove the ticket from tracking",
            "Schedule ticket channel deletion"
        ]);
        await progress.start();
        let ticketChannel;
        try {
            await progress.runStep(0, async () => {
                ticketChannel = findTicketChannel(interaction.guild, id);
                if (!ticketChannel) throw new ProgressFailure(`Ticket #${id} does not exist.`);
            });
        } catch (error) {
            if (error instanceof ProgressFailure) return;
            throw error;
        }
        await closeTicket(ticketChannel, client, config, interaction.user, progress);
    }
};

function findTicketChannel(guild, id) {
    const ticketPattern = new RegExp(`^(?:support|appeal|hiring|partnership|interrogation)-${id}(?:-|$)`, "i");
    return guild.channels.cache.find(channel => ticketPattern.test(channel.name));
}

async function closeTicket(ticketChannel, client, config, closedBy, progress) {
    const ticketId = Number(ticketChannel.name.match(/-(\d+)(?:-|$)/)?.[1]);
    const releaseSlot = async () => {
        if (Number.isInteger(ticketId) && client.activeTicketIds?.has(ticketId)) {
            client.activeTicketIds.delete(ticketId);
        }
        if (client && typeof client.notifyAdminPanelRefresh === "function") {
            await client.notifyAdminPanelRefresh();
        }
    };
    const scheduleDelete = async () => {
        setTimeout(() => {
            ticketChannel.guild.channels.delete(ticketChannel.id).catch(error => {
                console.error(`[close] failed to delete ${ticketChannel.name}:`, error);
            });
        }, 3000);
    };

    if (progress) {
        await progress.runStep(1, releaseSlot);
        const transcriptSaved = await progress.runStep(2, () => saveTranscript(ticketChannel, closedBy, config));
        if (!transcriptSaved) await progress.warnStep(2);
        await progress.runStep(3, () => ticketTracker.removeTracking(ticketChannel));
        await progress.runStep(4, scheduleDelete);
        await progress.complete(
            `🔒 Ticket #${ticketId} closed. ` +
            (transcriptSaved ? "Transcript saved." : "⚠️ Transcript could not be saved; check the bot logs.") +
            " Channel deletion is queued."
        );
        return;
    }

    await releaseSlot();
    await saveTranscript(ticketChannel, closedBy, config);
    await ticketTracker.removeTracking(ticketChannel);
    await scheduleDelete();
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
            return false;
        }

        await logChannel.send({
            content: `📄 Transcript for **${channel.name}** (closed by ${closedBy.tag || "Autoclose timer"})`,
            files: [file],
            allowedMentions: { parse: [] }
        });
        return true;
    } catch (err) {
        console.error("Transcript failed:", err);
        return false;
    }
}
