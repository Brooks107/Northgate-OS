const {
	SlashCommandBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	MessageFlags
} = require("discord.js");

const ticketTopic = require("../ticket-topic");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("transfer")
		.setDescription("Transfer a claimed ticket to another staff member.")
		.addIntegerOption(option =>
			option.setName("id")
				.setDescription("The ticket ID to transfer")
				.setRequired(true)
		)
		.addUserOption(option =>
			option.setName("user")
				.setDescription("The staff member who will receive the claim")
				.setRequired(true)
		),

	async execute(interaction, client, config) {
		if (config.locked) {
			return interaction.reply({
				content: "🚫 NorthGate OS is currently **locked**. Command `/transfer` cannot be used.",
				flags: MessageFlags.Ephemeral
			});
		}

		const isAuthorized = config.supportTeamRoles?.some(roleId =>
			interaction.member?.roles?.cache?.has(roleId)
		) || config.commissionticketaccess?.some(roleId =>
			interaction.member?.roles?.cache?.has(roleId)
		);

		if (!isAuthorized) {
			return interaction.reply({
				content: "❌ You are not authorized to use `/transfer`.",
				flags: MessageFlags.Ephemeral
			});
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const id = interaction.options.getInteger("id");
		const recipient = interaction.options.getUser("user");
		const ticketChannel = interaction.guild.channels.cache.find(ch =>
			/^(?:commission|support|appeal|hiring|partnership)-\d+(?:-|$)/.test(ch.name) &&
			ch.name.match(/-(\d+)(?:-|$)/)?.[1] === String(id)
		);

		if (!ticketChannel) {
			return interaction.editReply(`❌ Ticket #${id} does not exist.`);
		}

		const { ownerId, claimedBy } = ticketTopic.parse(ticketChannel.topic);
		if (!claimedBy) {
			return interaction.editReply(`❌ Ticket #${id} is not currently claimed.`);
		}

		if (claimedBy !== interaction.user.id) {
			return interaction.editReply("❌ Only the person who claimed this ticket can transfer it.");
		}

		if (recipient.id === interaction.user.id) {
			return interaction.editReply("❌ You cannot transfer a ticket to yourself.");
		}

		const messages = await ticketChannel.messages.fetch({ limit: 100 });
		const ticketMessage = messages.find(m =>
			m.embeds.length > 0 &&
			m.embeds[0].title &&
			m.embeds[0].title.includes(`#${id}`)
		);

		if (!ticketMessage) {
			return interaction.editReply("❌ Could not find the ticket message.");
		}

		const isSupportTicket =
			ticketChannel.name.startsWith("support-") ||
			ticketChannel.name.startsWith("appeal-");
		const isHiringTicket = ticketChannel.name.startsWith("hiring-");
		const isPartnershipTicket = ticketChannel.name.startsWith("partnership-");
		const claimCustomId = isPartnershipTicket
			? "partnership_claim"
			: isHiringTicket
				? "hiring_claim"
				: isSupportTicket
					? "support_claim"
					: "commission_claim";
		const closeCustomId = isPartnershipTicket
			? "partnership_close"
			: isHiringTicket
				? "hiring_close"
				: isSupportTicket
					? "support_close"
					: "ticket_close";

		await ticketMessage.edit({
			embeds: ticketMessage.embeds,
			components: [new ActionRowBuilder().addComponents(
				new ButtonBuilder()
					.setCustomId(claimCustomId)
					.setLabel("📝 Claim Ticket")
					.setStyle(ButtonStyle.Primary),
				new ButtonBuilder()
					.setCustomId(closeCustomId)
					.setLabel("🔒 Close Ticket")
					.setStyle(ButtonStyle.Danger)
			)]
		});

		await ticketChannel.setTopic(ticketTopic.build({ ownerId }));
		await interaction.editReply(`✅ Ticket #${id} has been transferred to <@${recipient.id}> and unclaimed.`);
	}
};
