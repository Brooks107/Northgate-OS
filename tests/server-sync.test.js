const assert = require("node:assert/strict");
const test = require("node:test");
const { ChannelType } = require("discord.js");
const {
    applyChannelOptions,
    applyRoleOptions,
    channelOptionsWithoutBoostFeatures,
    getMaxVoiceBitrate,
    getUnsupportedChannels,
    isBoostRequirementError,
    roleOptionsWithoutBoostFeatures
} = require("../utils/server-sync");

test("thread channels are ignored while unsupported guild channels still block sync", () => {
    const channel = (name, type) => ({ name, type, guild: {} });
    const guild = {
        channels: {
            cache: new Map([
                ["text", channel("text", ChannelType.GuildText)],
                ["announcement-thread", channel("announcement-thread", ChannelType.AnnouncementThread)],
                ["public-thread", channel("public-thread", ChannelType.PublicThread)],
                ["private-thread", channel("private-thread", ChannelType.PrivateThread)],
                ["unsupported", channel("unsupported", ChannelType.GuildDirectory)]
            ])
        }
    };

    assert.deepEqual(
        getUnsupportedChannels(guild).map(item => item.name),
        ["unsupported"]
    );
});

test("boost-restricted role styling falls back to basic color", () => {
    const options = roleOptionsWithoutBoostFeatures({
        colors: { primaryColor: 12, secondaryColor: 34, tertiaryColor: 56 },
        icon: Buffer.from("role icon"),
        unicodeEmoji: "\u2B50"
    });

    assert.deepEqual(options.colors, { primaryColor: 12 });
    assert.equal(options.icon, null);
    assert.equal(options.unicodeEmoji, null);
});

test("voice settings respect Vault boost tier and drop boost-restricted video quality", () => {
    const fallback = channelOptionsWithoutBoostFeatures({
        bitrate: 128_000,
        videoQualityMode: 2
    }, { premiumTier: 0 });

    assert.equal(getMaxVoiceBitrate({ premiumTier: 3 }), 384_000);
    assert.equal(fallback.bitrate, 64_000);
    assert.equal(Object.hasOwn(fallback, "videoQualityMode"), false);
});

test("boost requirement errors are recognized without swallowing unrelated errors", () => {
    assert.equal(isBoostRequirementError({ code: 50101 }), true);
    assert.equal(isBoostRequirementError({ message: "This server needs more boosts." }), true);
    assert.equal(isBoostRequirementError({ code: 50013, message: "Missing permissions" }), false);
});

test("role sync retries without boost-restricted styling", async () => {
    const calls = [];
    const target = {
        roles: {
            create: async options => {
                calls.push(options);
                if (options.icon) {
                    throw Object.assign(new Error("This server needs more boosts."), { code: 50101 });
                }
                return { id: "vault-role" };
            }
        }
    };

    const role = await applyRoleOptions(target, null, {
        name: "Staff",
        colors: { primaryColor: 12, secondaryColor: 34, tertiaryColor: 56 },
        icon: Buffer.from("role icon"),
        unicodeEmoji: null
    });

    assert.equal(role.id, "vault-role");
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].colors, { primaryColor: 12 });
    assert.equal(calls[1].icon, null);
});

test("channel sync retries without boost-restricted video quality", async () => {
    const calls = [];
    const target = {
        premiumTier: 0,
        channels: {
            create: async options => {
                calls.push(options);
                if (options.videoQualityMode !== undefined) {
                    throw Object.assign(new Error("This server needs more boosts."), { code: 50101 });
                }
                return { id: "vault-channel" };
            }
        }
    };

    const channel = await applyChannelOptions(
        target,
        null,
        { name: "Operations" },
        { name: "Operations", bitrate: 64_000, videoQualityMode: 2 }
    );

    assert.equal(channel.id, "vault-channel");
    assert.equal(calls.length, 2);
    assert.equal(Object.hasOwn(calls[1], "videoQualityMode"), false);
});
