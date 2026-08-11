const { SlashCommandBuilder } = require('discord.js');
const config = require('../config.json');
const fs = require('fs');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cmdunlock')
        .setDescription('Unlocks ALL commands globally'),

    async execute(interaction) {
        config.locked = false;
        fs.writeFileSync('./config.json', JSON.stringify(config, null, 4));

        await interaction.reply('🔒 All commands have been **unlocked** globally.');
    }
};
