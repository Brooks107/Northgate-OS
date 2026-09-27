const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");

const ticketTopic = require("../ticket-topic");
const ticketTracker = require("../ticket-tracker");

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

        const isAuthorized = (config.supportTeamRoles?.some(roleId =>
            interaction.member?.roles?.cache?.has(roleId)
        ) || config.commissionticketaccess?.some(roleId =>
            interaction.member?.roles?.cache?.has(roleId)
        ));

        if (!isAuthorized) {
            return interaction.reply({
                content: "❌ You are not authorized to use `/unclaim`.",
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
        // FETCH CONTROL MESSAGE (Start of Channel)
        // -------------------------------------------------
        const initialMessages = await ticketChannel.messages.fetch({ after: ticketChannel.id, limit: 10 }).catch(() => null);

        const ticketMessage = initialMessages?.find(m => m.author.id === client.user.id && m.components.length > 0)
            || initialMessages?.find(m => m.author.id === client.user.id);

        if (!ticketMessage) {
            return interaction.editReply(`❌ Could not find the original ticket control message in ${ticketChannel}.`);
        }

        // -------------------------------------------------
        // READ CLAIM STATUS (Checks Topic + Button Custom ID)
        // -------------------------------------------------
        const topicData = ticketTopic.parse(ticketChannel.topic || "");
        const claimButton = ticketMessage.components[0]?.components?.find(c => c.customId?.startsWith("ticket_claimed_"));

        const claimedBy = topicData.claimedBy || (claimButton ? claimButton.customId.replace("ticket_claimed_", "") : null);

        if (!claimedBy) {
            return interaction.editReply(`❌ Ticket #${id} is not currently claimed.`);
        }

        // Check if the executor is either the original claimer or an Administrator
        const isAdmin = interaction.member.permissions.has("Administrator");
        if (claimedBy !== interaction.user.id && !isAdmin) {
            return interaction.editReply("❌ Only the person who claimed this ticket (or an Administrator) can unclaim it.");
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
            : "commission_claim";

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

        await ticketMessage.edit({ components: [row] });

        // -------------------------------------------------
        // CONFIRM TO STAFF IMMEDIATELY
        // -------------------------------------------------
        await interaction.editReply(`✅ Ticket #${id} (${ticketChannel}) has been unclaimed.`);

        // -------------------------------------------------
        // BACKGROUND TASKS (Clear Topic Claim & Tracker Sync)
        // -------------------------------------------------
        const { ownerId } = ticketTopic.parse(ticketChannel.topic || "");

        ticketChannel.setTopic(ticketTopic.build({ ownerId })).catch(err => {
            console.error(`[unclaim] Topic update error in #${ticketChannel.name}:`, err.message);
        });

        ticketTracker.syncTicket(ticketChannel, {
            type: "unclaimed",
            status: "🟢 Open"
        }).catch(err => {
            console.error(`[unclaim] Tracker sync error in #${ticketChannel.name}:`, err.message);
        });
    }
};