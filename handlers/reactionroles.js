const REACTION_ROLE_TITLE = "NorthGate Notification Roles";

function getReactionRoleMap(config) {
	return new Map([
		["📢", config.pings?.announcementid],
		["📅", config.pings?.eventpingid],
		["🎁", config.pings?.giveawayid],
		["🎮", config.pings?.gamenightid],
		["❓", config.pings?.qotdid],
		["💻", config.pings?.devpingid],
		["❗", config.pings?.importantid]
	]);
}

async function updateRole(reaction, user, config, add) {
	if (user.bot) return;
	if (reaction.partial) await reaction.fetch().catch(() => null);
	if (!reaction.message.guild) return;
	if (!reaction.message.embeds.some(embed => embed.title === REACTION_ROLE_TITLE)) return;

	const roleId = getReactionRoleMap(config).get(reaction.emoji.name);
	if (!roleId) return;

	const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
	const role = reaction.message.guild.roles.cache.get(roleId);
	if (!member || !role) return;

	if (add) {
		await member.roles.add(role, "Reaction role selected");
	} else {
		await member.roles.remove(role, "Reaction role deselected");
	}
}

module.exports = {
	async handleAdd(reaction, user, config) {
		await updateRole(reaction, user, config, true);
	},

	async handleRemove(reaction, user, config) {
		await updateRole(reaction, user, config, false);
	}
};
