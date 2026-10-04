const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");

const closeCommand = require("./close");
const autocloseScheduler = require("../autoclose-scheduler");
const {
    ProgressFailure,
    createInteractionProgress
} = require("../utils/progress-embed");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("autoclose")
        .setDescription("Schedule a ticket to close after a delay.")
        .addIntegerOption(option =>
            option.setName("id")
                .setDescription("The ticket ID to close")
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName("duration")
                .setDescription("Delay before closing, such as 30m, 2h, or 1d (max 30d)")
                .setRequired(true)
                .setMinLength(2)
                .setMaxLength(8)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction, client, config) {
        if (config.locked) {
            return interaction.reply({
                content: "🚫 NorthGate OS is currently **locked**. Command `/autoclose` cannot be used.",
                flags: MessageFlags.Ephemeral
            });
        }

        const id = interaction.options.getInteger("id");
        const durationText = interaction.options.getString("duration");
        const durationMs = autocloseScheduler.parseDuration(durationText);
        if (!durationMs) {
            return interaction.reply({
                content: "❌ Use a duration like `30s`, `15m`, `2h`, or `1d` (maximum `30d`).",
                flags: MessageFlags.Ephemeral
            });
        }

        const progress = createInteractionProgress(interaction, `Scheduling auto-close for #${id}`, [
            "Find the ticket channel",
            "Schedule the auto-close",
            "Post the schedule in the ticket"
        ]);
        await progress.start();
        let ticketChannel;
        let scheduled;
        try {
            await progress.runStep(0, async () => {
                ticketChannel = closeCommand.findTicketChannel(interaction.guild, id);
                if (!ticketChannel) throw new ProgressFailure(`Ticket #${id} does not exist.`);
            });
            await progress.runStep(1, async () => {
                scheduled = autocloseScheduler.schedule(ticketChannel, durationMs, interaction.user);
            });
            const action = scheduled.replaced ? "updated" : "scheduled";
            const runAtTimestamp = Math.floor(scheduled.runAt / 1000);
            await progress.runStep(2, () =>
                ticketChannel.send(`⏱️ Ticket #${id} has been auto-close ${action} for <t:${runAtTimestamp}:R>.`)
            );
            await progress.complete(`✅ Auto-close ${action} for ticket #${id} <t:${runAtTimestamp}:R>.`);
        } catch (error) {
            if (error instanceof ProgressFailure) return;
            console.error(`[autoclose] Could not schedule ticket #${id}:`, error.message);
            throw error;
        }
    }
};