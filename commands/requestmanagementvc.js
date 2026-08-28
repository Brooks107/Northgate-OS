const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    MessageFlags
} = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("requestmanagementvc")
        .setDescription("Request access to the management voice channel."),

    async execute(interaction, client, config) {
        const channelId = config.managementVoiceChannelId;
        const channel = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;
        if (!channel || !channel.isVoiceBased?.() || !channel.guild) {
            return interaction.reply({
                content: "❌ Set a valid `managementVoiceChannelId` in `config.json` first.",
                flags: MessageFlags.Ephemeral
            });
        }

        await channel.send({
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
        });

        return interaction.reply({
            content: "✅ Your access request was sent in the management VC chat.",
            flags: MessageFlags.Ephemeral
        });
    }
};