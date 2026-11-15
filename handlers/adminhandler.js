const state = require("../state");
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits
} = require("discord.js");
const { logCommand } = require("../utils/command-logger");
const { createMessageProgress } = require("../utils/progress-embed");
const { setTicketPanelsLocked } = require("../utils/ticket-panel-lock");

const LOCKDOWN_ROLE = "1536806576202186842";
const LOCKED_CHANNEL_IDS = [
    "1518976753492693225"
];
const VOICE_LOCK_CHANNEL_IDS = new Set([
    "1533079860673515550",
    "1533079884639768717"
]);

async function confirmForceLock(message, options = {}) {
    const confirmationIds = `${message.author.id}_${message.id}`;
    const proceedId = `force_lock_proceed_${confirmationIds}`;
    const abortId = `force_lock_abort_${confirmationIds}`;
    if (!message.client.activeForceLockConfirmations) {
        message.client.activeForceLockConfirmations = new Set();
    }
    message.client.activeForceLockConfirmations.add(message.id);

    let confirmation;
    try {
        confirmation = await message.reply({
            content: options.prompt || "⚠️ Are you sure you want to activate the force lock?",
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(proceedId)
                        .setLabel("Proceed")
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(abortId)
                        .setLabel("Abort")
                        .setStyle(ButtonStyle.Danger)
                )
            ]
        });
    } catch (error) {
        message.client.activeForceLockConfirmations.delete(message.id);
        throw error;
    }

    try {
        const choice = await confirmation.awaitMessageComponent({
            filter: interaction => interaction.user.id === message.author.id,
            time: 30_000
        });

        if (choice.customId === abortId) {
            await choice.update({
                content: "🛑 Force lock aborted.",
                components: []
            });
            return false;
        }

        await choice.update({
            content: "🔒 Force lock confirmed. Applying...",
            components: []
        });
        return true;
    } catch {
        await confirmation.edit({
            content: "⌛ Force lock confirmation expired. No changes were made.",
            components: []
        });
        return false;
    } finally {
        message.client.activeForceLockConfirmations.delete(message.id);
    }
}

function updateForceLockOverwrites(overwrites, everyoneId, permission, shouldLock) {
    const updated = new Map(overwrites);
    if (shouldLock && !updated.has(everyoneId)) {
        if (updated.size >= 100) {
            throw new Error(
                "This channel already has 100 permission overwrites and no @everyone overwrite; Discord cannot add the force-lock overwrite."
            );
        }
        updated.set(everyoneId, {
            id: everyoneId,
            type: 0,
            allow: 0n,
            deny: 0n
        });
    }
    if (updated.size > 100) {
        throw new Error("This channel has more than Discord's 100 permission-overwrite limit.");
    }

    for (const [id, overwrite] of updated) {
        let allow = overwrite.allow;
        let deny = overwrite.deny;

        if (shouldLock) {
            allow &= ~permission;
            deny |= permission;
        } else {
            allow &= ~permission;
            deny &= ~permission;
        }

        updated.set(id, { ...overwrite, allow, deny });
    }

    return [...updated.values()];
}

async function applyForceLock(message, config, shouldLock, command) {
    const startedAt = process.hrtime.bigint();
    const savedForceLockOverwrites = state.load().forceLockOverwrites;
    const stepLabels = [
        "Find lock channels and validate permission capacity",
        ...(shouldLock ? ["Save original channel permissions", "Lock ticket panel buttons"] : []),
        ...(shouldLock
            ? LOCKED_CHANNEL_IDS.map(id => `Update permissions in <#${id}>`)
            : savedForceLockOverwrites
                ? ["Restore saved channel permissions"]
                : []),
        ...(!shouldLock ? ["Unlock ticket panel buttons"] : []),
        "Save the lock state",
        "Refresh the admin panel"
    ];
    const progress = createMessageProgress(
        message,
        shouldLock ? "Applying force lock" : "Applying force unlock",
        stepLabels
    );
    await progress.start();

    let channels = [];
    const lockOverwritesByChannel = new Map();
    let step = 0;
    let stateSaved = true;
    const originalOverwrites = shouldLock && savedForceLockOverwrites
        ? { ...savedForceLockOverwrites }
        : {};

    try {
        await progress.runStep(step++, async () => {
            channels = await Promise.all(
                LOCKED_CHANNEL_IDS.map(id => message.guild?.channels.fetch(id).catch(() => null))
            );
            const missingChannels = LOCKED_CHANNEL_IDS.filter((id, index) => !channels[index]);
            if (missingChannels.length > 0) {
                throw new Error(`Could not find all lock channels. Missing: ${missingChannels.join(", ")}`);
            }

            for (const channel of channels) {
                const permission = PermissionFlagsBits.ViewChannel | (
                    VOICE_LOCK_CHANNEL_IDS.has(channel.id)
                        ? PermissionFlagsBits.Connect
                        : PermissionFlagsBits.SendMessages
                );
                const overwrites = new Map(
                    channel.permissionOverwrites.cache.map(overwrite => [overwrite.id, {
                        id: overwrite.id,
                        type: overwrite.type,
                        allow: BigInt(overwrite.allow.bitfield),
                        deny: BigInt(overwrite.deny.bitfield)
                    }])
                );
                if (shouldLock) {
                    if (!originalOverwrites[channel.id]) {
                            originalOverwrites[channel.id] = [...overwrites.values()].map(overwrite => ({
                                id: overwrite.id,
                                type: overwrite.type,
                                allow: overwrite.allow.toString(),
                                deny: overwrite.deny.toString()
                            }));
                    }
                    lockOverwritesByChannel.set(
                            channel.id,
                            updateForceLockOverwrites(
                                overwrites,
                                channel.guild.id,
                                BigInt(permission),
                                true
                            )
                    );
                }
            }
        });

        if (shouldLock) {
            await progress.runStep(step++, async () => {
                stateSaved = state.save({
                    locked: true,
                    forceLocked: true,
                    forceLockOverwrites: originalOverwrites
                });
                if (!stateSaved) {
                    throw new Error("Could not save original channel permissions; force lock was not applied.");
                }
            });

            config.forceLocked = true;
            config.locked = true;
            await progress.runStep(step++, () =>
                setTicketPanelsLocked(message.client, config.channels.ticketchannelid, true)
            );
        }

        if (shouldLock) {
            for (const channel of channels) {
                await progress.runStep(step++, () =>
                    channel.permissionOverwrites.set(lockOverwritesByChannel.get(channel.id))
                );
            }
        } else if (savedForceLockOverwrites) {
            await progress.runStep(step++, async () => {
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
            });
        }

        if (!shouldLock) {
            await progress.runStep(step++, () =>
                setTicketPanelsLocked(message.client, config.channels.ticketchannelid, false)
            );
        }

        await progress.runStep(step++, async () => {
            config.locked = shouldLock;
            config.forceLocked = shouldLock;
            stateSaved = state.save(shouldLock
                ? {
                    locked: true,
                    forceLocked: true,
                    forceLockOverwrites: originalOverwrites
                }
                : {
                    locked: false,
                    forceLocked: false,
                    forceLockOverwrites: null
                });
        });

        await progress.runStep(step++, async () => {
            if (typeof message.client.notifyAdminPanelRefresh === "function") {
                await message.client.notifyAdminPanelRefresh();
            }
        });

        const elapsedMilliseconds = Number(process.hrtime.bigint() - startedAt) / 1e6;
        await progress.complete(
            (shouldLock
                ? `🔒 Force lock completed in ${(elapsedMilliseconds / 1000).toFixed(2)} seconds.`
                : `🔓 Force unlock completed in ${(elapsedMilliseconds / 1000).toFixed(2)} seconds.`) +
            (!shouldLock && !savedForceLockOverwrites
                ? "\n⚠️ No saved channel permissions were found, so channel permissions were left unchanged."
                : "") +
            (stateSaved ? "" : "\n⚠️ Channel permissions changed, but the lock state could not be saved.")
        );
        return true;
    } catch (error) {
        console.error(`[adminhandler] failed to ${command}:`, error);
        await progress.setNotice(error.message);
        return false;
    }
}

module.exports = async function handleAdminCommand(message, config) {
    if (message.author.bot || !message.content.startsWith("a!")) return false;

    if (config.maintenanceMode && !config.developers?.includes(message.author.id)) {
        await message.reply("🔴 The bot is currently offline for maintenance.");
        return true;
    }

    const args = message.content.slice(2).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();
    if (!["forcelock", "forceunlock"].includes(command)) return false;

    await logCommand(message, config, `a!${command}`, "Admin command", args);

    if (!message.member?.roles?.cache?.has(LOCKDOWN_ROLE)) {
        await message.reply("❌ This command is restricted to the admin role.");
        return true;
    }

    if (command === "forcelock") {
        if (!await confirmForceLock(message)) return true;
    }

    await applyForceLock(message, config, command === "forcelock", command);
    return true;
};

module.exports.applyForceLock = applyForceLock;
module.exports.confirmForceLock = confirmForceLock;
module.exports.updateForceLockOverwrites = updateForceLockOverwrites;