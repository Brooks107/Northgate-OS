const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");
const { createInteractionProgress } = require("../utils/progress-embed");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("reactionpanel")
        .setDescription("Send the reaction panel in this channel")
        .setDefaultMemberPermissions(0),

    async execute(interaction, client, config) {

        // GLOBAL LOCK CHECK
        if (config.locked) {
            return interaction.reply({
                content: '🚫 NorthGate OS is currently **locked**. Command `/reactionpanel` cannot be used.',
                flags: MessageFlags.Ephemeral
            });
        }

        const Announcementping = config.pings?.announcementid;
        const eventping = config.pings?.eventpingid;
        const giveawayping = config.pings?.giveawayid;
        const gamenightping = config.pings?.gamenightid;
        const QoTDping = config.pings?.qotdid;
        const developmentping = config.pings?.devpingid;
        const importantping = config.pings?.importantid;

        const roles = [
            { emoji: "📢", name: "Announcement Ping", roleId: Announcementping },
            { emoji: "📅", name: "Event Ping", roleId: eventping },
            { emoji: "🎁", name: "Giveaway Ping", roleId: giveawayping },
            { emoji: "🎮", name: "Game Night Ping", roleId: gamenightping },
            { emoji: "❓", name: "QoTD Ping", roleId: QoTDping },
            { emoji: "💻", name: "Development Ping", roleId: developmentping },
            { emoji: "❗", name: "Important Ping", roleId: importantping }
        ];

        const description = roles
            .map(role => `${role.emoji}  ${role.name}${role.roleId ? ` - <@&${role.roleId}>` : ""}`)
            .join("\n");

        const progress = createInteractionProgress(interaction, "Creating reaction-role panel", [
            "Post the notification-role panel",
            ...roles.map(role => `Add the ${role.emoji} reaction`)
        ]);
        await progress.start();

        let message;
        await progress.runStep(0, async () => {
            message = await interaction.channel.send({
                embeds: [new EmbedBuilder()
                    .setTitle("NorthGate Notification Roles")
                    .setDescription(`React below to choose the notifications you want to receive.\n\n${description}`)
                    .setColor(0x2f80ed)]
            });
        });

        for (const [index, role] of roles.entries()) {
            await progress.runStep(index + 1, () => message.react(role.emoji));
        }
        client.reactionRoleMessageId = message.id;

        await progress.complete("✅ Reaction role panel sent.");
    }
}