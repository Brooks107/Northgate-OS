const { SlashCommandBuilder } = require('discord.js');
const config = require('../config.json');
const fs = require('fs');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cmdlock')
        .setDescription('Locks ALL commands globally'),

    async execute(interaction) {
        config.locked = true;
        fs.writeFileSync('./config.json', JSON.stringify(config, null, 4));

        await interaction.reply('🔒 All commands have been **locked** globally.');
    }
};
