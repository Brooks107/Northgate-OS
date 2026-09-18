const {
	SlashCommandBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelType,
	PermissionFlagsBits,
	MessageFlags
} = require("discord.js");

const ticketTopic = require("../ticket-topic");
const ticketTracker = require("../ticket-tracker");

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
		// guild.channels.cache holds threads as well as channels, and /approve
		// opens a forum thread named "commission-<id>" -- exactly the ticket
		// channel's own name. A thread has no topic and no setTopic(), so
		// matching one here either loses the claim or throws. Only ever take the
		// ticket's text channel.
		const ticketChannel = interaction.guild.channels.cache.find(ch =>
			ch.type === ChannelType.GuildText &&
			/^(?:commission|support|appeal|hiring|partnership|interrogation)-\d+(?:-|$)/.test(ch.name) &&
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
		const isInterrogationTicket = ticketChannel.name.startsWith("interrogation-");
		const claimCustomId = isPartnershipTicket
			? "partnership_claim"
			: isHiringTicket
				? "hiring_claim"
				: isSupportTicket
					? "support_claim"
					: isInterrogationTicket
						? "intero_claim"
						: "commission_claim";
		const closeCustomId = isPartnershipTicket
			? "partnership_close"
			: isHiringTicket
				? "hiring_close"
				: isSupportTicket
					? "support_close"
					: isInterrogationTicket
						? "intero_close"
						: "ticket_close";

		// -------------------------------------------------
		// MOVE THE CLAIM (TOPIC FIRST)
		// -------------------------------------------------
		// The topic is the only record of who holds the ticket -- /claim,
		// /unclaim and /transfer all read it. Write it before touching the
		// buttons, so a failure here cannot leave a message advertising a
		// transfer that never actually happened.
		const botMember = interaction.guild.members.me;
		if (botMember && !ticketChannel.permissionsFor(botMember)?.has(PermissionFlagsBits.ManageChannels)) {
			return interaction.editReply(
				`❌ I need the **Manage Channel** permission in <#${ticketChannel.id}> to transfer this ticket.`
			);
		}

		try {
			await ticketChannel.setTopic(ticketTopic.build({
				ownerId,
				claimedBy: recipient.id
			}));
		} catch (err) {
			console.error(`[transfer] could not set the topic of #${ticketChannel.name}:`, err);
			return interaction.editReply(
				`❌ Ticket #${id} was not transferred -- I could not update the channel topic: ${err.message}`
			);
		}

		await ticketTracker.syncTicket(ticketChannel, {
			type: "transferred",
			status: `🟡 Transferred to ${recipient.tag}`,
			userId: recipient.id
		});

		// The claim has moved at this point. A failed button edit leaves a stale
		// label, which is worth reporting but must not read as a failed transfer.
		try {
			await ticketMessage.edit({
				embeds: ticketMessage.embeds,
				components: [new ActionRowBuilder().addComponents(
					new ButtonBuilder()
						.setCustomId(claimCustomId)
						.setLabel(`Claimed by ${recipient.username}`)
						.setStyle(ButtonStyle.Primary)
						.setDisabled(true),
					new ButtonBuilder()
						.setCustomId(closeCustomId)
						.setLabel("🔒 Close Ticket")
						.setStyle(ButtonStyle.Danger)
				)]
			});
		} catch (err) {
			console.error(`[transfer] could not update the ticket message in #${ticketChannel.name}:`, err);
			return interaction.editReply(
				`⚠️ Ticket #${id} has been transferred to <@${recipient.id}>, but the ticket buttons could not be updated: ${err.message}`
			);
		}

		await interaction.editReply(`✅ Ticket #${id} has been transferred to <@${recipient.id}>.`);
	}
};
