const state = require("../state");
const { PermissionFlagsBits } = require("discord.js");
const { logCommand } = require("../utils/command-logger");

const LOCKED_CHANNEL_IDS = [
    "1518976753492693225",
];

const VOICE_LOCK_CHANNEL_IDS = new Set([  
]);

module.exports = async function handleDeveloperCommand(message, config) {
    if (message.author.bot || !message.content.startsWith("d!")) return false;

    const args = message.content.slice(2).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();
    if (command !== "forcelock" && command !== "forceunlock") return false;

    await logCommand(message, config, `d!${command}`, "Developer command");

    if (!config.developers?.includes(message.author.id)) {
        await message.reply("❌ This command is restricted to developers only.");
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
    const savedForceLockOverwrites = state.load().forceLockOverwrites;

    try {
        const statusReply = await message.reply(
            shouldLock ? "🔒 Applying force lock..." : "🔓 Applying force unlock..."
        );
        let stateSaved = true;

        if (!shouldLock) {
            config.locked = false;
            stateSaved = state.save({ locked: false });
        }

        const originalOverwrites = {};
        for (const channel of channels) {
            const permission = VOICE_LOCK_CHANNEL_IDS.has(channel.id)
                ? PermissionFlagsBits.Connect
                : PermissionFlagsBits.SendMessages;
            const overwrites = new Map(
                channel.permissionOverwrites.cache.map(overwrite => [overwrite.id, {
                    id: overwrite.id,
                    type: overwrite.type,
                    allow: BigInt(overwrite.allow.bitfield),
                    deny: BigInt(overwrite.deny.bitfield)
                }])
            );

            if (shouldLock) {
                originalOverwrites[channel.id] = [...overwrites.values()].map(overwrite => ({
                    id: overwrite.id,
                    type: overwrite.type,
                    allow: overwrite.allow.toString(),
                    deny: overwrite.deny.toString()
                }));
            }

            for (const role of roles) {
                const existing = overwrites.get(role.id);
                let allow = existing?.allow ?? 0n;
                let deny = existing?.deny ?? 0n;

                if (shouldLock) {
                    allow &= ~permission;
                    deny |= permission;
                } else {
                    allow &= ~permission;
                    deny &= ~permission;
                }

                overwrites.set(role.id, {
                    id: role.id,
                    type: 0,
                    allow,
                    deny
                });
            }

            await channel.permissionOverwrites.set([...overwrites.values()]);
        }

        if (shouldLock) {
            config.locked = true;
            stateSaved = state.save({
                locked: true,
                forceLockOverwrites: originalOverwrites
            });
        } else if (savedForceLockOverwrites) {
            for (const channel of channels) {
                const original = savedForceLockOverwrites[channel.id];
                if (!original) continue;

                await channel.permissionOverwrites.set(original.map(overwrite => ({
                    id: overwrite.id,
                    type: overwrite.type,
                    allow: BigInt(overwrite.allow),
                    deny: BigInt(overwrite.deny)
                })));
            }

            stateSaved = state.save({
                locked: false,
                forceLockOverwrites: null
            });
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
