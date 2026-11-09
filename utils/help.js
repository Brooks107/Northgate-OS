// utils/help.js
// The !help command: one embed per NorthGate bot, sent by DM.
//
// NorthGate OS is the only bot this process can read at runtime, so its slash
// commands come straight from client.commands and can never go stale. North
// Shield and Staff Management are separate bots in separate processes, so their
// commands are listed in the tables below BY HAND. Add, rename or remove a
// command in one of those bots and this file has to be changed too, or !help
// will describe a command that no longer exists.

const { EmbedBuilder } = require("discord.js");

// Discord's limits. A field value over 1024, an embed over 6000, or a message
// whose embeds add up to over 6000 is rejected outright, and a rejected DM looks
// to the person like the bot simply ignored them.
const FIELD_MAX = 1024;
const MAX_FIELDS = 25;
const MESSAGE_EMBED_MAX = 6000;
const MESSAGE_EMBED_COUNT = 10;

// Who can run each of NorthGate OS's own slash commands. A command missing from
// here is still listed, with the general note in northgateOsEmbed.
const SLASH_COMMAND_ACCESS = {
	available: "Developers",
	adminpanel: "Developers or ownership",
	cmdlock: "Server administrators",
	cmdunlock: "Server administrators",
	add: "Support access",
	claim: "Support access",
	interrogate: "Operations access",
	remove: "Support access",
	transfer: "Support access",
	unclaim: "Support access",
	managementvclock: "Developers, ownership, or HR directors",
	close: "Ticket users and staff, subject to ticket access",
	autoclose: "Members with Manage Channels",
	autocloseabort: "Members with Manage Channels",
	itsupport: "Everyone",
	requestmanagementvc: "Everyone",
	ticketpanel: "Staff with ticket-panel access",
	hiringpanel: "Staff with hiring-panel access",
	partnerpanel: "Staff with partnership-panel access",
	reactionpanel: "Staff with reaction-panel access"
};

const NORTHGATE_OS_PREFIX = [
	["!help", "Show this command list by DM.", "Everyone"],
	["n!ping", "Check the bot's response latency.", "Everyone"],
	["n!purge <1-100>", "Delete recent messages from this channel.", "Anyone with Manage Messages"],
	["n!links", "Post the official Northgate links in the links channel.", "Administrators"],
	["n!rules", "Post the server rules in the rules channel.", "Administrators"],
	["n!ticketrules", "Post the ticket regulations in this channel.", "Administrators"],
	["n!inject <ticket id> <info>", "Add information to a tracked ticket.", "Support or developers"],
	["n!sub <ticket id> <note id> <message>", "Replace a progress note, or delete it when the message is blank.", "Support or developers"],
	["d!forceclaim <ticket id>", "Force-claim a ticket for yourself.", "Developers"],
	["d!addgroup <group> <role/user ID>", "Add an ID to a configured role group.", "Developers"],
	["d!delgroup <group> <role/user ID>", "Remove an ID from a configured role group.", "Developers"],
	["d!showgroup <group>", "Show the configured IDs in a group.", "Developers"],
	["d!forceclose", "Force-close a ticket and save its transcript.", "Developers, inside a ticket"],
	["d!impersonate <user> <command>", "Check whether someone could run a command, without running it; use `d!impersonate list` to show slash and prefix commands.", "Developers"],
	["d!power <on|off|status>", "Turn the bot on or off, or see its power status.", "Developers; ownership can turn it off"],
	["d!forcerestart", "Restart the bot immediately.", "Developers"],
	["!msg <channel id> <message>", "Send a message to a channel from a developer DM.", "Developers, from DMs"],
	["a!forcelock", "Lock the configured channels and voice channels immediately.", "Members with the lockdown role"],
	["a!forceunlock", "Restore the configured channels after a force lock.", "Members with the lockdown role"]
];

// ---------------------------------------------------------------------------
// The other two bots, listed by hand. Keep these in step with their repos.
// ---------------------------------------------------------------------------

const NORTH_SHIELD_SLASH = [
	["/ping", "Check North Shield is running.", "Everyone"],
	["/config", "View or change North Shield's settings.", "Bot owners"]
];

const NORTH_SHIELD_PREFIX = [
	["d!impersonate <user> <command>", "Check whether someone could run a North Shield command, without running it.", "Bot owners"]
];

const STAFF_SLASH = [
	["/hire", "Add someone to the roster, give them their rank role, and welcome them.", "HR"],
	["/promote", "New roster title, swap their rank role, and log it.", "Staff Leadership"],
	["/demote", "The same as /promote, logged in the infraction log instead.", "Staff Leadership"],
	["/fire", "Move someone out of a department, onto the Former Staff Roster.", "HR"],
	["/suspend", "Set their roster status to Suspended.", "HR"],
	["/unsuspend", "Set their roster status back to Active.", "HR"],
	["/loalog", "Start a leave with an end date, or end one early. They return to Active by themselves.", "HR"],
	["/infract", "Log an infraction, DM them, and record it on the roster.", "HR"],
	["/addnote", "Add a dated, signed note to their roster notes.", "HR"],
	["/setperformancerating", "Set their Performance rating on the roster, 0 to 5 stars.", "HR"],
	["/setactivityrating", "Set their Activity rating on the roster, 0 to 5 stars.", "HR"],
	["/hrpanel", "See who is at or below 3 stars and who is on leave right now.", "Administrators"],
	["/reportembed", "Post the staff report panel.", "Staff Leadership"],
	["/config", "Set up the bot for a server.", "Bot owners"]
];

const STAFF_PREFIX = [
	["d!impersonate <user> <command>", "Check whether someone could run a Staff Management command, without running it.", "Bot owners"]
];

// Slash command names that belong to the other NorthGate bots. d!impersonate
// leaves these to the bot that owns them, which checks its own settings.
const OTHER_BOT_COMMANDS = new Set(
	[...NORTH_SHIELD_SLASH, ...STAFF_SLASH].map(([name]) => name.replace(/^\//, ""))
);

// ---------------------------------------------------------------------------
// Building the embeds
// ---------------------------------------------------------------------------

const line = ([name, description, access]) => `**${name}** - ${description}\n *${access}*`;

// Spreads lines over as many fields as they need, because one field cannot hold
// more than 1024 characters. A single line too long to ever fit is shortened
// rather than taking its whole field down with it.
function fieldsFor(heading, lines) {
	const fields = [];
	let value = "";

	const push = () => {
		if (!value) return;
		fields.push({
			name: fields.length === 0 ? heading : `${heading} (continued)`,
			value
		});
		value = "";
	};

	for (const text of lines) {
		const entry = text.length > FIELD_MAX ? `${text.slice(0, FIELD_MAX - 1)}…` : text;
		if (value && value.length + 1 + entry.length > FIELD_MAX) push();
		value += (value ? "\n" : "") + entry;
	}
	push();

	return fields;
}

function buildEmbed({ title, colour, description, slash, prefix, footer }) {
	const fields = [
		...fieldsFor("Slash commands", slash.map(line)),
		...fieldsFor("Prefix commands", prefix.map(line))
	];

	const embed = new EmbedBuilder()
		.setTitle(title)
		.setColor(colour)
		.setDescription(description)
		.addFields(fields.slice(0, MAX_FIELDS));

	if (footer) embed.setFooter({ text: footer });
	return embed;
}

// NorthGate OS's own commands, read from what is actually loaded right now.
function northgateOsEmbed(client) {
	const slash = [...(client.commands?.values() || [])]
		.map(command => command.data.toJSON())
		.sort((a, b) => a.name.localeCompare(b.name))
		.map(command => [
			`/${command.name}`,
			command.description || "No description provided.",
			SLASH_COMMAND_ACCESS[command.name] || "Server members, where the command's ticket or channel rules allow it"
		]);

	return buildEmbed({
		title: "NorthGate OS",
		colour: 0x3498db,
		description: "Tickets, panels, lockdowns and server management.",
		slash: slash.length ? slash : [["(none loaded)", "No slash commands are loaded right now.", "-"]],
		prefix: NORTHGATE_OS_PREFIX
	});
}

function northShieldEmbed() {
	return buildEmbed({
		title: "North Shield",
		colour: 0xe67e22,
		description: "Moderation. Being rebuilt: only its setup commands are live right now.",
		slash: NORTH_SHIELD_SLASH,
		prefix: NORTH_SHIELD_PREFIX
	});
}

function staffManagementEmbed() {
	return buildEmbed({
		title: "NorthGate Studios Staff Management",
		colour: 0x2ecc71,
		description: "HR: the staff roster, hiring, promotions, leave and infractions.",
		slash: STAFF_SLASH,
		prefix: STAFF_PREFIX,
		footer: "In a hiring ticket, run /hire with only department, sheet_rank and rank."
	});
}

// One embed per bot, in the order people meet them.
function buildHelpEmbeds(client) {
	return [northgateOsEmbed(client), northShieldEmbed(), staffManagementEmbed()];
}

// What Discord counts towards its 6000 limit: the visible text, not the JSON
// around it. Counting the JSON instead would split !help into two DMs long
// before it had to.
function textLength(embed) {
	const data = embed.toJSON();
	return (data.title || "").length
		+ (data.description || "").length
		+ (data.footer?.text || "").length
		+ (data.author?.name || "").length
		+ (data.fields || []).reduce((total, field) => total + field.name.length + field.value.length, 0);
}

// Discord caps one message at 10 embeds AND at 6000 characters across all of them
// together, so the embeds are packed into as few messages as fit. Without this,
// adding a few commands one day would make !help fail with no visible reason.
function packIntoMessages(embeds) {
	const messages = [];
	let current = [];
	let size = 0;

	for (const embed of embeds) {
		const length = textLength(embed);
		if (current.length && (size + length > MESSAGE_EMBED_MAX || current.length >= MESSAGE_EMBED_COUNT)) {
			messages.push(current);
			current = [];
			size = 0;
		}
		current.push(embed);
		size += length;
	}
	if (current.length) messages.push(current);

	return messages;
}

module.exports = {
	buildHelpEmbeds,
	packIntoMessages,
	fieldsFor,
	textLength,
	SLASH_COMMAND_ACCESS,
	NORTHGATE_OS_PREFIX,
	OTHER_BOT_COMMANDS,
	FIELD_MAX,
	MAX_FIELDS,
	MESSAGE_EMBED_MAX
};
