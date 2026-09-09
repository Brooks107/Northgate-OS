const state = require("../state");

const LOCKED_CHANNEL_IDS = [
    "1518976753492693225"
];

module.exports = async function handleDeveloperCommand(message, config) {
    if (message.author.bot || !message.content.startsWith("!")) return false;

    const args = message.content.slice(2).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();
    if (command !== "forcelock" && command !== "forceunlock") return false;

    if (!config.developers?.includes(message.author.id)) {
        await message.reply("❌ You are not authorized to use this command.");
        return true;
    }

    const channels = await Promise.all(
        LOCKED_CHANNEL_IDS.map(id => message.guild?.channels.fetch(id).catch(() => null))
    );
    const missingChannels = LOCKED_CHANNEL_IDS.filter((id, index) => !channels[index]);
    if (missingChannels.length > 0) {
        await message.reply(`❌ Could not find all lock channels. Missing: ${missingChannels.join(", ")}`);
        return true;
    }

    const shouldLock = command === "forcelock";
    const roles = [...message.guild.roles.cache.values()];

    try {
        for (const channel of channels) {
            for (const role of roles) {
                await channel.permissionOverwrites.edit(role, {
                    SendMessages: shouldLock ? false : true
                });
            }
        }

        config.locked = shouldLock;
        const saved = state.save({ locked: shouldLock });
        if (!saved) {
            await message.reply("❌ Channel permissions changed, but the lock state could not be saved.");
            return true;
        }

        await message.reply(
            shouldLock
                ? "🔒 Force lock enabled. Sending messages is denied in all lock channels."
                : "🔓 Force lock disabled. Sending messages is allowed in all lock channels."
        );
    } catch (error) {
        console.error(`[devhandler] failed to ${command}:`, error);
        await message.reply("❌ Failed to update the lock channel permissions.");
    }

    return true;
};
