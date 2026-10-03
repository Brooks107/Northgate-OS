const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");

const closeCommand = require("./close");
const autocloseScheduler = require("../autoclose-scheduler");

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

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const id = interaction.options.getInteger("id");
        const ticketChannel = closeCommand.findTicketChannel(interaction.guild, id);

        if (!ticketChannel) {
            return interaction.editReply(`❌ Ticket #${id} does not exist.`);
        }

        const cancelled = autocloseScheduler.cancel(ticketChannel);
        if (!cancelled) {
            return interaction.editReply(`❌ There is no auto-close scheduled for ticket #${id}.`);
        }

        await ticketChannel.send(`🛑 Auto-close was cancelled for ticket #${id}.`);
        return interaction.editReply(`✅ Auto-close cancelled for ticket #${id}.`);
    }
};
