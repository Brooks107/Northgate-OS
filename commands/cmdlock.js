const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../config.json');
const state = require('../state');
const { createInteractionProgress } = require('../utils/progress-embed');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cmdlock')
        .setDescription('Locks ALL commands globally'),

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: '❌ Only server administrators can use `/cmdlock`.',
                ephemeral: true
            });
        }

        const progress = createInteractionProgress(interaction, 'Locking all commands', [
            'Save the global command lock state',
            'Refresh the admin panel'
        ]);
        await progress.start();

        let saved;
        await progress.runStep(0, async () => {
            config.locked = true;
            saved = state.save({ locked: true });
        });

        await progress.runStep(1, async () => {
            if (interaction.client && typeof interaction.client.notifyAdminPanelRefresh === "function") {
                await interaction.client.notifyAdminPanelRefresh();
            }
        });

        await progress.complete(saved
            ? '🔒 All commands have been **locked** globally.'
            : '🔒 All commands have been **locked** globally.\n⚠️ Could not save to disk, so this will reset on the next restart.');
    }
};
