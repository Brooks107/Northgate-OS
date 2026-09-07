const { SlashCommandBuilder, MessageFlags } = require("discord.js");

const DEPARTMENT_CHOICES = [
    { name: "Community Outreach", value: "Community Outreach" },
    { name: "Human Resources", value: "Human Resources" },
    { name: "Public Relations", value: "Public Relations" },
    { name: "Development", value: "Development" }
];

const DEPARTMENT_TO_CONFIG_KEY = {
    "Community Outreach": "communityrole",
    "Human Resources": "hrrole",
    "Public Relations": "prrole",
    "Development": "devrole"
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName("hire")
        .setDescription("Hire a user into a department.")
        .addUserOption(option =>
            option.setName("user")
                .setDescription("The user to hire.")
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName("department")
                .setDescription("The department to assign the user to.")
                .setRequired(true)
                .addChoices(...DEPARTMENT_CHOICES)
        ),

    async execute(interaction, client, config) {
        if (!interaction.isChatInputCommand()) return;

        if (config.locked) {
            return interaction.reply({
                content: '🚫 NorthGate OS is currently **locked**. Command `/commissionspanel` cannot be used.',
                flags: MessageFlags.Ephemeral
            });
        }
       

        const isAuthorized = interaction.memberPermissions?.has("ManageRoles") ||
            interaction.memberPermissions?.has("Administrator") ||
            config.supportTeamRoles?.some(roleId => interaction.member?.roles?.cache?.has(roleId));

        if (!isAuthorized) {
            return interaction.reply({
                content: "❌ You are not authorized to use `/hire`.",
                flags: MessageFlags.Ephemeral
            });
        }

        const targetUser = interaction.options.getUser("user");
        const department = interaction.options.getString("department");

        if (!targetUser) {
            return interaction.reply({
                content: "❌ Please select a valid user.",
                flags: MessageFlags.Ephemeral
            });
        }

        const departmentKey = DEPARTMENT_TO_CONFIG_KEY[department];
        const departmentRoleId = config[departmentKey];
        const staffRoleId = config.staffrole;

        if (!departmentRoleId) {
            return interaction.reply({
                content: `❌ No role is configured for the ${department} department. Please contact brooksy246`,
                flags: MessageFlags.Ephemeral
            });
        }

        if (!staffRoleId) {
            return interaction.reply({
                content: "❌ No staff role is configured in the bot config. Please contact brooksy246",
                flags: MessageFlags.Ephemeral
            });
        }

        let targetMember;
        try {
            targetMember = await interaction.guild.members.fetch(targetUser.id);
        } catch {
            return interaction.reply({
                content: "❌ That user is not in this server.",
                flags: MessageFlags.Ephemeral
            });
        }

        const roleIdsToAdd = [departmentRoleId, staffRoleId]
            .filter(Boolean)
            .map(String)
            .filter((id, index, array) => array.indexOf(id) === index);

        try {
            await targetMember.roles.add(roleIdsToAdd);
        } catch (err) {
            console.error("[hire] failed to add roles:", err);
            return interaction.reply({
                content: "❌ I could not assign the department and staff roles to that user. Please contact Brooksy246 with a piture of the response",
                flags: MessageFlags.Ephemeral
            });
        }

        const handbookLink = config["handbook link"] || config.handbookLink || config.handbook_url || config.handbook;

        return interaction.reply({
            content: `<@${targetUser.id}>, Welcome to the Northgate Staff Team, Please read the below handbook: ${handbookLink || "https://example.com/handbook"}. We hope you make great contributions to our team.`
        });
    }
};
