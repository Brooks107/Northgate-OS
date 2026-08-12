const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");

const ticketTopic = require("../ticket-topic");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("unclaim")
        .setDescription("Unclaim a commission ticket and make it claimable again.")
        .addIntegerOption(option =>
            option.setName("id")
                .setDescription("The ticket ID to unclaim")
                .setRequired(true)
        ),

    async execute(interaction, client, config) {

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
                ephemeral: true
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const id = interaction.options.getInteger("id");

        const ticketChannel = interaction.guild.channels.cache.find(ch =>
            ch.name.startsWith(`commission-${id}`) ||
            ch.name.startsWith(`support-${id}`) ||
            ch.name.startsWith(`appeal-${id}`)
        );

        if (!ticketChannel) {
            return interaction.editReply(`❌ Ticket #${id} does not exist.`);
        }

        // -------------------------------------------------
        // FIND ORIGINAL EMBED MESSAGE (bulletproof)
        // -------------------------------------------------

        const messages = await ticketChannel.messages.fetch({ limit: 100 });

        const ticketMessage = messages.find(m =>
            m.embeds.length > 0 &&
            m.embeds[0].title &&
            m.embeds[0].title.includes(`#${id}`)
        );

        if (!ticketMessage) {
            return interaction.editReply("❌ Could not find the ticket message.");
        }

        // -------------------------------------------------
        // REBUILD BUTTONS — KEEP EMBED EXACTLY AS IS
        // -------------------------------------------------

        const isSupportTicket =
            ticketChannel.name.startsWith("support-") ||
            ticketChannel.name.startsWith("appeal-");

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(isSupportTicket ? "support_claim" : "commission_claim")
                .setLabel("📝 Claim Ticket")
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId(isSupportTicket ? "support_close" : "ticket_close")
                .setLabel("🔒 Close Ticket")
                .setStyle(ButtonStyle.Danger)
        );

        await ticketMessage.edit({
            embeds: ticketMessage.embeds, // keep original embed
            components: [row]
        });

        // -------------------------------------------------
        // CLEAR THE CLAIM FROM THE CHANNEL TOPIC
        // -------------------------------------------------
        // Without this the topic keeps saying claimed:<id>, so /claim refuses the
        // ticket forever -- the buttons come back but the command never works.
        const { ownerId } = ticketTopic.parse(ticketChannel.topic);
        await ticketChannel.setTopic(ticketTopic.build({ ownerId }));

        return interaction.editReply(`✅ Ticket #${id} has been unclaimed.`);
    }
};
