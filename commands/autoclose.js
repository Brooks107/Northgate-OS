const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");

const closeCommand = require("./close");
const autocloseScheduler = require("../autoclose-scheduler");

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

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const id = interaction.options.getInteger("id");
        const durationText = interaction.options.getString("duration");
        const durationMs = autocloseScheduler.parseDuration(durationText);
        if (!durationMs) {
            return interaction.editReply("❌ Use a duration like `30s`, `15m`, `2h`, or `1d` (maximum `30d`).");
        }

        const ticketChannel = closeCommand.findTicketChannel(interaction.guild, id);
        if (!ticketChannel) {
            return interaction.editReply(`❌ Ticket #${id} does not exist.`);
        }

        try {
            const scheduled = autocloseScheduler.schedule(ticketChannel, durationMs, interaction.user);
            const action = scheduled.replaced ? "updated" : "scheduled";
            return interaction.editReply(`⏱️ Auto-close ${action} for ticket #${id} <t:${Math.floor(scheduled.runAt / 1000)}:R>.`);
        } catch (error) {
            console.error(`[autoclose] Could not schedule ticket #${id}:`, error.message);
            return interaction.editReply("❌ I couldn't save that auto-close schedule. Please try again.");
        }
    }
};