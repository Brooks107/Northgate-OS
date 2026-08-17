const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("add")
        .setDescription("Add a user to a ticket by ID.")
        .addIntegerOption(option =>
            option.setName("id")
                .setDescription("The ticket ID.")
                .setRequired(true)
        )
        .addUserOption(option =>
            option.setName("user")
                .setDescription("The user to add to the ticket.")
                .setRequired(true)
        ),

    async execute(interaction, client, config) {
        const isAuthorized = (config.supportTeamRoles?.some(roleId =>
            interaction.member?.roles?.cache?.has(roleId)
        ) || config.commissionticketaccess?.some(roleId =>
            interaction.member?.roles?.cache?.has(roleId)
        ));

        if (!isAuthorized) {
            return interaction.reply({
                content: "❌ You are not authorized to use `/add`.",
                ephemeral: true
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const id = interaction.options.getInteger("id");
        const user = interaction.options.getUser("user");

        // -------------------------------------------------
        // FIND TICKET CHANNEL
        // -------------------------------------------------
        const ticketChannel = interaction.guild.channels.cache.find(
            ch =>
                ch.name.startsWith(`commission-${id}`) ||
                ch.name.startsWith(`support-${id}`) ||
                ch.name.startsWith(`appeal-${id}`)
        );

        if (!ticketChannel) {
            return interaction.editReply(`❌ Ticket #${id} does not exist.`);
        }

        // -------------------------------------------------
        // CHECK USER ACCESS
        // -------------------------------------------------
        const perms = ticketChannel.permissionOverwrites.cache.get(user.id);


        // -------------------------------------------------
        // ADD USER ACCESS
        // -------------------------------------------------
        await ticketChannel.permissionOverwrites.edit(user.id, {
            ViewChannel: true,
            SendMessages: true, 
            ReadMessageHistory: true
        });

        // -------------------------------------------------
        // CONFIRMATION
        // -------------------------------------------------
        await interaction.editReply(`👤 Added **${user.tag}** to ticket #${id}.`);
    }
};
