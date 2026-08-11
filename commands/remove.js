    const {
    SlashCommandBuilder,
    PermissionFlagsBits
} = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("remove")
        .setDescription("Remove a user from a ticket by ID.")
        .addIntegerOption(option =>
            option.setName("id")
                .setDescription("The ticket ID.")
                .setRequired(true)
        )
        .addUserOption(option =>
            option.setName("user")
                .setDescription("The user to remove from the ticket.")
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction, client, config) {
        await interaction.deferReply({ ephemeral: true });

        const id = interaction.options.getInteger("id");
        const user = interaction.options.getUser("user");

        // -------------------------------------------------
        // FIND TICKET CHANNEL
        // -------------------------------------------------
        const ticketChannel = interaction.guild.channels.cache.find(
            ch =>
                ch.name.startsWith(`commission-${id}-`) ||
                ch.name.startsWith(`support-${id}-`) ||
                ch.name.startsWith(`appeal-${id}-`)
        );

        if (!ticketChannel) {
            return interaction.editReply(`❌ Ticket #${id} does not exist.`);
        }

        // -------------------------------------------------
        // CHECK USER ACCESS
        // -------------------------------------------------
        const perms = ticketChannel.permissionOverwrites.cache.get(user.id);

        if (!perms) {
            return interaction.editReply(`⚠️ ${user.tag} is not part of ticket #${id}.`);
        }

        // -------------------------------------------------
        // REMOVE USER ACCESS
        // -------------------------------------------------
        await ticketChannel.permissionOverwrites.edit(user.id, {
            ViewChannel: false,
            SendMessages: false,
            ReadMessageHistory: false
        });

        // -------------------------------------------------
        // UPDATE EMBED BUTTON (UNCLAIM)
        // -------------------------------------------------
        try {
            const msg = await ticketChannel.messages.fetch(config.ticketMessageId);
            const row = msg.components[0];

            const updatedRow = row.toJSON();
            updatedRow.components.forEach(btn => {
                if (btn.custom_id === `claim_${id}`) {
                    btn.disabled = false;
                }
            });

            await msg.edit({ components: [updatedRow] });
        } catch (err) {
            console.log("Button update failed:", err);
        }

        // -------------------------------------------------
        // CONFIRMATION
        // -------------------------------------------------
        await interaction.editReply(`👤 Removed **${user.tag}** from ticket #${id}.`);
    }
};
