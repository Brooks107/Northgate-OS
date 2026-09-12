const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("itsupport")
        .setDescription("Send an IT problem report")
        .addStringOption(opt =>
            opt.setName("command")
                .setDescription("What command did you run?")
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName("what_happened")
                .setDescription("Describe your problem in as much detail as possible")
                .setRequired(true)
            
        )
        .addAttachmentOption(opt =>
            opt.setName("images_logs")
                .setDescription("Please provide any possible picture on what the bot replied with")
                .setRequired(false)
        ),

        async execute(interaction, client, config) {

            if (config.locked) {
                return interaction.reply({
                    content: '🚫 NorthGate OS is currently **locked**. Command `/itreport` cannot be used.',
                    flags: MessageFlags.Ephemeral
                });
            }

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const channelId = config.channels?.itsupport ?? config.channels?.itreports;
            const supportChannel = channelId
                ? await client.channels.fetch(channelId).catch(() => null)
                : null;

            if (!supportChannel?.isTextBased?.()) {
                return interaction.editReply({
                    content: "❌ The IT support channel is not configured or is unavailable."
                });
            }

            const command = interaction.options.getString("command");
            const whatHappened = interaction.options.getString("what_happened");
            const attachment = interaction.options.getAttachment("images_logs");

            const reply = await interaction.editReply({
                content: "✅ Your IT support request has been sent to the IT team.",
                fetchReply: true
            });

            const reportEmbed = new EmbedBuilder()
                .setTitle("IT Support Request")
                .setColor(0xe67e22)
                .addFields(
                    { name: "User", value: `${interaction.user} (${interaction.user.tag})` },
                    { name: "Command", value: command },
                    { name: "What Happened", value: whatHappened },
                    { name: "Bot Reply", value: reply.url || "Reply link unavailable" }
                )
                .setTimestamp();

            if (attachment) {
                reportEmbed.addFields({ name: "Image / Logs", value: `[Open attachment](${attachment.url})` });
                if (attachment.contentType?.startsWith("image/")) reportEmbed.setImage(attachment.url);
            }

            await supportChannel.send({
                embeds: [reportEmbed],
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId("itsupport_completed")
                            .setLabel("Completed")
                            .setStyle(ButtonStyle.Success)
                    )
                ]
            });
        }
};



