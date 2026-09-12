const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const config = require('../config.json');
const state = require('../state');

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

        config.locked = true;
        const saved = state.save({ locked: true });

        if (interaction.client && typeof interaction.client.notifyAdminPanelRefresh === "function") {
            await interaction.client.notifyAdminPanelRefresh();
        }

        await interaction.reply({
            content: saved
                ? '🔒 All commands have been **locked** globally.'
                : '🔒 All commands have been **locked** globally.\n⚠️ Could not save to disk, so this will reset on the next restart.',
            flags: MessageFlags.Ephemeral
        });
    }
};
