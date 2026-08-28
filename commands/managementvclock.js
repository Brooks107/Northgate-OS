const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const state = require("../state");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("managementvclock")
        .setDescription("Lock the management voice channel to approved management roles."),

    async execute(interaction, client, config) {
        const allowedRoleIds = [
            config.hrdirectorrole,
            ...(Array.isArray(config.ownershiprole) ? config.ownershiprole : [config.ownershiprole])
        ].filter(Boolean);
        const isAuthorized = allowedRoleIds.some(roleId =>
            interaction.member?.roles?.cache?.has(roleId)
        );

        if (!isAuthorized) {
            return interaction.reply({
                content: "❌ You are not authorized to lock the management voice channel.",
                flags: MessageFlags.Ephemeral
            });
        }

        const channelId = config.managementVoiceChannelId;
        const channel = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;
        if (!channel || !channel.isVoiceBased?.() || !channel.guild) {
            return interaction.reply({
                content: "❌ Set a valid `managementVoiceChannelId` in `config.json` first.",
                flags: MessageFlags.Ephemeral
            });
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
        return interaction.reply({
            content: saved
                ? `🔒 ${channel} is now locked. Only approved management roles can join.`
                : `🔒 ${channel} is now locked. Only approved management roles can join.\n⚠️ Could not save to disk, so the join guard will reset on restart.`,
            flags: MessageFlags.Ephemeral
        });
    }
};