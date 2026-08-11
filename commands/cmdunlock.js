const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const config = require('../config.json');
const state = require('../state');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cmdunlock')
        .setDescription('Unlocks ALL commands globally'),

    async execute(interaction) {
        config.locked = false;
        const saved = state.save({ locked: false });

        await interaction.reply({
            content: saved
                ? '🔓 All commands have been **unlocked** globally.'
                : '🔓 All commands have been **unlocked** globally.\n⚠️ Could not save to disk, so this will reset on the next restart.',
            flags: MessageFlags.Ephemeral
        });
    }
};
