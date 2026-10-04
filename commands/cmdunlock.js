const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../config.json');
const state = require('../state');
const { createInteractionProgress } = require('../utils/progress-embed');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cmdunlock')
        .setDescription('Unlocks ALL commands globally'),

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: '❌ Only server administrators can use `/cmdunlock`.',
                ephemeral: true
            });
        }

        const progress = createInteractionProgress(interaction, 'Unlocking all commands', [
            'Save the global command unlock state',
            'Refresh the admin panel'
        ]);
        await progress.start();

        let saved;
        await progress.runStep(0, async () => {
            config.locked = false;
            saved = state.save({ locked: false });
        });

        await progress.runStep(1, async () => {
            if (interaction.client && typeof interaction.client.notifyAdminPanelRefresh === "function") {
                await interaction.client.notifyAdminPanelRefresh();
            }
        });

        await progress.complete(saved
            ? '🔓 All commands have been **unlocked** globally.'
            : '🔓 All commands have been **unlocked** globally.\n⚠️ Could not save to disk, so this will reset on the next restart.');
    }
};
