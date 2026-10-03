const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const state = require("../state");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("managementvclock")
        .setDescription("Lock or unlock the management voice channel."),

    async execute(interaction, client, config) {
        const toArray = value => Array.isArray(value) ? value : value ? [value] : [];
        const allowedRoleIds = [
            ...toArray(config.hrdirectorrole),
            ...toArray(config.hrmanagerrole),
            ...toArray(config.ownershiprole)
        ].filter(Boolean);
        const isAuthorized = allowedRoleIds.some(roleId =>
            interaction.member?.roles?.cache?.has(roleId)
        ) || interaction.member?.permissions?.has("Administrator");

        if (!isAuthorized) {
            return interaction.reply({
                content: "❌ You are not authorized to lock the management voice channel.",
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const channelId = config.managementVoiceChannelId;
        const channel = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;
        if (!channel || !channel.isVoiceBased?.() || !channel.guild) {
            return interaction.editReply("❌ Set a valid `managementVoiceChannelId` in `config.json` first.");
        }

        const everyoneOverwrite = channel.permissionOverwrites.cache.get(
            channel.guild.roles.everyone.id
        );
        const isLocked = config.managementVoiceChannelLocked ||
            everyoneOverwrite?.deny.has("Connect");

        if (isLocked) {
            await channel.permissionOverwrites.edit(channel.guild.roles.everyone, {
                Connect: null
            });
            for (const roleId of allowedRoleIds) {
                const role = channel.guild.roles.cache.get(roleId);
                if (role) await channel.permissionOverwrites.edit(role, { Connect: null });
            }

            config.managementVoiceChannelLocked = false;
            const saved = state.save({ managementVoiceChannelLocked: false });
            if (interaction.client && typeof interaction.client.notifyAdminPanelRefresh === "function") {
                await interaction.client.notifyAdminPanelRefresh();
            }
            return interaction.editReply(saved
                ? `🔓 ${channel} is now unlocked.`
                : `🔓 ${channel} is now unlocked.\n⚠️ Could not save to disk, so this may lock again after restart.`
            );
        }

        await channel.permissionOverwrites.edit(channel.guild.roles.everyone, {
            Connect: false
        });
        for (const roleId of allowedRoleIds) {
            const role = channel.guild.roles.cache.get(roleId);
            if (role) await channel.permissionOverwrites.edit(role, { Connect: true });
        }

        config.managementVoiceChannelLocked = true;
        const saved = state.save({ managementVoiceChannelLocked: true });
        if (interaction.client && typeof interaction.client.notifyAdminPanelRefresh === "function") {
            await interaction.client.notifyAdminPanelRefresh();
        }
        return interaction.editReply(saved
            ? `🔒 ${channel} is now locked. Only approved management roles can join.`
            : `🔒 ${channel} is now locked. Only approved management roles can join.\n⚠️ Could not save to disk, so the join guard will reset on restart.`
        );
    }
};