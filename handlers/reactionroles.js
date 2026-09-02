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

function getPingRoleIds(config) {
	return [...getReactionRoleMap(config).values()].filter(Boolean);
}

async function syncHeaderRole(member, config) {
	const headerRoleId = config.pings?.headerrole;
	if (!headerRoleId) return;

	const headerRole = member.guild.roles.cache.get(headerRoleId);
	if (!headerRole) return;

	const hasPingRole = getPingRoleIds(config).some(roleId => member.roles.cache.has(roleId));
	if (hasPingRole && !member.roles.cache.has(headerRoleId)) {
		await member.roles.add(headerRole, "Notification role selected");
	} else if (!hasPingRole && member.roles.cache.has(headerRoleId)) {
		await member.roles.remove(headerRole, "All notification roles removed");
	}
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

	await syncHeaderRole(member, config);
}

module.exports = {
	async handleAdd(reaction, user, config) {
		await updateRole(reaction, user, config, true);
	},

	async handleRemove(reaction, user, config) {
		await updateRole(reaction, user, config, false);
	}
};
