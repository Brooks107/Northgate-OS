const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");

const ticketTopic = require("../ticket-topic");
const ticketTracker = require("../ticket-tracker");
const {
    ProgressFailure,
    createInteractionProgress
} = require("../utils/progress-embed");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("unclaim")
        .setDescription("Unclaim a ticket and make it claimable again.")
        .addIntegerOption(option =>
            option.setName("id")
                .setDescription("The ticket ID to unclaim")
                .setRequired(true)
        ),

    async execute(interaction, client, config) {

        // 🔒 GLOBAL LOCK CHECK
        if (config.locked) {
            return interaction.reply({
                content: '🚫 NorthGate OS is currently **locked**. Command `/unclaim` cannot be used.',
                flags: MessageFlags.Ephemeral
            });
        }

        const isAuthorized = config.supportTeamRoles?.some(roleId =>
            interaction.member?.roles?.cache?.has(roleId)
        );

        if (!isAuthorized) {
            return interaction.reply({
                content: "❌ You are not authorized to use `/unclaim`.",
                flags: MessageFlags.Ephemeral
            });
        }

        const id = interaction.options.getInteger("id");
        const ticketPattern = new RegExp(`^(?:support|appeal|hiring|partnership|interrogation)-${id}(?:-|$)`, "i");
        const progress = createInteractionProgress(interaction, `Unclaiming ticket #${id}`, [
            "Find the ticket channel",
            "Find the ticket control message",
            "Verify the claim and your permission to remove it",
            "Restore the claim button",
            "Clear the claim and sync the ticket tracker"
        ]);
        await progress.start();

        let ticketChannel;
        let ticketMessage;
        let topicData;
        let claimedBy;
        try {
            await progress.runStep(0, async () => {
                ticketChannel = interaction.guild.channels.cache.find(ch => ch && ticketPattern.test(ch.name));
                if (!ticketChannel) {
                    const channels = await interaction.guild.channels.fetch().catch(() => null);
                    ticketChannel = channels?.find(ch => ch && ticketPattern.test(ch.name));
                }
                if (!ticketChannel) throw new ProgressFailure(`Ticket #${id} does not exist.`);
            });
            await progress.runStep(1, async () => {
                const initialMessages = await ticketChannel.messages.fetch({
                    after: ticketChannel.id,
                    limit: 10
                }).catch(() => null);
                ticketMessage = initialMessages?.find(m => m.author.id === client.user.id && m.components.length > 0)
                    || initialMessages?.find(m => m.author.id === client.user.id);
                if (!ticketMessage) {
                    throw new ProgressFailure(`Could not find the original ticket control message in ${ticketChannel}.`);
                }
            });
            await progress.runStep(2, async () => {
                topicData = ticketTopic.parse(ticketChannel.topic || "");
                const claimButton = ticketMessage.components[0]?.components?.find(c =>
                    c.customId?.startsWith("ticket_claimed_")
                );
                claimedBy = topicData.claimedBy
                    || (claimButton ? claimButton.customId.replace("ticket_claimed_", "") : null);
                if (!claimedBy) throw new ProgressFailure(`Ticket #${id} is not currently claimed.`);
                const isAdmin = interaction.member.permissions.has("Administrator");
                if (claimedBy !== interaction.user.id && !isAdmin) {
                    throw new ProgressFailure("Only the person who claimed this ticket (or an Administrator) can unclaim it.");
                }
            });
        } catch (error) {
            if (error instanceof ProgressFailure) return;
            throw error;
        }

        // -------------------------------------------------
        // REBUILD BUTTONS — RESTORE CLAIM & CLOSE BUTTONS
        // -------------------------------------------------
        const isSupportTicket = ticketChannel.name.startsWith("support-") || ticketChannel.name.startsWith("appeal-");
        const isHiringTicket = ticketChannel.name.startsWith("hiring-");
        const isPartnershipTicket = ticketChannel.name.startsWith("partnership-");
        const isInterrogationTicket = ticketChannel.name.startsWith("interrogation-");

        const claimCustomId = isPartnershipTicket ? "partnership_claim"
            : isHiringTicket ? "hiring_claim"
            : isSupportTicket ? "support_claim"
            : isInterrogationTicket ? "intero_claim"
            : "ticket_claim";

        const closeCustomId = isPartnershipTicket ? "partnership_close"
            : isHiringTicket ? "hiring_close"
            : isSupportTicket ? "support_close"
            : isInterrogationTicket ? "intero_close"
            : "ticket_close";

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(claimCustomId)
                .setLabel("📝 Claim Ticket")
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId(closeCustomId)
                .setLabel("🔒 Close Ticket")
                .setStyle(ButtonStyle.Danger)
        );

        await progress.runStep(3, () => ticketMessage.edit({ components: [row] }));
        await progress.runStep(4, async () => {
            await ticketChannel.setTopic(ticketTopic.build({ ownerId: topicData.ownerId }));
            await ticketTracker.syncTicket(ticketChannel, {
                type: "unclaimed",
                status: "🟢 Open"
            });
        });
        await progress.complete(`✅ Ticket #${id} (${ticketChannel}) has been unclaimed.`);
    }
};