const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const config = require('../config.json');
const state = require('../state');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cmdlock')
        .setDescription('Locks ALL commands globally'),

    async execute(interaction) {
        // config is the same object every command sees (require caches it), so
        // this takes effect immediately; state.js makes it survive a restart.
        config.locked = true;
        const saved = state.save({ locked: true });

        await interaction.reply({
            content: saved
                ? '🔒 All commands have been **locked** globally.'
                : '🔒 All commands have been **locked** globally.\n⚠️ Could not save to disk, so this will reset on the next restart.',
            flags: MessageFlags.Ephemeral
        });
    }
};
