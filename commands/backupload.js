const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    SlashCommandBuilder
} = require("discord.js");
const state = require("../state");
const { hasOwnershipAccess } = require("../utils/defcon-access");
const {
    calculateBackupSimilarity,
    downloadServerBackup,
    loadStoredServerBackup,
    restoreServerBackup,
    SIMILARITY_ABORT_PERCENT
} = require("../utils/server-backup");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("backupload")
        .setDescription("Restore a NorthGate server backup with a similarity safeguard.")
        .addAttachmentOption(option =>
            option
                .setName("backup")
                .setDescription("The server backup JSON file.")
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName("backup_id")
                .setDescription("A stored backup ID. Omit this and the attachment to use the newest available backup.")
                .setRequired(false)
        ),

    async execute(interaction, client, config) {
        const isDeveloper = (Array.isArray(config.developers) ? config.developers : [])
            .some(id => String(id) === interaction.user.id);
        if (!isDeveloper && !hasOwnershipAccess(interaction.member, config)) {
            return interaction.reply({
                content: "❌ Only developers and configured ownership can restore a server backup.",
                flags: MessageFlags.Ephemeral
            });
        }
        if (!interaction.guild) {
            return interaction.reply({
                content: "❌ Server backups can only be restored inside their server.",
                flags: MessageFlags.Ephemeral
            });
        }
        if (config.forceLocked || state.load().forceLocked) {
            return interaction.reply({
                content: "❌ End the active force lock with `d!secure` before restoring a backup.",
                flags: MessageFlags.Ephemeral
            });
        }
        const attachment = interaction.options.getAttachment("backup");
        const requestedBackupId = interaction.options.getString("backup_id");
        if (attachment && requestedBackupId) {
            return interaction.reply({
                content: "❌ Choose either an attached backup or a stored backup ID, not both.",
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        let backup;
        let selectedBackupId = null;
        let unavailableBackupIds = [];
        try {
            if (attachment) {
                backup = await downloadServerBackup(attachment, interaction.guild);
            } else {
                const storedBackup = await loadStoredServerBackup(
                    client,
                    interaction.guild,
                    config.defconBackupChannelId,
                    requestedBackupId
                );
                backup = storedBackup.backup;
                selectedBackupId = storedBackup.backupId;
                unavailableBackupIds = storedBackup.fallbackBackupIds;
            }
        } catch (error) {
            return interaction.editReply({
                content: `❌ Backup could not be loaded: ${error.message}`,
            });
        }

        let similarity;
        try {
            similarity = await calculateBackupSimilarity(interaction.guild, backup);
        } catch (error) {
            console.error("[backupload] could not calculate server similarity:", error);
            return interaction.editReply({
                content: "❌ The current server could not be safely compared with this backup. No changes were made.",
            });
        }
        if (similarity.isSimilar && !isDeveloper) {
            return interaction.editReply({
                content:
                    `🛑 Restore aborted: ${similarity.percentage.toFixed(1)}% of the backup's roles and channels ` +
                    `already match this server. At least ${SIMILARITY_ABORT_PERCENT}% requires an explicit developer override.`
            });
        }

        const token = interaction.id;
        const confirmId = `backupload_confirm_${interaction.user.id}_${token}`;
        const overrideId = `backupload_override_${interaction.user.id}_${token}`;
        const cancelId = `backupload_cancel_${interaction.user.id}_${token}`;
        const restoreActionId = similarity.isSimilar ? overrideId : confirmId;
        if (!client.activeBackupRestoreConfirmations) {
            client.activeBackupRestoreConfirmations = new Set();
        }
        client.activeBackupRestoreConfirmations.add(token);

        try {
            await interaction.editReply({
                content:
                    `⚠️ **Restore server configuration from this backup?**\n` +
                    (selectedBackupId
                        ? `Backup ID: **#${selectedBackupId}**.\n`
                        : "Source: uploaded JSON attachment.\n") +
                    (unavailableBackupIds.length
                        ? `⚠️ Newer backup(s) unavailable: ${unavailableBackupIds.map(id => `#${id}`).join(", ")}. Using the next available backup.\n`
                        : "") +
                    `It contains ${backup.roles.length} roles and ${backup.channels.length} channels.\n` +
                    `Current server similarity: ${similarity.percentage.toFixed(1)}% ` +
                    `(${similarity.matchedCount}/${similarity.totalCount} backup roles and channels match).\n` +
                    (similarity.isSimilar
                        ? `🛑 This reaches the ${SIMILARITY_ABORT_PERCENT}% protection threshold. Clicking below is an explicit developer override.\n`
                        : `Similarity is below the ${SIMILARITY_ABORT_PERCENT}% protection threshold.\n`) +
                    "Matching resources will be updated, missing ones recreated, and extra resources left untouched. " +
                    "Channel permission overwrites and supported server settings will be restored. " +
                    `Threads excluded: ${backup.excludedThreadCount || 0}. Messages, member lists, and member-role assignments are not included.`,
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(restoreActionId)
                            .setLabel(similarity.isSimilar ? "Developer override" : "Restore backup")
                            .setStyle(similarity.isSimilar ? ButtonStyle.Danger : ButtonStyle.Primary),
                        new ButtonBuilder()
                            .setCustomId(cancelId)
                            .setLabel("Cancel")
                            .setStyle(ButtonStyle.Secondary)
                    )
                ]
            });

            const confirmation = await interaction.fetchReply();
            let choice;
            try {
                choice = await confirmation.awaitMessageComponent({
                    filter: button => button.user.id === interaction.user.id,
                    time: 60_000
                });
            } catch {
                await interaction.editReply({
                    content: "⌛ Backup restore confirmation expired. No changes were made.",
                    components: []
                });
                return;
            }

            if (choice.customId === cancelId) {
                await choice.update({
                    content: "🛑 Backup restore cancelled. No changes were made.",
                    components: []
                });
                return;
            }
            if (choice.customId !== restoreActionId) {
                await choice.update({
                    content: "❌ This restore confirmation is invalid. No changes were made.",
                    components: []
                });
                return;
            }

            await choice.update({
                content: "⏳ Rechecking similarity before restoring. Extra resources will not be deleted.",
                components: []
            });

            let latestSimilarity;
            try {
                latestSimilarity = await calculateBackupSimilarity(interaction.guild, backup);
            } catch (error) {
                console.error("[backupload] could not recheck server similarity:", error);
                await interaction.editReply({
                    content: "❌ The current server could not be safely rechecked. No restore was started.",
                    components: []
                });
                return;
            }
            const overrideRequested = choice.customId === overrideId;
            if (latestSimilarity.isSimilar && (!overrideRequested || !isDeveloper)) {
                await interaction.editReply({
                    content:
                        `🛑 Restore aborted: current server similarity is ${latestSimilarity.percentage.toFixed(1)}%, ` +
                        `at or above the ${SIMILARITY_ABORT_PERCENT}% threshold. ` +
                        "A developer must explicitly override this protection.",
                    components: []
                });
                return;
            }

            if (config.forceLocked || state.load().forceLocked) {
                await interaction.editReply({
                    content: "❌ A force lock became active during confirmation. No backup changes were started.",
                    components: []
                });
                return;
            }

            await interaction.editReply({
                content:
                    `${overrideRequested ? "⚠️ Developer override accepted. " : ""}` +
                    "⏳ Restoring server configuration. Extra resources will not be deleted.",
                components: []
            });

            let result;
            try {
                result = await restoreServerBackup(interaction.guild, backup);
            } catch (error) {
                console.error("[backupload] server configuration restore stopped:", error);
                await interaction.editReply({
                    content:
                        `❌ Restore stopped: ${error.message}\n` +
                        "Some earlier roles or channels may already have been restored. Review the server configuration before retrying.",
                    components: []
                });
                return;
            }

            const warnings = result.warnings.length
                ? `\n⚠️ Warnings:\n${result.warnings.slice(0, 5).map(warning => `• ${warning}`).join("\n")}` +
                    (result.warnings.length > 5 ? `\n• ${result.warnings.length - 5} more warning(s).` : "")
                : "";
            await interaction.editReply({
                content:
                    `✅ Server configuration restored.\n` +
                    `Roles: ${result.roleCreatedCount} created, ${result.roleUpdatedCount} updated.\n` +
                    `Channels: ${result.channelCreatedCount} created, ${result.channelUpdatedCount} updated.` +
                    warnings,
                components: []
            });
        } finally {
            client.activeBackupRestoreConfirmations.delete(token);
        }
    }
};
