const { EmbedBuilder } = require("discord.js");

function getLoggingChannelId(config) {
    const loggingChannel = config.channels?.logging;
    return typeof loggingChannel === "object"
        ? loggingChannel?.id
        : loggingChannel;
}

function getChannelLabel(source) {
    return source.channel?.name
        ? `#${source.channel.name}`
        : source.channel?.id
            ? `<#${source.channel.id}>`
            : "Unknown channel";
}

function formatArguments(argumentsValue) {
    if (argumentsValue === undefined || argumentsValue === null || argumentsValue === "") {
        return "None";
    }

    if (Array.isArray(argumentsValue)) {
        return argumentsValue.length ? argumentsValue.join(" ") : "None";
    }

    return String(argumentsValue);
}

async function logCommand(source, config, commandName, commandType, argumentsValue) {
    const channelId = getLoggingChannelId(config);
    if (!channelId || !source.client) return;

    try {
        const loggingChannel = await source.client.channels.fetch(channelId);
        if (!loggingChannel?.isTextBased?.()) {
            console.warn("[command-logger] configured logging channel is not text-based");
            return;
        }

        const user = source.user || source.author;
        const guild = source.guild;
        const embed = new EmbedBuilder()
            .setTitle("Command Used")
            .setColor(0x2b6cb0)
            .addFields(
                { name: "Command", value: `\`${commandName}\``, inline: true },
                { name: "Type", value: commandType, inline: true },
                { name: "Arguments", value: `\`${formatArguments(argumentsValue).slice(0, 1020)}\``, inline: false },
                { name: "User", value: user ? `${user} (${user.tag})` : "Unknown user", inline: false },
                { name: "Channel", value: getChannelLabel(source), inline: true },
                { name: "Guild", value: guild?.name || "Direct message", inline: true }
            )
            .setTimestamp();

        await loggingChannel.send({ embeds: [embed] });
    } catch (error) {
        console.error("[command-logger] failed to log command:", error.message);
    }
}

module.exports = { logCommand };
