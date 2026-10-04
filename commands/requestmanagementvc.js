const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder
} = require("discord.js");
const {
    ProgressFailure,
    createInteractionProgress
} = require("../utils/progress-embed");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("requestmanagementvc")
        .setDescription("Request access to the management voice channel."),

    async execute(interaction, client, config) {
        const progress = createInteractionProgress(interaction, "Management VC access request", [
            "Find the configured management voice channel",
            "Post the access request"
        ]);
        await progress.start();

        let channel;
        try {
            await progress.runStep(0, async () => {
                const channelId = config.managementVoiceChannelId;
                channel = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;
                if (!channel || !channel.isVoiceBased?.() || !channel.guild) {
                    throw new ProgressFailure("Set a valid `managementVoiceChannelId` in `config.json` first.");
                }
            });
        } catch (error) {
            if (error instanceof ProgressFailure) return;
            throw error;
        }

        await progress.runStep(1, () => channel.send({
            embeds: [new EmbedBuilder()
                .setColor(0xf1c40f)
                .setTitle("Management VC access request")
                .setDescription(`${interaction.user} is requesting access to ${channel}.`)
                .setFooter({ text: `Requested by ${interaction.user.tag}` })
                .setTimestamp()],
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`management_vc_accept:${interaction.user.id}`)
                    .setLabel("Accept request")
                    .setStyle(ButtonStyle.Success)
            )]
        }));

        await progress.complete("✅ Your access request was sent in the management VC chat.");
    }
};