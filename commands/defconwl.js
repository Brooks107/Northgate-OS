const { MessageFlags, SlashCommandBuilder } = require("discord.js");
const state = require("../state");
const {
    DEFAULT_WHITELISTED_ROLE_IDS,
    getWhitelistedRoleIds
} = require("../utils/defcon-role-security");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("defconwl")
        .setDescription("Whitelist a role from DEFCON 1 administrator-permission removal.")
        .addRoleOption(option =>
            option
                .setName("role")
                .setDescription("The role to allow to keep Administrator during DEFCON 1.")
                .setRequired(true)
        ),

    async execute(interaction, client, config) {
        const isDeveloper = (Array.isArray(config.developers) ? config.developers : [])
            .some(id => String(id) === interaction.user.id);
        if (!isDeveloper) {
            return interaction.reply({
                content: "❌ Only configured developers can change the DEFCON 1 role whitelist.",
                flags: MessageFlags.Ephemeral
            });
        }

        const role = interaction.options.getRole("role", true);
        const currentState = state.load();
        const whitelistedIds = getWhitelistedRoleIds(currentState.defconWhitelistedRoleIds || []);
        if (whitelistedIds.has(role.id)) {
            return interaction.reply({
                content: `ℹ️ ${role} is already on the DEFCON 1 whitelist.`,
                flags: MessageFlags.Ephemeral
            });
        }

        const savedIds = [...new Set([
            ...(currentState.defconWhitelistedRoleIds || []),
            role.id
        ])];
        if (!state.save({ defconWhitelistedRoleIds: savedIds })) {
            return interaction.reply({
                content: "❌ The whitelist could not be saved. No change was made.",
                flags: MessageFlags.Ephemeral
            });
        }

        const builtInCount = DEFAULT_WHITELISTED_ROLE_IDS.length;
        return interaction.reply({
            content: `✅ ${role} was added to the persistent DEFCON 1 whitelist. ${builtInCount} built-in role(s) are also protected.`,
            flags: MessageFlags.Ephemeral
        });
    }
};
