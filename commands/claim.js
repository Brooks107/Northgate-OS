const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags
} = require("discord.js");

const ticketTracker = require("../ticket-tracker");
const ticketTopic = require("../ticket-topic");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("claim")
        .setDescription("Claim a ticket by ID.")
        .addIntegerOption(option =>
            option.setName("id")
                .setDescription("The ticket ID to claim")
                .setRequired(true)
        ),

    async execute(interaction, client, config) {

        // 🔒 GLOBAL LOCK CHECK
        if (config.locked) {
            return interaction.reply({
                content: "🚫 NorthGate OS is currently **locked**. Command `/claim` cannot be used.",
                flags: MessageFlags.Ephemeral
            });
        }

        const isAuthorized = (config.supportTeamRoles?.some(roleId =>
            interaction.member?.roles?.cache?.has(roleId)
        ) || config.commissionticketaccess?.some(roleId =>
            interaction.member?.roles?.cache?.has(roleId)
        ));

        if (!isAuthorized) {
            return interaction.reply({
                content: "❌ You are not authorized to use `/claim`.",
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const id = interaction.options.getInteger("id");
        const ticketPattern = new RegExp(`^(?:commission|support|appeal|hiring|partnership|interrogation)-${id}(?:-|$)`, "i");

        // -------------------------------------------------
        // FAST CHANNEL LOOKUP (Cache First, Network Fallback)
        // -------------------------------------------------
        let ticketChannel = interaction.guild.channels.cache.find(ch => ch && ticketPattern.test(ch.name));

        if (!ticketChannel) {
            const channels = await interaction.guild.channels.fetch().catch(() => null);
            ticketChannel = channels?.find(ch => ch && ticketPattern.test(ch.name));
        }

        if (!ticketChannel) {
            return interaction.editReply(`❌ Ticket #${id} does not exist.`);
        }

        // -------------------------------------------------
        // CHECK IF ALREADY CLAIMED
        // -------------------------------------------------
        if (ticketChannel.topic && ticketChannel.topic.includes("claimed:")) {
            const topicData = ticketTopic.parse(ticketChannel.topic);
            const claimerId = topicData.claimedBy || ticketChannel.topic.split("claimed:")[1]?.trim();
            return interaction.editReply(`❌ Ticket #${id} is already claimed by <@${claimerId}>.`);
        }

        // -------------------------------------------------
        // FETCH CONTROL MESSAGE (Start of Channel)
        // -------------------------------------------------
        const initialMessages = await ticketChannel.messages.fetch({ after: ticketChannel.id, limit: 10 }).catch(() => null);

        const ticketMessage = initialMessages?.find(m => m.author.id === client.user.id && m.components.length > 0)
            || initialMessages?.find(m => m.author.id === client.user.id);

        if (!ticketMessage) {
            return interaction.editReply(`❌ Could not find the original ticket embed in ${ticketChannel}.`);
        }

        // -------------------------------------------------
        // UPDATE BUTTONS (grey out claim button & retain close button)
        // -------------------------------------------------
        const isInterrogationTicket = ticketChannel.name.startsWith("interrogation-");

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("ticket_claimed_disabled")
                .setLabel(`🙋‍♂️ Claimed by ${interaction.user.displayName || interaction.user.username}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId(isInterrogationTicket ? "intero_close" : "ticket_close")
                .setLabel("🔒 Close Ticket")
                .setStyle(ButtonStyle.Danger)
        );

        await ticketMessage.edit({ components: [row] });

        // -------------------------------------------------
        // CONFIRM TO STAFF IMMEDIATELY (Prevents 3-minute timeout)
        // -------------------------------------------------
        await interaction.editReply(`📝 You have claimed ticket #${id} (${ticketChannel}).`);

        // -------------------------------------------------
        // BACKGROUND TASKS (Topic Update & Tracker Sync)
        // -------------------------------------------------
        const parsedTopic = ticketTopic.parse(ticketChannel.topic || "");
        const ownerId = parsedTopic.ownerId;
        const newTopic = ticketTopic.build({ ownerId, claimedBy: interaction.user.id });

        // Unawaited: runs in the background so Discord rate limits on channel topic edits do not block the bot
        ticketChannel.setTopic(newTopic).catch(err => {
            console.error(`[claim] Topic update error in #${ticketChannel.name}:`, err.message);
        });

        ticketTracker.syncTicket(ticketChannel, {
            type: "claimed",
            status: `🟡 Claimed by ${interaction.user.tag}`,
            userId: interaction.user.id
        }).catch(err => {
            console.error(`[claim] Tracker sync error in #${ticketChannel.name}:`, err.message);
        });
    }
};