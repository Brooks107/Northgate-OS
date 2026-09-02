const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");

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

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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

        const message = await interaction.channel.send({
            embeds: [new EmbedBuilder()
                .setTitle("NorthGate Notification Roles")
                .setDescription(`React below to choose the notifications you want to receive.\n\n${description}`)
                .setColor(0x2f80ed)]
        });

        for (const role of roles) {
            await message.react(role.emoji);
        }

        client.reactionRoleMessageId = message.id;

        return interaction.editReply({
            content: "✅ Reaction role panel sent.",
        });
    }
}