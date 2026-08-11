const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

module.exports = { 
    data: new SlashCommandBuilder()
        .setName("commissionspanel")
        .setDescription("Send the commissions panel in this channel")
        .setDefaultMemberPermissions(0),
    
    async execute(interaction, client, config) {

        // GLOBAL LOCK CHECK
        if (config.locked) {
            return interaction.reply({
                content: '🚫 NorthGate OS is currently **locked**. Command `/commissionspanel` cannot be used.',
                ephemeral: true
            });
        }


        await interaction.deferReply({ ephemeral: true });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("ticket_commission")
                .setLabel("🎫 Commission Request")
                .setStyle(ButtonStyle.Danger),
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
                    title: "⚙️ Commissions Panel",
                    description: "Hello and welcome to the NorthGate Studios Commissions Panel! If you have any questions or need assistance, please click the button below.",
                    color: 0x3498db
                }
            ],
            components: [row]
        });

        return interaction.editReply({
            content: "✅ Commissions panel sent."
        });
    }
};
