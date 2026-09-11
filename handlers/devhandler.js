const state = require("../state");
const { PermissionFlagsBits } = require("discord.js");

const LOCKED_CHANNEL_IDS = [
    "1518976753492693225"
];

module.exports = async function handleDeveloperCommand(message, config) {
    if (message.author.bot || !message.content.startsWith("d!")) return false;

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
    const roles = [...(await message.guild.roles.fetch()).values()];
    const startedAt = process.hrtime.bigint();

    try {
        const statusReply = await message.reply(
            shouldLock ? "🔒 Applying force lock..." : "🔓 Applying force unlock..."
        );
        let stateSaved = true;

        if (!shouldLock) {
            config.locked = false;
            stateSaved = state.save({ locked: false });
        }

        for (const channel of channels) {
            const sendMessages = PermissionFlagsBits.SendMessages;
            const overwrites = new Map(
                channel.permissionOverwrites.cache.map(overwrite => [overwrite.id, overwrite])
            );

            for (const role of roles) {
                const existing = overwrites.get(role.id);
                let allow = existing ? BigInt(existing.allow.bitfield) : 0n;
                let deny = existing ? BigInt(existing.deny.bitfield) : 0n;

                if (shouldLock) {
                    allow &= ~sendMessages;
                    deny |= sendMessages;
                } else {
                    allow |= sendMessages;
                    deny &= ~sendMessages;
                }

                overwrites.set(role.id, {
                    id: role.id,
                    type: 0,
                    allow,
                    deny
                });
            }

            await channel.permissionOverwrites.set([...overwrites.values()].map(overwrite => ({
                id: overwrite.id,
                type: overwrite.type,
                allow: overwrite.allow.bitfield,
                deny: overwrite.deny.bitfield
            })));
        }

        if (shouldLock) {
            config.locked = true;
            stateSaved = state.save({ locked: true });
        }

        if (!stateSaved) {
            await message.reply("❌ Channel permissions changed, but the lock state could not be saved.");
            return true;
        }

        const elapsedMilliseconds = Number(process.hrtime.bigint() - startedAt) / 1e6;
        await statusReply.edit(
            shouldLock
                ? `🔒 Force lock completed in ${(elapsedMilliseconds / 1000).toFixed(2)} seconds.`
                : `🔓 Force unlock completed in ${(elapsedMilliseconds / 1000).toFixed(2)} seconds.`
        );
    } catch (error) {
        console.error(`[devhandler] failed to ${command}:`, error);
        await message.reply("❌ Failed to update the lock channel permissions.");
    }

    return true;
};
