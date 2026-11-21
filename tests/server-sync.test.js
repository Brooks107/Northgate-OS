const assert = require("node:assert/strict");
const test = require("node:test");
const { ChannelType } = require("discord.js");
const { getUnsupportedChannels } = require("../utils/server-sync");

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
