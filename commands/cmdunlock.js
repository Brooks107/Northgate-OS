const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const config = require('../config.json');
const state = require('../state');

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

        config.locked = false;
        const saved = state.save({ locked: false });

        if (interaction.client && typeof interaction.client.notifyAdminPanelRefresh === "function") {
            await interaction.client.notifyAdminPanelRefresh();
        }

        await interaction.reply({
            content: saved
                ? '🔓 All commands have been **unlocked** globally.'
                : '🔓 All commands have been **unlocked** globally.\n⚠️ Could not save to disk, so this will reset on the next restart.',
            flags: MessageFlags.Ephemeral
        });
    }
};
