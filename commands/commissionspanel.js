const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const {
    ProgressFailure,
    createInteractionProgress
} = require("../utils/progress-embed");

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
                flags: MessageFlags.Ephemeral
            });
        }


        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("ticket_commission")
                .setLabel("🎫 Commission Request")
                .setStyle(ButtonStyle.Danger),
        );
        

        const progress = createInteractionProgress(interaction, "Creating the commissions panel", [
            "Find the configured ticket channel",
            "Post the commissions panel"
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
                    title: "⚙️ Commissions Panel",
                    description: "Hello and welcome to the NorthGate Studios Commissions Panel! If you have any questions or need assistance, please click the button below.",
                    color: 0x3498db
                }
            ],
            components: [row]
            }));
            await progress.complete("✅ Commissions panel sent.");
        } catch (error) {
            if (error instanceof ProgressFailure) return;
            throw error;
        }
    }
};
