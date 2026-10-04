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
        .setName("autocloseabort")
        .setDescription("Cancel an auto-close schedule for a ticket.")
        .addIntegerOption(option =>
            option.setName("id")
                .setDescription("The ticket ID to stop auto-closing")
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction, client, config) {
        if (config.locked) {
            return interaction.reply({
                content: "🚫 NorthGate OS is currently **locked**. Command `/autocloseabort` cannot be used.",
                flags: MessageFlags.Ephemeral
            });
        }

        const id = interaction.options.getInteger("id");
        const progress = createInteractionProgress(interaction, `Cancelling auto-close for #${id}`, [
            "Find the ticket channel",
            "Cancel the scheduled auto-close",
            "Post the cancellation in the ticket"
        ]);
        await progress.start();
        let ticketChannel;
        try {
            await progress.runStep(0, async () => {
                ticketChannel = closeCommand.findTicketChannel(interaction.guild, id);
                if (!ticketChannel) throw new ProgressFailure(`Ticket #${id} does not exist.`);
            });
            await progress.runStep(1, async () => {
                if (!autocloseScheduler.cancel(ticketChannel)) {
                    throw new ProgressFailure(`There is no auto-close scheduled for ticket #${id}.`);
                }
            });
            await progress.runStep(2, () =>
                ticketChannel.send(`🛑 Auto-close was cancelled for ticket #${id}.`)
            );
            await progress.complete(`✅ Auto-close cancelled for ticket #${id}.`);
        } catch (error) {
            if (error instanceof ProgressFailure) return;
            throw error;
        }
    }
};
