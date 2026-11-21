const assert = require("node:assert/strict");
const test = require("node:test");
const { ChannelType } = require("discord.js");
const {
    applyChannelOptions,
    applyRolePositions,
    applyRoleOptions,
    buildRolePositionUpdates,
    channelOptionsWithoutBoostFeatures,
    getMaxVoiceBitrate,
    getUnsupportedChannels,
    isGuildFeatureRequirementError,
    roleOptionsWithoutBoostFeatures,
    ensureVaultManagementAccess
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

test("boost and guild-feature errors are recognized without swallowing unrelated errors", () => {
    assert.equal(isGuildFeatureRequirementError({ code: 50101 }), true);
    assert.equal(isGuildFeatureRequirementError({ message: "This server needs more boosts." }), true);
    assert.equal(isGuildFeatureRequirementError({ message: "Missing guild feature" }), true);
    assert.equal(isGuildFeatureRequirementError({ code: 50013, message: "Missing permissions" }), false);
});

test("role sync retries without boost-restricted styling", async () => {
    const calls = [];
    const target = {
        roles: {
            create: async options => {
                calls.push(options);
                if (options.icon) {
                    throw Object.assign(new Error("Missing guild feature"), { code: 50035 });
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

test("sync preflight reports missing Vault management permissions", async () => {
    const target = {
        members: {
            me: { permissions: { has: () => false } }
        },
        roles: { cache: new Map() }
    };

    await assert.rejects(
        ensureVaultManagementAccess({ user: { id: "bot-id" } }, target),
        /Manage Roles, Manage Channels/
    );
});

test("sync preflight reports Vault roles above the bot's hierarchy", async () => {
    const target = {
        id: "vault-guild",
        members: {
            me: { permissions: { has: () => true } }
        },
        roles: {
            cache: new Map([
                ["higher-role", {
                    id: "higher-role",
                    name: "Staff",
                    managed: false,
                    editable: false,
                    position: 5
                }]
            ])
        }
    };

    await assert.rejects(
        ensureVaultManagementAccess({ user: { id: "bot-id" } }, target),
        /Move the bot's highest role above them/
    );
});

test("role positions preserve Main hierarchy below the bot role", () => {
    const roles = [
        { role: { id: "lowest" } },
        { role: { id: "middle" } },
        { role: { id: "highest" } }
    ];

    const positions = buildRolePositionUpdates(roles, 8, false);

    assert.deepEqual(
        positions.map(({ role, position }) => [role.id, position]),
        [["lowest", 5], ["middle", 6], ["highest", 7]]
    );
    assert.throws(
        () => buildRolePositionUpdates(roles, 3, false),
        /Move the bot's role above the roles being mirrored/
    );
});

test("role positioning falls back to individual moves after bulk permission denial", async () => {
    const calls = [];
    const updates = [
        {
            role: {
                name: "Member",
                id: "member-role",
                setPosition: async position => calls.push(["member-role", position])
            },
            position: 1
        },
        {
            role: {
                name: "Staff",
                id: "staff-role",
                setPosition: async position => calls.push(["staff-role", position])
            },
            position: 2
        }
    ];
    const target = {
        roles: {
            setPositions: async () => {
                throw Object.assign(new Error("Missing Permissions"), { code: 50013 });
            }
        }
    };

    await applyRolePositions(target, updates);

    assert.deepEqual(calls, [["member-role", 1], ["staff-role", 2]]);
});

test("individual role-position fallback identifies the role Discord rejects", async () => {
    const updates = [{
        role: {
            name: "Staff",
            id: "staff-role",
            setPosition: async () => {
                throw Object.assign(new Error("Missing Permissions"), { code: 50013 });
            }
        },
        position: 2
    }];
    const target = {
        roles: {
            setPositions: async () => {
                throw Object.assign(new Error("Missing Permissions"), { code: 50013 });
            }
        }
    };

    await assert.rejects(
        applyRolePositions(target, updates),
        /role "Staff" \(staff-role\) could not be moved to position 2/
    );
});
