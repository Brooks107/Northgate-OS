const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    SlashCommandBuilder
} = require("discord.js");
const state = require("../state");
const { hasOwnershipAccess } = require("../utils/defcon-access");
const { downloadServerBackup, restoreServerBackup } = require("../utils/server-backup");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("backupload")
        .setDescription("Restore server configuration from a NorthGate JSON backup.")
        .addAttachmentOption(option =>
            option
                .setName("backup")
                .setDescription("The server backup JSON file.")
                .setRequired(true)
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

        let backup;
        try {
            backup = await downloadServerBackup(
                interaction.options.getAttachment("backup", true),
                interaction.guild
            );
        } catch (error) {
            return interaction.reply({
                content: `❌ Backup validation failed: ${error.message}`,
                flags: MessageFlags.Ephemeral
            });
        }

        const token = interaction.id;
        const confirmId = `backupload_confirm_${interaction.user.id}_${token}`;
        const cancelId = `backupload_cancel_${interaction.user.id}_${token}`;
        if (!client.activeBackupRestoreConfirmations) {
            client.activeBackupRestoreConfirmations = new Set();
        }
        client.activeBackupRestoreConfirmations.add(token);

        try {
            await interaction.reply({
                content:
                    `⚠️ **Restore server configuration from this backup?**\n` +
                    `It contains ${backup.roles.length} roles and ${backup.channels.length} channels.\n` +
                    "Matching resources will be updated, missing ones recreated, and extra resources left untouched. " +
                    "Channel permission overwrites and supported server settings will be restored. " +
                    `Threads excluded: ${backup.excludedThreadCount || 0}. Messages, member lists, and member-role assignments are not included.`,
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(confirmId)
                            .setLabel("Restore backup")
                            .setStyle(ButtonStyle.Danger),
                        new ButtonBuilder()
                            .setCustomId(cancelId)
                            .setLabel("Cancel")
                            .setStyle(ButtonStyle.Secondary)
                    )
                ],
                flags: MessageFlags.Ephemeral
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

            await choice.update({
                content: "⏳ Restoring server configuration. Extra resources will not be deleted.",
                components: []
            });

            if (config.forceLocked || state.load().forceLocked) {
                await interaction.editReply({
                    content: "❌ A force lock became active during confirmation. No backup changes were started.",
                    components: []
                });
                return;
            }

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
