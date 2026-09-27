const {
    SlashCommandBuilder,
    PermissionFlagsBits,
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

        // -------------------------------------------------
        // FETCH & FIND TICKET CHANNEL PRECISELY
        // -------------------------------------------------
        const channels = await interaction.guild.channels.fetch().catch(() => interaction.guild.channels.cache);
        const ticketPattern = new RegExp(`^(?:commission|support|appeal|hiring|partnership|interrogation)-${id}(?:-|$)`, "i");

        const ticketChannel = channels.find(ch => ch && ticketPattern.test(ch.name));

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
        // FETCH TICKET CONTROL MESSAGE FROM CHANNEL START
        // -------------------------------------------------
        // Fetches the first 10 messages ever sent in the channel
        const initialMessages = await ticketChannel.messages.fetch({ after: ticketChannel.id, limit: 10 });

        // Find the bot's initial control message
        const ticketMessage = initialMessages.find(m => m.author.id === client.user.id && m.components.length > 0)
            || initialMessages.find(m => m.author.id === client.user.id);

        if (!ticketMessage) {
            return interaction.editReply(`❌ Could not find the original ticket embed in ${ticketChannel}.`);
        }

        // -------------------------------------------------
        // UPDATE BUTTONS (remove claim button)
        // -------------------------------------------------
        const isInterrogationTicket = ticketChannel.name.startsWith("interrogation-");
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(isInterrogationTicket ? "intero_close" : "ticket_close")
                .setLabel("🔒 Close Ticket")
                .setStyle(ButtonStyle.Danger)
        );

        await ticketMessage.edit({ components: [row] });

        // -------------------------------------------------
        // STORE CLAIMER IN CHANNEL TOPIC
        // -------------------------------------------------
        const parsedTopic = ticketTopic.parse(ticketChannel.topic);
        const ownerId = parsedTopic.ownerId;
        await ticketChannel.setTopic(ticketTopic.build({ ownerId, claimedBy: interaction.user.id }));
        
        await ticketTracker.syncTicket(ticketChannel, {
            type: "claimed",
            status: `🟡 Claimed by ${interaction.user.tag}`,
            userId: interaction.user.id
        });

        // -------------------------------------------------
        // CONFIRM TO STAFF
        // -------------------------------------------------
        await interaction.editReply(`📝 You have claimed ticket #${id} (${ticketChannel}).`);
    }
};