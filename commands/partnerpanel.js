const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");

module.exports = { 
    data: new SlashCommandBuilder()
        .setName("partnerpanel")
        .setDescription("Send the partnership panel in this channel")
        .setDefaultMemberPermissions(0),
    
    async execute(interaction, client, config) {

        // GLOBAL LOCK CHECK
        if (config.locked) {
            return interaction.reply({
                content: '🚫 NorthGate OS is currently **locked**. Command `/partnerpanel` cannot be used.',
                flags: MessageFlags.Ephemeral
            });
        }


        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("ticket_partnership")
                .setLabel("🎫 Partnership Request")
                .setStyle(ButtonStyle.Success),
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
                    title: "⚙️ Partnership Panel",
                    description: "Hello and welcome to the NorthGate Studios Partnership Panel! If you wish to partner with our studio please click the button below.",
                    color: 0x3498db
                }
            ],
            components: [row]
        });

        return interaction.editReply({
            content: "✅ Partnership panel sent."
        });
    }
};
