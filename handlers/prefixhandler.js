const { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require("discord.js");
const ticketTopic = require("../ticket-topic");
const ticketTracker = require("../ticket-tracker");
const { logCommand } = require("../utils/command-logger");
const { buildHelpEmbeds, packIntoMessages } = require("../utils/help");

// !help sends one embed per NorthGate bot. The command tables live in
// ../utils/help, which is also where a new command has to be added.
async function sendPrivateHelp(message) {
	const messages = packIntoMessages(buildHelpEmbeds(message.client));

	await message.delete().catch(() => {});
	try {
		for (const embeds of messages) await message.author.send({ embeds });
	} catch {
		const fallback = await message.channel.send({
			content: "❌ I could not DM you the command list. Please turn on direct messages from server members and try `!help` again.",
			allowedMentions: { users: [] }
		});
		setTimeout(() => fallback.delete().catch(() => {}), 10_000);
	}
}

module.exports = async function handlePrefixCommand(message, config) {
	if (message.author.bot) return;

	if (message.content.trim().toLowerCase() === "!help") {
		await logCommand(message, config, "!help", "Prefix command", []);
		await sendPrivateHelp(message);
		return;
	}

	if (
		config.maintenanceMode &&
		(message.content.startsWith("!msg") || message.content.startsWith("d!") || message.content.startsWith("n!")) &&
		!config.developers?.includes(message.author.id)
	) {
		await message.reply("🔴 The bot is currently offline for maintenance.");
		return;
	}

	if (message.channel.isDMBased?.() && message.content.startsWith("!msg")) {
		const match = message.content.match(/^!msg\s+(\d+)\s+([\s\S]+)$/);
		if (!match) {
			return message.reply("❌ Usage: `!msg <channel id> <message>`");
		}

		await logCommand(message, config, "!msg", "Developer DM command", [match[1], match[2].trim()]);

		if (!config.developers?.includes(message.author.id)) {
			return message.reply("❌ Only developers can use this command.");
		}

		const channel = await message.client.channels.fetch(match[1]).catch(() => null);
		if (!channel?.isTextBased?.() || typeof channel.send !== "function") {
			return message.reply("❌ I could not find a text channel with that ID or I cannot send messages there.");
		}

		try {
			await channel.send(match[2].trim());
			return message.reply(`✅ Message sent to <#${channel.id}>.`);
		} catch (error) {
			console.error("[msg] failed to send message from DM:", error);
			return message.reply("❌ I could not send a message in that channel. Check my channel permissions.");
		}
	}

	if (message.content.startsWith("d!")) {
		const args = message.content.slice(2).trim().split(/ +/);
		const command = args.shift()?.toLowerCase();

		if (command === "forceclaim") {
			await logCommand(message, config, `d!${command}`, "Developer command", args);

			if (!config.developers?.includes(message.author.id)) {
				return message.reply("❌ Only developers can run this command - It is used to fix claiming issues and override any problems by forcing claim onto the author of the command");
			}

			const id = Number(args[0]);
			if (!Number.isInteger(id) || id < 1) {
				return message.reply("❌ Please provide a valid ticket ID: `d!forceclaim <id>`");
			}

			const ticketChannel = message.guild?.channels.cache.find(channel =>
				channel.name.startsWith(`commission-${id}`) ||
				channel.name.startsWith(`support-${id}`) ||
				channel.name.startsWith(`appeal-${id}`) ||
				channel.name.startsWith(`hiring-${id}`) ||
				channel.name.startsWith(`partnership-${id}`) ||
				channel.name.startsWith(`interrogation-${id}`)
			);

			if (!ticketChannel) {
				return message.reply(`❌ Ticket #${id} does not exist.`);
			}

			const messages = await ticketChannel.messages.fetch({ limit: 10 });
			const ticketMessage = messages.find(ticket => ticket.author.id === message.client.user.id);
			if (!ticketMessage) {
				return message.reply("❌ Could not find the ticket message.");
			}

			const row = new ActionRowBuilder().addComponents(
				new ButtonBuilder()
					.setCustomId("ticket_close")
					.setLabel("🔒 Close Ticket")
					.setStyle(ButtonStyle.Danger)
			);

			await ticketMessage.edit({ components: [row] });
			const { ownerId } = ticketTopic.parse(ticketChannel.topic);
			await ticketChannel.setTopic(ticketTopic.build({ ownerId, claimedBy: message.author.id }));

			return message.reply(`📝 You have force claimed ticket #${id}.`);
		}
	}

	const prefix = "n!";
	if (!message.content.startsWith(prefix)) return;

	const args = message.content.slice(prefix.length).trim().split(/ +/);
	const command = args.shift()?.toLowerCase();
	const recognizedCommands = new Set(["ping", "purge", "links", "rules", "inject"]);

	if (recognizedCommands.has(command)) {
		await logCommand(message, config, `n!${command}`, "Prefix command", args);
	}

	if (command === "inject") {
		const ticketId = Number(args.shift());
		const info = args.join(" ");

		if (!Number.isInteger(ticketId) || ticketId < 1) {
			return message.reply("❌ Usage: `n!inject <ticket id> <info>`");
		}

		const isStaff = config.supportTeamRoles?.some(roleId =>
			message.member?.roles?.cache?.has(roleId)
		) || config.commissionticketaccess?.some(roleId =>
			message.member?.roles?.cache?.has(roleId)
		) || config.developers?.includes(message.author.id);

		if (!isStaff) {
			return message.reply({ content: "❌ Only staff can inject info into a ticket.", ephemeral: true });
		}

		if (!info) {
			return message.reply({ content: "❌ Please provide info to inject: `n!inject <ticket id> <info>`", ephemeral: true });
		}

		const ticketChannel = message.guild?.channels.cache.find(channel =>
			channel.name.startsWith("support-") ||
			channel.name.startsWith("appeal-") ||
			channel.name.startsWith("commission-") ||
			channel.name.startsWith("hiring-") ||
			channel.name.startsWith("partnership-")
		) && message.guild.channels.cache.find(channel =>
			channel.name === `support-${ticketId}` ||
			channel.name === `appeal-${ticketId}` ||
			channel.name === `commission-${ticketId}` ||
			channel.name === `hiring-${ticketId}` ||
			channel.name === `partnership-${ticketId}` ||
			channel.name === `interrogation-${ticketId}`
		);

		if (!ticketChannel) {
			return message.reply(`❌ Ticket #${ticketId} does not exist in this server.`);
		}

		const result = await ticketTracker.injectInfo(ticketChannel, info, message.client);
		if (result.success) {
			await message.react("✅");
			await message.Reply("Your info has been loaded into the ticket tracker and archived")
			console.log(`[inject] ${message.author.tag} injected info into ${ticketChannel.name}`);
			return;
		}

		return message.reply({ content: `❌ ${result.error}`, ephemeral: true });
	}

	if (command === "ping") {
		const sent = await message.reply("Pinging...");
		const latency = sent.createdTimestamp - message.createdTimestamp;
		await sent.edit(`🏓 Pong! Latency: **${latency}ms**`);
		return;
	}
   
	if (command === "purge") {
	if (!message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) {
	    return message.reply("❌ You need the **Manage Messages** permission to use this command.");
	}

        const amount = parseInt(args[0]);
        if (!amount || amount < 1 || amount > 100) {
            return message.reply("Please provide a number between **1** and **100**.");
        }

        await message.delete().catch(() => {});
        const messages = await message.channel.messages.fetch({ limit: amount });
        await message.channel.bulkDelete(messages, true);

        message.channel.send(`🧹 Deleted **${amount}** messages.`)
            .then(msg => setTimeout(() => msg.delete().catch(() => {}), 3000));
    }


	if (command === "links") {
		if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
			return message.reply("❌ Only administrators can use this command.");
		}

		const linksChannelId = (
			config.channels?.linkschannel?.id ??
			config.channels?.linkschannelid ??
			config.channels?.linksChannelId ??
			config.linksChannelId ??
			config.linkschannelid
		);

		if (!linksChannelId || !/^[0-9]+$/.test(String(linksChannelId))) {
			console.warn("[links] no valid links channel configured");
			return message.reply("❌ The links channel is not configured yet.");
		}

		const linksChannel = await message.guild?.channels.fetch(linksChannelId).catch(() => null);
		if (!linksChannel || !linksChannel.isTextBased?.()) {
			console.warn(`[links] configured channel ${linksChannelId} is not a valid text channel`);
			return message.reply("❌ The configured links channel is invalid or not accessible.");
		}

		const embed = {
			title: "Northgate Studios Portfolio",
			description: "Below you can find our official links to our projects, website, social media platforms and more.",
			color: 0x00ff00,
			image: {
				url: "https://media.discordapp.net/attachments/1444636404801081448/1535285319123861534/Pixelated_Animated_Nostalgic_90s_Illustrations_Discord_Profile_Banner_13.gif?ex=6a98d3a0&is=6a978220&hm=ce2bb40a5d10ad11b9ec19aa3f0ba9a205639cbc6a95f8ef7b7f684111c81275&"
			},
			footer: {
				text: "Created by Brooks | Powered By Vortigern Industries"
			},
			fields: [
				{
					name: "Our Website",
					value: "[Our Website](https://northgate-studios.com/)"
				},
				{
					name: "Our Website Status Page",
					value: "[Status Page](https://status.vortigernindustries.com)"
				},
				{
					name: "SPONSORS",
					value: "[United Custom Servers Organisation](https://discord.gg/mSbgZbKAGa)\n[Vortigern Industries](https://discord.gg/XHZJ9qjs2B)"
				},
				{
					name: "Our Youtube",
					value: "[Northgate Studios](https://www.youtube.com/@NorthGate.Studios)"
				},
				{
					name: "Our Roblox Group",
					value: "[Northgate Studios](https://www.roblox.com/communities/33030494/NORTHGATE-Studios#!/about)"
				}
			]
		};

		try {
			await linksChannel.send({ embeds: [embed] });
		} catch (err) {
			console.error("[links] failed to send links embed:", err);
			return message.reply("❌ I cannot send the links embed in that channel. Check channel permissions.");
		}

		return;
	}

	if (command === "rules") {
		if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
			return message.reply("❌ Only administrators can use this command.");
		}

		const rulesChannelId = (
			config.channels?.ruleschannel?.id ??
			config.channels?.ruleschannelid ??
			config.channels?.rulesChannelId ??
			config.rulesChannelId ??
			config.ruleschannelid
		);

		if (!rulesChannelId || !/^[0-9]+$/.test(String(rulesChannelId))) {
			console.warn("[rules] no valid rules channel configured");
			return message.reply("❌ The rules channel is not configured yet.");
		}

		const rulesChannel = await message.guild?.channels.fetch(rulesChannelId).catch(() => null);
		if (!rulesChannel || !rulesChannel.isTextBased?.()) {
			console.warn(`[rules] configured rules channel ${rulesChannelId} is not a valid text channel`);
			return message.reply("❌ The configured rules channel is invalid or not accessible.");
		}

		const embed = {
			title: "Northgate Studios Rules",
			description: [
				"**NOTICE**",
				"",
				"By joining any Northgate Studios server, project, game, or community, you agree to follow all rules, policies, and staff decisions enforced by Northgate.",
				"",
				"These policies take effect across all Northgate Studios' projects.",
				"",
				"Northgate Studios reserves the right to warn, kick, remove, suspend, ban, or otherwise take administrative action against any community of staff member at any time with or without notice, for any reason deemed appropriate by staff members of ownership.",
				"",
				"",
				"---------------------------------------------------"
			].join("\n"),
			image: {
				url: "https://cdn.discordapp.com/attachments/1172091235461238815/1518658520948408330/Copy_of_Studio_intro.gif?ex=6a98fbb6&is=6a97aa36&hm=e642fd4324eeb9a807652e1e1f6684b562058aec310c6c8bedf367267d3d81c9&"
			},
			footer: {
				text: "Created by Casper | Powered By Vortigern Industries"
			},
			fields: [
				{
					name: "Be respectful.",
					value: "This means no derogatory, rude, or harassing comments. Treat others as you want to be treated."
				},
				{
					name: "No inappropriate language.",
					value: "Keep profanity to a reasonable minimum. Any derogatory language directed at any user is prohibited. Swearing is permitted only in casual channels, while profanity should be avoided in all other channels."
				},
				{
					name: "No spamming.",
					value: "Do not send a series of small messages one after another. These interupt the chat and can make it difficult to scroll through the server. Pleqase keep your messages to atleast 5 words long while chatting unless the situation is deemed appropriate by staff."
				},
				{
					name: "No pornographic, explicit or adult content",
					value: "Under no circumstances should any member of this server including staff members post pornographic, explicit or adult content. Here at Northgate we stride to provide a safe community for our members and younger users here at Northgate."
				},
				{
					name: "No advertising.",
					value: "Do not send invasive or unsolicited advertisements Whether it is other communities or streams, you can post your content in the media channel if it is relevant, follows all rules and is beneficial to the community. If you are unsure, please ask a staff member before posting."
				},
				{
					name: "Do not share personally identifiable information (PII).",
					value: "Do not share any personally identifiable information (PII) about yourself or others, including but not limited to addresses, phone numbers, email addresses, and social security numbers and other private information."
				},
				{
					name: "Avoid any misleading or false information.",
					value: "Please check the authenticity of any information before sharing it around our community, and only share from reliable and trusted sources, False or misleading information can be harmful, undermining trust and integrity between members of the community. If you are unsure, please ask a staff member before sharing."
				},
				{
					name: "Follow the per-channel instructions.",
					value: "Each channel on the server has its own set of rules about what kind of content is permitted. Please follow these guidelines and understand the purpose of each channel."
				},
				{
					name: "Follow Discord's Terms of Service and Community Guidelines.",
					value: "All members of this server must follow Discord's Terms of Service and Community Guidelines. Any violation of these rules may result in disciplinary action, including but not limited to warnings, temporary or permanent bans from the server, or legal action if necessary."
				},
				{
					name: "Do not share or distribute hacks, cheats, or other unauthorized tools or services.",
					value: "The server strictly prohibits the sharing or distribution of hacks, cheats, or other unauthorized tools or services."
				},
				{
					name: "Do not share or distribute viruses or malicious software.",
					value: "The server strictly prohibits the sharing or distribution of viruses or malicious software."
				},
				{
					name: "Do not impersonate other users or staff members or any other organisation.",
					value: "This includes but is not limited to using similar usernames, profile pictures, or other identifying information to mislead others into thinking you are someone else. Impersonation can cause confusion and harm to the community and is strictly prohibited."
				},
				{
					name: "Do not abuse server bots or other automated systems.",
					value: "Do not attempt to bypass, exploit or otherwise misuse our server bots - Especially our custom bots, spamming commands, features or constantly triggering automod responses can crash the bot and any other bots ran on the hosting service, distrupting bots for multiple different organisations throughout SCP:RP and Vortigern Industries."
				},
				{
					name: "Do not engage in any illegal activities.",
					value: [
						"This includes but is not limited to sharing or distributing illegal content, engaging in illegal activities, or promoting illegal activities. Any illegal activities will be reported to the appropriate authorities and may result in legal action.",
						"",
						"",
						"TL:DR",
						"Have Common Sense"
					].join("\n")
				}
			]
		};

		try {
			await rulesChannel.send({ embeds: [embed] });
		} catch (err) {
			console.error("[rules] failed to send rules embed:", err);
			return message.reply("❌ I cannot send the rules embed in that channel. Check channel permissions.");
		}
	}
};
