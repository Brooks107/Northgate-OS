const state = require("../state");
const {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	PermissionFlagsBits
} = require("discord.js");
const { logCommand } = require("../utils/command-logger");

const LOCKDOWN_ROLE = "1536806576202186842";
const LOCKED_CHANNEL_IDS = [
	"1518976753492693225",
    "1543329472873373706",
    "1518976734433640578",
    "1530164087802167456",
    "1530164050816929933"
];
const VOICE_LOCK_CHANNEL_IDS = new Set([
	"1533079860673515550",
	"1533079884639768717"
]);

module.exports = async function handleAdminCommand(message, config) {
	if (message.author.bot || !message.content.startsWith("a!")) return false;

	if (config.maintenanceMode && !config.developers?.includes(message.author.id)) {
		await message.reply("🔴 The bot is currently offline for maintenance.");
		return true;
	}

	const args = message.content.slice(2).trim().split(/ +/);
	const command = args.shift()?.toLowerCase();
	if (!["forcelock", "forceunlock"].includes(command)) return false;

	await logCommand(message, config, `a!${command}`, "Admin command", args);

	if (!message.member?.roles?.cache?.has(LOCKDOWN_ROLE)) {
		await message.reply("❌ This command is restricted to the admin role.");
		return true;
	}

	if (command === "forcelock") {
		const confirmation = await message.reply({
			content: "⚠️ Are you sure you want to activate the force lock?",
			components: [
				new ActionRowBuilder().addComponents(
					new ButtonBuilder()
						.setCustomId(`force_lock_proceed_${message.id}`)
						.setLabel("Proceed")
						.setStyle(ButtonStyle.Success),
					new ButtonBuilder()
						.setCustomId(`force_lock_abort_${message.id}`)
						.setLabel("Abort")
						.setStyle(ButtonStyle.Danger)
				)
			]
		});

		try {
			const choice = await confirmation.awaitMessageComponent({
				filter: interaction => interaction.user.id === message.author.id,
				time: 30_000
			});

			if (choice.customId === `force_lock_abort_${message.id}`) {
				await choice.update({
					content: "🛑 Force lock aborted.",
					components: []
				});
				return true;
			}

			await choice.update({
				content: "🔒 Force lock confirmed. Applying...",
				components: []
			});
		} catch {
			await confirmation.edit({
				content: "⌛ Force lock confirmation expired. No changes were made.",
				components: []
			});
			return true;
		}
	}

	const channels = await Promise.all(
		LOCKED_CHANNEL_IDS.map(id => message.guild?.channels.fetch(id).catch(() => null))
	);
	const missingChannels = LOCKED_CHANNEL_IDS.filter((id, index) => !channels[index]);
	if (missingChannels.length > 0) {
		await message.reply(`❌ Could not find all lock channels. Missing: ${missingChannels.join(", ")}`);
		return true;
	}

	const shouldLock = command === "forcelock";
	const roles = [...(await message.guild.roles.fetch()).values()];
	const startedAt = process.hrtime.bigint();
	const savedForceLockOverwrites = state.load().forceLockOverwrites;

	try {
		const statusReply = await message.reply(
			shouldLock ? "🔒 Applying force lock..." : "🔓 Applying force unlock..."
		);
		let stateSaved = true;
		const originalOverwrites = {};

		for (const channel of channels) {
			const permission = VOICE_LOCK_CHANNEL_IDS.has(channel.id)
				? PermissionFlagsBits.Connect
				: PermissionFlagsBits.SendMessages;
			const overwrites = new Map(
				channel.permissionOverwrites.cache.map(overwrite => [overwrite.id, {
					id: overwrite.id,
					type: overwrite.type,
					allow: BigInt(overwrite.allow.bitfield),
					deny: BigInt(overwrite.deny.bitfield)
				}])
			);

			if (shouldLock) {
				originalOverwrites[channel.id] = [...overwrites.values()].map(overwrite => ({
					id: overwrite.id,
					type: overwrite.type,
					allow: overwrite.allow.toString(),
					deny: overwrite.deny.toString()
				}));
			}

			for (const role of roles) {
				const existing = overwrites.get(role.id);
				let allow = existing?.allow ?? 0n;
				let deny = existing?.deny ?? 0n;

				if (shouldLock) {
					allow &= ~permission;
					deny |= permission;
				} else {
					allow &= ~permission;
					deny &= ~permission;
				}

				overwrites.set(role.id, { id: role.id, type: 0, allow, deny });
			}

			await channel.permissionOverwrites.set([...overwrites.values()]);
		}

		if (shouldLock) {
			config.locked = true;
			config.forceLocked = true;
			stateSaved = state.save({
				locked: true,
				forceLocked: true,
				forceLockOverwrites: originalOverwrites
			});
		} else if (savedForceLockOverwrites) {
			for (const channel of channels) {
				const original = savedForceLockOverwrites[channel.id];
				if (!original) continue;

				await channel.permissionOverwrites.set(original.map(overwrite => ({
					id: overwrite.id,
					type: overwrite.type,
					allow: BigInt(overwrite.allow),
					deny: BigInt(overwrite.deny)
				})));
			}

			config.locked = false;
			config.forceLocked = false;
			stateSaved = state.save({
				locked: false,
				forceLocked: false,
				forceLockOverwrites: null
			});
		}

		if (typeof message.client.notifyAdminPanelRefresh === "function") {
			await message.client.notifyAdminPanelRefresh();
		}

		if (!stateSaved) {
			await message.reply("❌ Channel permissions changed, but the lock state could not be saved.");
			return true;
		}

		const elapsedMilliseconds = Number(process.hrtime.bigint() - startedAt) / 1e6;
		await statusReply.edit(
			shouldLock
				? `🔒 Force lock completed in ${(elapsedMilliseconds / 1000).toFixed(2)} seconds.`
				: `🔓 Force unlock completed in ${(elapsedMilliseconds / 1000).toFixed(2)} seconds.`
		);
	} catch (error) {
		console.error(`[adminhandler] failed to ${command}:`, error);
		await message.reply("❌ Failed to update the lock channel permissions.");
	}

	return true;
};
