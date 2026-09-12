const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("itsupport")
        .setDescription("Send an IT problem report")
        .addStringOption(opt =>
            opt.setName("command")
                .setDescription("What command did you run or what problem did you run into")
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
                    content: '🚫 NorthGate OS is currently **locked**. Command `/itsupport` cannot be used.',
                    flags: MessageFlags.Ephemeral
                });
            }

            await interaction.deferReply();

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
                embeds: [{
                    image: {
                        url: "https://sdx.microsoft.com/family/restricted-web?c=UNKN&url=https%3A%2F%2Fimages-ext-1.discordapp.net%2Fexternal%2FPEtb96IRWP_Xnx8upeFVxq1jqLP8llpeMsdIPfhfbYw%2Fhttps%2Fstatic.klipy.com%2Fii%2F4493325008d34b7bf8cd6813cd5c1619%2F38%2Fb2%2FV70FpBDAfDGSg.mp4&eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2Q0JDLUhTNTEyIiwia2lkIjoidzdKRGt6d203dXhSTVJfcnNzX09WUXhCV3RMRGo2N0p6eko4Yk5rbk1BUSIsInppcCI6IkRFRiJ9..kCNLTiWqWRty8xQqcVZq3w.5QS6ZFKhyWatmj1wTZ_PhnPWsDivGLm3INpZWnLiGgM99t9-KNdbwJUVLKi7KRhieQsRimYrIRJcTWaN1YED_6O9nZysd-Z8AW2WrbK6TEwCQl7NicYKNohS8zrNRwbYm5APC-JTprKf-GltuRG--6wiQLBXEnv5pLghD3ezaf6-nWCxCnIsIw9zI4Vq88CI7MuY_qjSZBgrWOOOGnIO-qKupEEwS-FLd7pBmwMCQ4DSnC-UC-A38C2seCAMK0O14-Nd06UIroPcpJ1AyqRJTIH4pA3uj4cKGrlvHl9R3xz0ibN7s3qPk-ClTuUqCa9Xx-ZLCZxmd-_aeMPc_yK_7j8n6P2wM330pu7s9zFxvp1GW9yZf59TNs8TQphiKBd6ZnRRl6iURvuaJaAtzKlVYjrkOpiRsqG0YMPwFwzQJxXDGwARJfDQOrk6TtPVCUzBFx56HAL0TWcm_LLagZel01JlLdsFds-1HxRD5IGtbmUVDlzkZJZ9wfup_egTwRHp2YdCP6yFKegNGIIW6UethUZXWmbahsl70NnlWLWsLpwhj0XjxUbfFYGXOXgdi4vXBXta4yg0YYLt7IGOx7KZ_Qq2GNz4rGdIhMTb_TUs0tCZCfIy18U9N4rm4l4lfsOVAyqfjM5bIoFZh7U0FzHwmTnjK_paW0Wor2ly5MDlZrsv9unFR1J0I710PYA_QqkPFD3VTT2bDg0plSyPhgIPRADSnPXvj1lrU5nNonnyAvLaiRmnT28tp1KUrnwF_YG9TQm4ox3t82C5n7he7FGuNgW-jNvIWRHrlNuhityZ96n9aZ1UylsvLo-X52I4sKL5424l9zTQQkbRr-mRy9MirEiDpnyhBKVQcQVZVSXSohLFPUptBddqjn6nMNjAFPddMUe6W2x0v3CdNa0QJYYBjuha6GuhlBWco1dZczFTepNHIH2pQj9mvgXVHkMz2UsoUZ1b7vXgTJqMaXmFdUifJ19yaqLXDmo8eBbEEYuMFqE9E_t83oV2v5VrnupRldgcvkibJXrsmS7zK1OELoFJzBSLN8-1h4nzsZ_CNrTVGNKIosSkrYNV_89o94ecSKOqjm68mzZIIKFjluovy-akredEMGpQVSkPiLLWiZEGcDSpF2cmBERAjWIimsA9X2Ew9nIqTB-qlyyweq3Bn327syvye_wAxB_BrQ1LjTjFWsGOUU9nAiFnzk0BSsJ1ayUXQZgFHXZARSpD1aJ1KVOALegFwq-tmoKUL-5PaMOzIxJxL8VbKUcsvTX9bte853Ik4AWGM7IodlUkITQ1qsF-C-TbOksC4e_ymEO0M--1aU5L2nU0ZpKUBlNBeYFXWQ5ZCl8EXFomL9zDo5_7e7rjZVN5HXj64l6b646upPWkxxLbUA-CyW-T3D8rUcoUHeSgc2Kdigc-esEBOXOdyVNY0VNn92yhontSDrYwZ9dIvBDOf6ZxBjmKerQuCICR00yC.kM5GWAGrpVpUy2LwuVCyolipdMLV1SHu01WtNVblzFM"
                    }
                }],
                fetchReply: true
            });

            const reportEmbed = new EmbedBuilder()
                .setTitle("IT Support Request")
                .setColor(0xe67e22)
                .addFields(
                    { name: "User", value: `${interaction.user} (${interaction.user.tag})` },
                    { name: "Command/Problem", value: command },
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
                            .setCustomId(`itsupport_completed:${interaction.user.id}`)
                            .setLabel("Completed")
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId(`itsupport_denied:${interaction.user.id}`)
                            .setLabel("Deny")
                            .setStyle(ButtonStyle.Danger)
                    )
                ]
            });
        }
};



