const state = require("../state");
const { PermissionFlagsBits, AttachmentBuilder } = require("discord.js");
const { logCommand } = require("../utils/command-logger");
const ticketTracker = require("../ticket-tracker");

const LOCKED_CHANNEL_IDS = [
    "1518976753492693225",
];

const VOICE_LOCK_CHANNEL_IDS = new Set([  
]);

async function saveTranscript(channel, closedBy, config) {
    try {
        const all = [];
        let lastId = null;

        while (true) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;

            const batch = await channel.messages.fetch(options);
            if (batch.size === 0) break;

            all.push(...batch.values());
            lastId = batch.last().id;
        }

        const messages = all.reverse();
        const lines = [];
        lines.push(`Transcript for #${channel.name}`);
        lines.push(`Closed by: ${closedBy.tag}`);
        lines.push(`Saved: ${new Date().toLocaleString()}`);
        lines.push(`Messages: ${messages.length}`);
        lines.push("=".repeat(50));
        lines.push("");

        for (const msg of messages) {
            const time = msg.createdAt.toLocaleString();
            lines.push(`[${time}] ${msg.author.tag}: ${msg.content || "(no text)"}`);

            for (const att of msg.attachments.values()) {
                lines.push(`    [file] ${att.name}: ${att.url}`);
            }
            for (const emb of msg.embeds) {
                lines.push(`    [embed] ${emb.title || ""} ${emb.description || ""}`);
            }
        }

        const file = new AttachmentBuilder(Buffer.from(lines.join("\n"), "utf-8"), {
            name: `${channel.name}-transcript.txt`
        });

        const transcriptChannelId = config?.channels?.transcriptschannelid || config?.transcriptschannelid;
        const logChannel = transcriptChannelId
            ? await channel.guild.channels.fetch(transcriptChannelId).catch(() => null)
            : null;

        if (!logChannel) {
            console.error("[devhandler] transcript failed: transcriptschannelid is wrong or the bot cannot see that channel.");
            return;
        }

        await logChannel.send({
            content: `📄 Transcript for **${channel.name}** (closed by ${closedBy.tag})`,
            files: [file],
            allowedMentions: { parse: [] }
        });
    } catch (err) {
        console.error("[devhandler] transcript failed:", err);
    }
}

module.exports = async function handleDeveloperCommand(message, config) {
    if (message.author.bot || !message.content.startsWith("d!")) return false;

    const args = message.content.slice(2).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();
    if (!["forcelock", "forceunlock", "forceclose"].includes(command)) return false;

    await logCommand(message, config, `d!${command}`, "Developer command");

    if (!config.developers?.includes(message.author.id)) {
        await message.reply("❌ This command is developer only - Please contact a member of the IT team to have them run it");
        return true;
    }

    if (command === "forceclose") {
        if (!config.developers?.includes(message.author.id)) {
            await message.reply("❌ This command is restricted to developers only.");
            return true;
        }

        const channel = message.channel;
        const ticketCategoryIds = new Set([
            config.generalticketcategory,
            config.appealsticketcategory,
            config.commissionsticketcategory,
            config.hiringticketcategory,
            config.partnershipticketcategory
        ].filter(Boolean));

        const isTicketChannel =
            Boolean(channel) &&
            (
                channel.name.match(/^(?:support|appeal|commission|hiring|partnership)-(\d+)(?:-|$)/) ||
                (channel.parentId && ticketCategoryIds.has(channel.parentId))
            );

        if (!isTicketChannel) {
            await message.reply("❌ d!forceclose must be used inside a ticket channel.");
            return true;
        }

        const match = channel.name.match(/^(?:support|appeal|commission|hiring|partnership)-(\d+)(?:-|$)/);
        const id = match ? Number(match[1]) : null;
        if (id !== null && message.client?.activeTicketIds) {
            message.client.activeTicketIds.delete(id);
        }

        await message.reply("🔒 Force closing ticket and saving transcript...");
        await saveTranscript(channel, message.author, config);
        await ticketTracker.removeTracking(channel);

        setTimeout(() => {
            channel.delete("Developer force close").catch(() => {});
        }, 3000);

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
            config.forceLocked = false;
            stateSaved = state.save({ locked: false, forceLocked: false });
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
            config.forceLocked = true;
            stateSaved = state.save({
                locked: true,
                forceLocked: true,
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

            config.locked = false;
            config.forceLocked = false;
            stateSaved = state.save({
                locked: false,
                forceLocked: false,
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
