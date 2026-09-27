const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");
const state = require("../state");

function statusLabel(isActive, labelTrue, labelFalse) {
    return isActive ? `🟢 ${labelTrue}` : `🔴 ${labelFalse}`;
}

function startAdminPanelRefresh(client, config) {
    if (!client.adminPanelRefreshers) client.adminPanelRefreshers = new Set();

    if (!client.notifyAdminPanelRefresh) {
        client.notifyAdminPanelRefresh = async function () {
            if (!this.adminPanelRefreshers) return;
            for (const refresh of [...this.adminPanelRefreshers]) {
                try {
                    await refresh();
                } catch (error) {
                    console.error("[adminpanel] refresh failed:", error.message);
                }
            }
        };
    }

    if (!client.adminPanelInterval) {
        client.adminPanelInterval = setInterval(() => {
            client.notifyAdminPanelRefresh?.();
        }, 60_000);
    }
}

function registerAdminPanelRefresh(client, config, panel) {
    startAdminPanelRefresh(client, config);

    const refreshMessage = async () => {
        try {
            const channel = await client.channels.fetch(panel.channelId);
            const message = await channel.messages.fetch(panel.messageId);
            await message.edit({
                embeds: [buildAdminPanelEmbed(client, config, client.guilds.cache.get(panel.guildId))]
            });
        } catch (error) {
            if (error.code !== 10008 && error.code !== 10003) throw error;

            client.adminPanelRefreshers.delete(refreshMessage);
            if (state.load().adminPanel?.messageId === panel.messageId) {
                state.save({ adminPanel: null });
            }
            console.warn("[adminpanel] panel message no longer exists; stopped refreshing it. Run /adminpanel to post a new one.");
        }
    };

    client.adminPanelRefreshers.add(refreshMessage);
}

function roleMemberCount(guild, roleIds, groupLabel) {
    if (!Array.isArray(roleIds) || roleIds.length === 0) return [];

    const memberCount = guild?.members?.cache
        ? guild.members.cache.filter(member =>
            roleIds.some(roleId => member.roles.cache.has(roleId))
        ).size
        : 0;

    return [`${groupLabel}: **${memberCount} people**`];
}

function buildAdminPanelEmbed(client, config, guild) {
    const activeTicketIds = client.activeTicketIds ? [...client.activeTicketIds].sort((a, b) => a - b) : [];
    const supportRoleIds = Array.isArray(config.supportTeamRoles) ? config.supportTeamRoles : [];
    const operationsRoleIds = Array.isArray(config.operationsroles) ? config.operationsroles : [];
    const ownershipRoleIds = Array.isArray(config.ownershiprole) ? config.ownershiprole : [];
    const generalTicketAccessRoleIds = Array.isArray(config.generalticketaccess) ? config.generalticketaccess : [];
    const appealsTicketAccessRoleIds = Array.isArray(config.appealsticketaccess) ? config.appealsticketaccess : [];
    const partnershipTicketAccessRoleIds = Array.isArray(config.partnershipticketaccess) ? config.partnershipticketaccess : [];
    const hiringTicketAccessRoleIds = Array.isArray(config.hiringticketaccess) ? config.hiringticketaccess : [];
    const configuredRoleCounts = [
        ...roleMemberCount(guild, supportRoleIds, "Support Roles"),
        ...roleMemberCount(guild, operationsRoleIds, "Operations Roles"),
        ...roleMemberCount(guild, ownershipRoleIds, "Ownership Roles"),
        ...roleMemberCount(guild, generalTicketAccessRoleIds, "General Ticket Access"),
        ...roleMemberCount(guild, appealsTicketAccessRoleIds, "Appeal Ticket Access"),
        ...roleMemberCount(guild, partnershipTicketAccessRoleIds, "Partnership Ticket Access"),
        ...roleMemberCount(guild, hiringTicketAccessRoleIds, "Hiring Ticket Access"),
        ...roleMemberCount(guild, ["1536806576202186842"], "Lockdown Authorisation")
    ];

    const issues = [];
    if (config.locked) issues.push("Global command lock is active");
    if (config.commissionLocked) issues.push("Commission requests are locked");
    if (config.managementVoiceChannelLocked) issues.push("Management VC is locked");
    if (config.forceLocked) issues.push("Emergency lockdown is active");
    if (activeTicketIds.length >= 15) issues.push("Ticket pool is nearly full");
    if (activeTicketIds.length === 20) issues.push("All ticket slots are currently occupied");

    const emergency = Boolean(config.forceLocked);

    return new EmbedBuilder()
        .setTitle(emergency ? "🚨 EMERGENCY LOCKDOWN" : "🛠️ NorthCore OS Executive Panel")
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
                    `Operations roles configured: **${Array.isArray(config.operationsroles) ? config.operationsroles.length : 0}**`,
                    `Ownership roles configured: **${Array.isArray(config.ownershiprole) ? config.ownershiprole.length : 0}**`
                ].join("\n"),
                inline: false
            },
            {
                name: "👥 Role Membership",
                value: configuredRoleCounts.length
                    ? configuredRoleCounts.join("\n")
                    : "No role membership data configured.",
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

        const isDeveloper = config.developers?.includes(interaction.user.id);
        const ownershipRoles = Array.isArray(config.ownershiprole)
            ? config.ownershiprole
            : [config.ownershiprole].filter(Boolean);
        const isOwner = ownershipRoles.some(roleId =>
            interaction.member?.roles?.cache?.has(roleId)
        );

        if (!isDeveloper && !isOwner) {
            return interaction.reply({
                content: "❌ Only developers or ownership can use the admin panel.",
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.guild?.members.fetch().catch(() => null);

        const message = await interaction.reply({
            embeds: [buildAdminPanelEmbed(client, config, interaction.guild)],
            fetchReply: true
        });

        const panel = {
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            messageId: message.id
        };

        state.save({ adminPanel: panel });
        registerAdminPanelRefresh(client, config, panel);

        return message;
    },

    async restore(client, config) {
        const panel = state.load().adminPanel;
        if (!panel?.guildId || !panel?.channelId || !panel?.messageId) return;

        try {
            await client.channels.fetch(panel.channelId);
            await client.guilds.cache.get(panel.guildId)?.members.fetch().catch(() => null);
            registerAdminPanelRefresh(client, config, panel);
            await client.notifyAdminPanelRefresh();
            console.log("[adminpanel] restored persistent panel refresh.");
        } catch (error) {
            console.warn("[adminpanel] could not restore panel:", error.message);
        }
    }
};