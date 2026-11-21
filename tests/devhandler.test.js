const assert = require("node:assert/strict");
const test = require("node:test");
const { handleForceSyncCommand } = require("../handlers/devhandler");

function createMessage(guildId) {
    const replies = [];
    const edits = [];
    const statusMessage = {
        edit: async content => edits.push(content)
    };
    return {
        message: {
            guildId,
            client: {},
            reply: async content => {
                replies.push(content);
                return statusMessage;
            }
        },
        replies,
        edits
    };
}

test("manual sync is restricted to the Vault guild", async () => {
    const { message, replies, edits } = createMessage("main-guild");
    let syncStarted = false;

    await handleForceSyncCommand(message, "vault-guild", async () => {
        syncStarted = true;
    });

    assert.equal(syncStarted, false);
    assert.deepEqual(replies, ["❌ Run `d!forcesync` in the Vault server."]);
    assert.deepEqual(edits, []);
});

test("manual sync reports completion in the Vault guild", async () => {
    const { message, replies, edits } = createMessage("vault-guild");
    let syncClient;

    await handleForceSyncCommand(message, "vault-guild", async client => {
        syncClient = client;
        return { status: "completed" };
    });

    assert.equal(syncClient, message.client);
    assert.match(replies[0], /circuit breaker remains active/);
    assert.deepEqual(edits, ["✅ Manual Main-to-Vault sync completed."]);
});

test("manual sync reports when safety approval is required", async () => {
    const { message, edits } = createMessage("vault-guild");

    await handleForceSyncCommand(message, "vault-guild", async () => ({
        status: "approval-required"
    }));

    assert.match(edits[0], /paused for safety/);
});
