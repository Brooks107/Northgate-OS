const { MessageFlags, SlashCommandBuilder } = require("discord.js");
const { createServerBackup } = require("../utils/server-backup");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("backupcreate")
        .setDescription("Create and upload a server configuration backup.")
        .setDMPermission(false),

    async execute(interaction, client, config) {
        const isDeveloper = (Array.isArray(config.developers) ? config.developers : [])
            .some(id => String(id) === interaction.user.id);
        if (!isDeveloper) {
            return interaction.reply({
                content: "❌ Only configured developers can create a server backup.",
                flags: MessageFlags.Ephemeral
            });
        }
        if (!interaction.guild) {
            return interaction.reply({
                content: "❌ Server backups can only be created inside their server.",
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        let backupReceipt;
        try {
            backupReceipt = await createServerBackup(
                interaction.guild,
                client,
                config.defconBackupChannelId
            );
        } catch (error) {
            console.error("[backupcreate] failed to create server backup:", error);
            return interaction.editReply({
                content: `❌ Server backup failed: ${error.message}`
            });
        }

        return interaction.editReply({
            content:
                `✅ Server backup **#${backupReceipt.backupId}** created: [${backupReceipt.filename}](${backupReceipt.url})\n` +
                `Roles: ${backupReceipt.roleCount} • Channels: ${backupReceipt.channelCount}. ` +
                `Threads excluded: ${backupReceipt.excludedThreadCount}. ` +
                `Unsupported channels excluded: ${backupReceipt.unsupportedChannelCount}.`
        });
    }
};
