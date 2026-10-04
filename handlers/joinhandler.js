const { EmbedBuilder } = require("discord.js");

const WELCOME_CHANNEL_ID = "1543329472873373706";

module.exports = async function handleGuildMemberAdd(member) {
    let channel;
    try {
        channel = await member.guild.channels.fetch(WELCOME_CHANNEL_ID);
    } catch (error) {
        console.error(`[welcome] could not fetch welcome channel ${WELCOME_CHANNEL_ID}:`, error);
        return;
    }

    if (!channel?.isTextBased?.() || typeof channel.send !== "function") {
        console.error(`[welcome] channel ${WELCOME_CHANNEL_ID} is missing or is not a text channel`);
        return;
    }

    try {
        const embed = new EmbedBuilder()
            .setColor(0x3498db)
            .setTitle(`Welcome to Northgate Studios ${member}!`)
            .setDescription([
                `Welcome to ${member.guild.name}, ${member}!`,
                "Please make sure to read the rules in <#1518181292863127602>!",
                "Please direct any queries to our support tickets in <#1518198456932503642>!"
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