const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");

function statusLabel(isActive, labelTrue, labelFalse) {
    return isActive ? `🟢 ${labelTrue}` : `🔴 ${labelFalse}`;
}

function buildAdminPanelEmbed(client, config, guild) {
    const activeTicketIds = client.activeTicketIds ? [...client.activeTicketIds].sort((a, b) => a - b) : [];

    const issues = [];
    if (config.locked) issues.push("Global command lock is active");
    if (config.commissionLocked) issues.push("Commission requests are locked");
    if (config.managementVoiceChannelLocked) issues.push("Management VC is locked");
    if (config.forceLocked) issues.push("Emergency lockdown is active");
    if (activeTicketIds.length >= 15) issues.push("Ticket pool is nearly full");
    if (activeTicketIds.length === 20) issues.push("All ticket slots are currently occupied");

    const emergency = Boolean(config.forceLocked);

    return new EmbedBuilder()
        .setTitle(emergency ? "🚨 EMERGENCY LOCKDOWN" : "🛠️ NorthGate OS Executive Panel")
        .setDescription(
            emergency
                ? "A force lockdown is active. Treat the server as restricted until cleared."
                : guild
                    ? `Current server snapshot for **${guild.name}** • Uptime: **${Math.floor((client.uptime || 0) / 60000)}m**`
                    : "Current server snapshot"
        )
        .setColor(
            emergency ? 0x4b5563 : 0x808080
        )
        .addFields(
            {
                name: "📊 Live Status",
                value: [
                    `Global Commands: ${statusLabel(!config.locked, "Open", "Locked")}`,
                    `Commission Requests: ${statusLabel(!config.commissionLocked, "Open", "Locked")}`,
                    `Management VC: ${statusLabel(!config.managementVoiceChannelLocked, "Open", "Locked")}`,
                    `Emergency Lockdown: ${statusLabel(!config.forceLocked, "Clear", "Active")}`,
                    `Active Ticket Slots: **${activeTicketIds.length}/20**`
                ].join("\n"),
                inline: false
            },
            {
                name: "🎫 Ticket State",
                value: activeTicketIds.length
                    ? `Open IDs: **${activeTicketIds.join(", ")}**`
                    : "No active ticket channels right now.",
                inline: false
            },
            {
                name: "⚠️ Needs Attention",
                value: issues.length
                    ? issues.map(item => `• ${item}`).join("\n")
                    : "No active issues detected.",
                inline: false
            },
            {
                name: "🧭 Server Health",
                value: [
                    `Tracked staff access: **${Array.isArray(config.developers) ? config.developers.length : 0}** developers`,
                    `Support roles configured: **${Array.isArray(config.supportTeamRoles) ? config.supportTeamRoles.length : 0}**`,
                    `Operations roles configured: **${Array.isArray(config.operationsroles) ? config.operationsroles.length : 0}**`
                ].join("\n"),
                inline: false
            }
        )
        .setFooter({
            text: emergency ? "NorthGate OS • Emergency lockdown mode" : "NorthGate OS • One-glance server status"
        })
        .setTimestamp();
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

        if (!client.adminPanelRefreshers) {
            client.adminPanelRefreshers = new Set();
        }

        if (!client.notifyAdminPanelRefresh) {
            client.notifyAdminPanelRefresh = async function () {
                if (!this.adminPanelRefreshers) return;
                const refreshes = [...this.adminPanelRefreshers];
                for (const refresh of refreshes) {
                    try {
                        await refresh();
                    } catch (error) {
                        console.error("[adminpanel] refresh failed:", error.message);
                    }
                }
            };
        }

        const message = await interaction.reply({
            embeds: [buildAdminPanelEmbed(client, config, interaction.guild)],
            fetchReply: true
        });

        const refreshMessage = async () => {
            if (!message || !message.edit) return;
            await message.edit({ embeds: [buildAdminPanelEmbed(client, config, interaction.guild)] });
        };

        client.adminPanelRefreshers.add(refreshMessage);

        if (!client.adminPanelInterval) {
            client.adminPanelInterval = setInterval(async () => {
                if (!client.notifyAdminPanelRefresh) return;
                try {
                    await client.notifyAdminPanelRefresh();
                } catch (error) {
                    console.error("[adminpanel] scheduled refresh failed:", error.message);
                }
            }, 60_000);
        }

        return message;
    }
};