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
		const isAvailable = status === "available";

		client.user.setActivity(
			`Developers are ${isAvailable ? "available" : "unavailable"},`,
			{ type: ActivityType.Watching }
		);

		await interaction.reply({
			content: `✅ Developer availability set to **${isAvailable ? "available" : "unavailable"}**.`,
			flags: MessageFlags.Ephemeral
		});
	}
};
