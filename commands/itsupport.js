const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require("discord.js");
const {
    ProgressFailure,
    createInteractionProgress
} = require("../utils/progress-embed");
const gif = [
    "https://klipy.com/gifs/shits-fucked"
    ]
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

            const command = interaction.options.getString("command");
            const whatHappened = interaction.options.getString("what_happened");
            const attachment = interaction.options.getAttachment("images_logs");
            const channelId = config.channels?.itsupport ?? config.channels?.itreports;
            const progress = createInteractionProgress(interaction, "Sending IT support report", [
                "Find the IT support channel",
                "Post the report and action buttons",
                "Post the status visual"
            ]);
            await progress.start();

            let supportChannel;
            try {
                await progress.runStep(0, async () => {
                    supportChannel = channelId
                        ? await client.channels.fetch(channelId).catch(() => null)
                        : null;
                    if (!supportChannel?.isTextBased?.()) {
                        throw new ProgressFailure("The IT support channel is not configured or is unavailable.");
                    }
                });
            } catch (error) {
                if (error instanceof ProgressFailure) return;
                throw error;
            }

            const reportEmbed = new EmbedBuilder()
                .setTitle("IT Support Request")
                .setColor(0xe67e22)
                .addFields(
                    { name: "User", value: `${interaction.user} (${interaction.user.tag})` },
                    { name: "Command/Problem", value: command },
                    { name: "What Happened", value: whatHappened },
                    { name: "Bot Reply", value: "Private acknowledgement via `/itsupport`." }
                )
                .setTimestamp();

            if (attachment) {
                reportEmbed.addFields({ name: "Image / Logs", value: `[Open attachment](${attachment.url})` });
                if (attachment.contentType?.startsWith("image/")) reportEmbed.setImage(attachment.url);
            }

            await progress.runStep(1, () => supportChannel.send({
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
            }));

            await progress.runStep(2, () => interaction.channel.send(gif[0]));
            await progress.complete("✅ Your IT support request has been sent to the IT team.");
        }
};

