const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const {
    ProgressFailure,
    createInteractionProgress
} = require("../utils/progress-embed");

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


        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("ticket_hire")
                .setLabel("🎫 Hiring Request")
                .setStyle(ButtonStyle.Danger),
        );
        

        const progress = createInteractionProgress(interaction, "Creating the hiring panel", [
            "Find the configured ticket channel",
            "Post the hiring panel"
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
                    title: "⚙️ Hiring Panel",
                    description: "Hello and welcome to the NorthGate Studios Hiring Panel! If you wish to join our wonderful team, please click the button below.",
                    color: 0x3498db
                }
            ],
            components: [row]
            }));
            await progress.complete("✅ Hiring panel sent.");
        } catch (error) {
            if (error instanceof ProgressFailure) return;
            throw error;
        }
    }
};
