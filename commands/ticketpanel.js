const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const {
    ProgressFailure,
    createInteractionProgress
} = require("../utils/progress-embed");

module.exports = { 
    data: new SlashCommandBuilder()
        .setName("ticketpanel")
        .setDescription("Send the ticket panel in this channel")
        .setDefaultMemberPermissions(0),
    
    async execute(interaction, client, config) {

        // GLOBAL LOCK CHECK
        if (config.locked) {
            return interaction.reply({
                content: '🚫 NorthGate OS is currently **locked**. Command `/ticketpanel` cannot be used.',
                flags: MessageFlags.Ephemeral
            });
        }


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
        

        const progress = createInteractionProgress(interaction, "Creating the support ticket panel", [
            "Find the configured ticket channel",
            "Post the ticket panel"
        ]);
        await progress.start();

        let channel;
        try {
            await progress.runStep(0, async () => {
                channel = client.channels.cache.get(config.channels.ticketchannelid);
                if (!channel) throw new ProgressFailure("Ticket channel not found. Please contact @brooksy246.");
            });
            await progress.runStep(1, () => channel.send({
            embeds: [
                {
                    title: "🆘 Support Ticket System",
                    description: "Hello and welcome to the NorthGate Studios Support Ticket System! If you have any questions, concerns, or need assistance, please click one of the buttons below to create a support ticket. Our team will be happy to assist you as soon as possible.",
                    color: 0x3498db
                }
            ],
            components: [row]
            }));
            await progress.complete("✅ Support panel sent.");
        } catch (error) {
            if (error instanceof ProgressFailure) return;
            throw error;
        }
    }
};
