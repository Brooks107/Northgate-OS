const { EmbedBuilder, SlashCommandBuilder } = require("discord.js");

const LEVELS = [
    ["DEFCON 1", "Commands: configured developers only.\nForce lock: applied.\nEmergency developer IDs: added to `config.developers`."],
    ["DEFCON 2", "Commands: members with `config.staffrole` only.\nForce lock: applied.\nEmergency developer IDs: added to `config.developers`."],
    ["DEFCON 3", "Commands: configured developers only.\nForce lock: not applied.\nEmergency developer IDs: added to `config.developers`."],
    ["DEFCON 4", "Commands: existing command permissions.\nForce lock: applied.\nEmergency developer IDs: added to `config.developers`."],
    ["DEFCON 5", "Commands: members with `config.staffrole` only.\nForce lock: not applied.\nEmergency developer IDs: added to `config.developers`."],
    ["DEFCON 6", "Commands: existing command permissions.\nForce lock: not applied.\nEmergency developer IDs: added to `config.developers`."]
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName("defconguide")
        .setDescription("Send the DEFCON levels and their effects."),

    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle("NorthGate OS • DEFCON Guide")
            .setDescription(
                "A developer can activate a level with `d!defcon <1-6>`. " +
                "`d!defcon status` shows the active level, command access, lock state, activation time, and any recorded issue. " +
                "Changing to a level without force lock removes an active force lock. " +
                "`d!secure` ends DEFCON, restores a lock it owns, and removes only emergency developer IDs added by DEFCON. " +
                "Only developers can activate DEFCON. Developers and members with a configured ownership role can always run `d!secure`."
            )
            .setColor(0xdc2626)
            .addFields(LEVELS.map(([name, value]) => ({ name, value, inline: false })))
            .setFooter({ text: "NorthGate OS • Emergency command access policy" })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }
};
