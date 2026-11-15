const { EmbedBuilder, SlashCommandBuilder } = require("discord.js");

const LEVELS = [
    ["DEFCON 1", "Before activation, the developer must accept a warning that this is the strongest level and other options should be used if possible. It creates a server-configuration backup in the configured private backup channel; that same confirmation accepts the force-lock warning. Administrator is removed from manageable, non-whitelisted roles and restored by `d!secure`.\nCommands: configured developers only.\nForce lock: applied.\nEmergency developer IDs: added to `config.developers`."],
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
                "A developer or configured ownership member can activate a level with `d!defcon <1-6>`; ownership members must acknowledge the emergency-use warning first. " +
                "`d!defcon status` shows the active level, command access, lock state, activation time, and any recorded issue. " +
                "Changing to a level without force lock removes an active force lock. " +
                "`d!secure` ends DEFCON, restores a lock it owns, and removes only emergency developer IDs added by DEFCON. " +
                "`/backupcreate` lets developers manually create a server-configuration backup with its own ID in the configured backup channel. " +
                "`/defconwl <role>` lets developers exempt roles from DEFCON 1's Administrator removal; NorthShield, NorthOps, and Honeypot are pre-whitelisted. " +
                "Developers and members with a configured ownership role can activate DEFCON. Developers and members with a configured ownership role can always run `d!secure`; ownership members are warned when activating, not when securing. " +
                "`/backupload` uses the newest available stored backup by default (falling back to older IDs when needed), or accepts an ID/JSON attachment. Restore is non-destructive: matching roles and channels are updated, missing ones recreated, and extra resources left in place. " +
                "Developers can delete stored backups with the button on each backup embed or `d!delbackup <backup ID>`. " +
                "It aborts when at least 75% of the backup's combined roles and channels already match; only a developer can explicitly override that safeguard. " +
                "Messages, member lists, and member-role assignments are not backed up."
            )
            .setColor(0xdc2626)
            .addFields(LEVELS.map(([name, value]) => ({ name, value, inline: false })))
            .setFooter({ text: "NorthGate OS • Emergency command access policy" })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }
};
