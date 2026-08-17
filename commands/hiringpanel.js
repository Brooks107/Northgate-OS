const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");

module.exports = { 
    data: new SlashCommandBuilder()
        .setName("hiringpanel")
        .setDescription("Send the hiring panel in this channel")
        .setDefaultMemberPermissions(0),
    
    async execute(interaction, client, config) {

        // GLOBAL LOCK CHECK
        if (config.locked) {
            return interaction.reply({
                content: '🚫 NorthGate OS is currently **locked**. Command `/hiringpanel` cannot be used.',
                flags: MessageFlags.Ephemeral
            });
        }


        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("ticket_hire")
                .setLabel("🎫 Hiring Request")
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
                    title: "⚙️ Hiring Panel",
                    description: "Hello and welcome to the NorthGate Studios Hiring Panel! If you wish to join our wonderful team, please click the button below.",
                    color: 0x3498db
                }
            ],
            components: [row]
        });

        return interaction.editReply({
            content: "✅ Hiring panel sent."
        });
    }
};
