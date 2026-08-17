const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    AttachmentBuilder
} = require("discord.js");

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

        const ticketChannel = interaction.guild.channels.cache.find(
            ch =>
                ch.name.startsWith(`commission-${id}`) ||
                ch.name.startsWith(`support-${id}`) ||
                ch.name.startsWith(`appeal-${id}`)
        );

        if (!ticketChannel) {
            return interaction.editReply(`❌ Ticket #${id} does not exist.`);
        }

        if (client.activeTicketIds.has(id)) {
            client.activeTicketIds.delete(id);
        }

        await interaction.editReply(`🔒 Ticket #${id} closed. Saving transcript...`);
        await saveTranscript(ticketChannel, interaction.user, config);

        setTimeout(() => {
            interaction.guild.channels.delete(ticketChannel.id).catch(() => {});
        }, 3000);
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
