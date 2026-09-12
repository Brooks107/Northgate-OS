const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");

function statusLabel(isActive, labelTrue, labelFalse) {
    return isActive ? `🟢 ${labelTrue}` : `🔴 ${labelFalse}`;
}

function describeChannel(client, channelId, fallbackLabel) {
    if (!channelId) return `⚠️ ${fallbackLabel}: not configured`;
    const channel = client.channels.cache.get(channelId) || null;
    if (!channel) return `⚠️ ${fallbackLabel}: not found (<#${channelId}>)`;
    return `✅ ${fallbackLabel}: <#${channel.id}>`;
}

function summarizeActiveTickets(client) {
    const ids = client.activeTicketIds ? [...client.activeTicketIds].sort((a, b) => a - b) : [];
    if (ids.length === 0) return "No active ticket channels";
    return ids.slice(0, 10).join(", ") + (ids.length > 10 ? ` ... (+${ids.length - 10} more)` : "");
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("adminpanel")
        .setDescription("Send the admin panel in this channel"),

    async execute(interaction, client, config) {
        if (config.locked) {
            return interaction.reply({
                content: '🚫 NorthGate OS is currently **locked**. Command `/adminpanel` cannot be used.',
                flags: MessageFlags.Ephemeral
            });
        }

        if (!config.developers?.includes(interaction.user.id)) {
            return interaction.reply({
                content: "❌ Only developers can use the admin panel.",
                flags: MessageFlags.Ephemeral
            });
        }

        const guild = interaction.guild;
        const activeTicketIds = client.activeTicketIds ? [...client.activeTicketIds].sort((a, b) => a - b) : [];

        const embed = new EmbedBuilder()
            .setTitle("🛠️ NorthGate OS Admin Overview")
            .setDescription(
                guild
                    ? `Live status for **${guild.name}** • Uptime: **${Math.floor((client.uptime || 0) / 60000)}m**`
                    : "Live system overview"
            )
            .setColor(
                config.locked || config.commissionLocked || config.managementVoiceChannelLocked
                    ? 0xf59e0b
                    : 0x22c55e
            )
            .addFields(
                {
                    name: "📊 System Status",
                    value: [
                        `Global Commands: ${statusLabel(!config.locked, "Open", "Locked")}`,
                        `Commission Requests: ${statusLabel(!config.commissionLocked, "Open", "Locked")}`,
                        `Management VC: ${statusLabel(!config.managementVoiceChannelLocked, "Open", "Locked")}`
                    ].join("\n"),
                    inline: false
                },
                {
                    name: "🎫 Ticket Health",
                    value: [
                        `Active Ticket IDs: **${activeTicketIds.length}**`,
                        `Current IDs: ${activeTicketIds.length ? `**${activeTicketIds.join(", ")}**` : "None"}`,
                        `Tracker Channel: ${config.trackerChannelId ? `<#${config.trackerChannelId}>` : "Not configured"}`
                    ].join("\n"),
                    inline: false
                },
                {
                    name: "📍 Key Channels",
                    value: [
                        describeChannel(client, config.channels?.ticketchannelid, "Ticket Channel"),
                        describeChannel(client, config.channels?.logging, "Logging"),
                        describeChannel(client, config.channels?.transcriptschannelid, "Transcripts"),
                        describeChannel(client, config.managementVoiceChannelId, "Management VC"),
                        describeChannel(client, config.trackerChannelId, "Tracker")
                    ].join("\n"),
                    inline: false
                },
                {
                    name: "👥 Access & Roles",
                    value: [
                        `Support Team Roles: **${Array.isArray(config.supportTeamRoles) ? config.supportTeamRoles.length : 0}**`,
                        `Operations Roles: **${Array.isArray(config.operationsroles) ? config.operationsroles.length : 0}**`,
                        `Developers: **${Array.isArray(config.developers) ? config.developers.length : 0}**`,
                        `General Ticket Access: **${Array.isArray(config.generalticketaccess) ? config.generalticketaccess.length : 0}**`
                    ].join("\n"),
                    inline: false
                },
                {
                    name: "📌 Ticket Categories",
                    value: [
                        `General: ${config.generalticketcategory ? `<#${config.generalticketcategory}>` : "Not set"}`,
                        `Appeals: ${config.appealsticketcategory ? `<#${config.appealsticketcategory}>` : "Not set"}`,
                        `Commissions: ${config.commissionsticketcategory ? `<#${config.commissionsticketcategory}>` : "Not set"}`,
                        `Hiring: ${config.hiringticketcategory ? `<#${config.hiringticketcategory}>` : "Not set"}`,
                        `Partnerships: ${config.partnershipticketcategory ? `<#${config.partnershipticketcategory}>` : "Not set"}`
                    ].join("\n"),
                    inline: false
                }
            )
            .setFooter({
                text: "NorthGate OS • One-glance operations dashboard"
            })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }
};