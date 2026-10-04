const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const state = require("../state");
const {
    ProgressFailure,
    createInteractionProgress
} = require("../utils/progress-embed");

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
        );

        if (!isAuthorized) {
            return interaction.reply({
                content: "❌ You are not authorized to lock the management voice channel.",
                flags: MessageFlags.Ephemeral
            });
        }

        const progress = createInteractionProgress(interaction, "Management VC lock update", [
            "Find the configured management voice channel",
            "Update @everyone connection access",
            "Apply access for approved management roles",
            "Update access for all other roles",
            "Save the lock state and refresh the admin panel"
        ]);
        await progress.start();

        let channel;
        let isLocked;
        try {
            await progress.runStep(0, async () => {
                const channelId = config.managementVoiceChannelId;
                channel = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;
                if (!channel || !channel.isVoiceBased?.() || !channel.guild) {
                    throw new ProgressFailure("Set a valid `managementVoiceChannelId` in `config.json` first.");
                }
            });
        } catch (error) {
            if (error instanceof ProgressFailure) return;
            throw error;
        }

        const everyoneOverwrite = channel.permissionOverwrites.cache.get(
            channel.guild.roles.everyone.id
        );
        isLocked = config.managementVoiceChannelLocked ||
            everyoneOverwrite?.deny.has("Connect");

        if (isLocked) {
            await progress.runStep(1, () => channel.permissionOverwrites.edit(channel.guild.roles.everyone, {
                Connect: null
            }));
            await progress.runStep(2, async () => {
                for (const roleId of allowedRoleIds) {
                    const role = channel.guild.roles.cache.get(roleId);
                    if (role) await channel.permissionOverwrites.edit(role, { Connect: null });
                }
            });
            const failedRoleIds = [];
            await progress.runStep(3, async () => {
                for (const role of channel.guild.roles.cache.values()) {
                    if (role.id !== channel.guild.roles.everyone.id && !allowedRoleIds.includes(role.id)) {
                        try {
                            await channel.permissionOverwrites.edit(role, { Connect: null });
                        } catch (error) {
                            failedRoleIds.push(role.id);
                            console.error(`[managementvclock] failed to unlock role ${role.id}:`, error);
                        }
                    }
                }
            });
            if (failedRoleIds.length > 0) await progress.warnStep(3);

            config.managementVoiceChannelLocked = false;
            let saved;
            await progress.runStep(4, async () => {
                saved = state.save({ managementVoiceChannelLocked: false });
                if (interaction.client && typeof interaction.client.notifyAdminPanelRefresh === "function") {
                    await interaction.client.notifyAdminPanelRefresh();
                }
            });
            const warning = failedRoleIds.length
                ? ` ⚠️ Could not update ${failedRoleIds.length} role(s); check the bot logs.`
                : "";
            await progress.complete(
                `🔓 ${channel} is now unlocked.${warning}${saved ? "" : "\n⚠️ Could not save to disk, so this may lock again after restart."}`
            );
            return;
        }

        await progress.runStep(1, () => channel.permissionOverwrites.edit(channel.guild.roles.everyone, {
            Connect: false
        }));
        await progress.runStep(2, async () => {
            for (const roleId of allowedRoleIds) {
                const role = channel.guild.roles.cache.get(roleId);
                if (role) await channel.permissionOverwrites.edit(role, { Connect: true });
            }
        });
        const failedRoleIds = [];
        await progress.runStep(3, async () => {
            for (const role of channel.guild.roles.cache.values()) {
                if (role.id !== channel.guild.roles.everyone.id && !allowedRoleIds.includes(role.id)) {
                    try {
                        await channel.permissionOverwrites.edit(role, { Connect: false });
                    } catch (error) {
                        failedRoleIds.push(role.id);
                        console.error(`[managementvclock] failed to lock role ${role.id}:`, error);
                    }
                }
            }
        });
        if (failedRoleIds.length > 0) await progress.warnStep(3);

        config.managementVoiceChannelLocked = true;
        let saved;
        await progress.runStep(4, async () => {
            saved = state.save({ managementVoiceChannelLocked: true });
            if (interaction.client && typeof interaction.client.notifyAdminPanelRefresh === "function") {
                await interaction.client.notifyAdminPanelRefresh();
            }
        });
        const warning = failedRoleIds.length
            ? ` ⚠️ Could not update ${failedRoleIds.length} role(s); check the bot logs.`
            : "";
        await progress.complete(
            `🔒 ${channel} is now locked. Only approved management roles can join.${warning}${saved ? "" : "\n⚠️ Could not save to disk, so the join guard will reset on restart."}`
        );
    }
};