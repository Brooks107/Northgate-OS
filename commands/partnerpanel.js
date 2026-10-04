const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const {
    ProgressFailure,
    createInteractionProgress
} = require("../utils/progress-embed");

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


        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("ticket_partnership")
                .setLabel("🎫 Partnership Request")
                .setStyle(ButtonStyle.Success),
        );
        

        const progress = createInteractionProgress(interaction, "Creating the partnership panel", [
            "Find the configured ticket channel",
            "Post the partnership panel"
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
                    title: "⚙️ Partnership Panel",
                    description: "Hello and welcome to the NorthGate Studios Partnership Panel! If you wish to partner with our studio please click the button below.",
                    color: 0x3498db
                }
            ],
            components: [row]
            }));
            await progress.complete("✅ Partnership panel sent.");
        } catch (error) {
            if (error instanceof ProgressFailure) return;
            throw error;
        }
    }
};
