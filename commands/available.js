const { SlashCommandBuilder, ActivityType, MessageFlags } = require("discord.js");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("available")
		.setDescription("Set whether the developers are available.")
		.addStringOption(option =>
			option
				.setName("status")
				.setDescription("The developers' current availability.")
				.setRequired(true)
				.addChoices(
					{ name: "Available", value: "available" },
					{ name: "Unavailable", value: "unavailable" }
				)
		),

	async execute(interaction, client, config) {
		if (!config.developers?.includes(interaction.user.id)) {
			return interaction.reply({
				content: "❌ Only developers can use `/available`.",
				flags: MessageFlags.Ephemeral
			});
		}

		const status = interaction.options.getString("status");

		if (status === "available") {
			client.user.setPresence({
				activities: [{
					name: "custom",
					state: "Developers are available, Feel free to open a ticket or DM an online member of the IT team for support",
					type: ActivityType.Custom
				}]
			});

			return interaction.reply({
				content: "✅ Developer availability set to **available**.",
				flags: MessageFlags.Ephemeral
			});
		}

		if (status === "unavailable") {
			client.user.setPresence({
				activities: [{
					name: "custom",
					state: "Developers are unavailable, Please direct your issues to a member of the High Command Team",
					type: ActivityType.Custom
				}]
			});

			return interaction.reply({
				content: "✅ Developer availability set to **unavailable**.",
				flags: MessageFlags.Ephemeral
			});
		}
	}
};
