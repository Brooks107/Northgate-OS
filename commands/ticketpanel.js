const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

module.exports = { 
    data: new SlashCommandBuilder()
        .setName("ticketpanel")
        .setDescription("Send the ticket panel in this channel")
        .setDefaultMemberPermissions(0),
    
    async execute(interaction, client, config) {
        await interaction.deferReply({ ephemeral: true });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("ticket_support")
                .setLabel("🎫 General Support")
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId("ticket_appeal")
                .setLabel("🔨 Appeal")
                .setStyle(ButtonStyle.Secondary)
        );
        

        const channel = client.channels.cache.get(config.channels.ticketchannelid);
        if (!channel) {
            return interaction.editReply({
                content: "❌ Ticket Channel not found. Please contact @brooksy246."
            });
        }

        await channel.send({
            embeds: [
                {
                    title: "🆘 Support Ticket System",
                    description: "Hello and welcome to the NorthGate Studios Support Ticket System! If you have any questions, concerns, or need assistance, please click one of the buttons below to create a support ticket. Our team will be happy to assist you as soon as possible.",
                    color: 0x3498db
                }
            ],
            components: [row]
        });

        return interaction.editReply({
            content: "✅ Support panel sent."
        });
    }
};
