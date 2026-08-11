const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("unclaim")
        .setDescription("Unclaim a commission ticket and make it claimable again.")
        .addIntegerOption(option =>
            option.setName("id")
                .setDescription("The ticket ID to unclaim")
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction, client, config) {

        // 🔒 GLOBAL LOCK CHECK
        if (config.locked) {
            return interaction.reply({
                content: '🚫 NorthGate OS is currently **locked**. Command `/unclaim` cannot be used.',
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });




        const id = interaction.options.getInteger("id");

        // FIXED: match commission-{id}-{username}
        const ticketChannel = interaction.guild.channels.cache.find( ch =>
        ch.name.startsWith(`commission-${id}-`) ||
        ch.name.startsWith(`support-${id}-`) ||
        ch.name.startsWith(`appeal-${id}-`)
        );

        if (!ticketChannel) {
            return interaction.editReply(`❌ Ticket #${id} does not exist.`);
        }

        // Fetch the ticket message (first bot message in the channel)
        const messages = await ticketChannel.messages.fetch({ limit: 1000000 });
        const ticketMessage = messages.find(m =>
            m.embeds.length > 0 &&
            m.embeds[0].title &&
            m.embeds[0].title.includes(`#${id}`)
        );


        if (!ticketMessage) {
            return interaction.editReply("❌ Could not find the ticket message.");
        }

        // Rebuild the original buttons
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("ticket_claim")
                .setLabel("📝 Claim Ticket")
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId("ticket_close")
                .setLabel("🔒 Close Ticket")
                .setStyle(ButtonStyle.Danger)
        );

        await ticketMessage.edit({ components: [row] });

        return interaction.editReply(`✅ Ticket #${id} has been unclaimed.`);
    }
};
    