const { EmbedBuilder } = require("discord.js");

module.exports = async function handleGuildMemberAdd(member) {
    const config = member.client.config;
    const welcomeChannelId = config.systemIds?.welcomeChannelId;
    if (!welcomeChannelId) {
        console.error("[welcome] systemIds.welcomeChannelId is not configured");
        return;
    }

    let channel;
    try {
        channel = await member.guild.channels.fetch(welcomeChannelId);
    } catch (error) {
        console.error(`[welcome] could not fetch welcome channel ${welcomeChannelId}:`, error);
        return;
    }

    if (!channel?.isTextBased?.() || typeof channel.send !== "function") {
        console.error(`[welcome] channel ${welcomeChannelId} is missing or is not a text channel`);
        return;
    }

    try {
        const embed = new EmbedBuilder()
            .setColor(0x3498db)
            .setTitle(`Welcome to Northgate Studios!`)
            .setDescription([
                `Welcome to ${member.guild.name}, ${member}!`,
                `Please make sure to read the rules in <#${config.channels.ruleschannelid}>!`,
                `Please direct any queries to our support tickets in <#${config.channels.ticketchannelid}>!`
            ].join("\n\n"))
            .setThumbnail(member.user.displayAvatarURL())
            .setFooter({ text: `Member #${member.guild.memberCount}` })
            .setTimestamp();

        await channel.send({
            embeds: [embed],
            allowedMentions: { users: [member.id] }
        });
    } catch (error) {
        console.error(`[welcome] could not build or send welcome message for ${member.user.tag}:`, error);
    }
};