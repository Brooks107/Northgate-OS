const assert = require("node:assert/strict");
const test = require("node:test");
const {
    confirmEnvironmentSwitch,
    getEnvironmentSwitchConfirmationOwner,
    handleForceSyncCommand
} = require("../handlers/devhandler");

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

function createSwitchConfirmation(customId) {
    const capture = { updates: [] };
    const message = {
        id: "request-id",
        author: { id: "developer-id" },
        reply: async payload => {
            capture.prompt = payload;
            return {
                awaitMessageComponent: async options => {
                    capture.confirmationOwner = getEnvironmentSwitchConfirmationOwner(customId);
                    const interaction = {
                        customId,
                        user: { id: "developer-id" },
                        update: async payload => capture.updates.push(payload)
                    };
                    assert.equal(options.filter(interaction), true);
                    return interaction;
                },
                edit: async payload => capture.updates.push(payload)
            };
        }
    };
    return { message, capture };
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

test("Vault test launch confirmation explains Main is preserved", async () => {
    const { message, capture } = createSwitchConfirmation(
        "environment_switch_confirm_request-id"
    );

    assert.equal(await confirmEnvironmentSwitch(message, "launch", "test"), true);
    assert.equal(capture.confirmationOwner, "developer-id");
    assert.equal(getEnvironmentSwitchConfirmationOwner("environment_switch_confirm_request-id"), null);
    assert.match(capture.prompt.embeds[0].toJSON().description, /Main config file will be left untouched/);
    assert.match(capture.updates[0].content, /Switching environments/);
});

test("Vault production launch confirmation explains Main config blanking", async () => {
    const { message, capture } = createSwitchConfirmation(
        "environment_switch_cancel_request-id"
    );

    assert.equal(await confirmEnvironmentSwitch(message, "launch"), false);
    assert.equal(getEnvironmentSwitchConfirmationOwner("environment_switch_cancel_request-id"), null);
    assert.match(capture.prompt.embeds[0].toJSON().description, /blank the values in `main-config\.json`/);
    assert.match(capture.prompt.embeds[0].toJSON().description, /private remote/);
});

test("return-to-Main confirmation warns that it does not restore blank settings", async () => {
    const { message, capture } = createSwitchConfirmation(
        "environment_switch_confirm_request-id"
    );

    assert.equal(await confirmEnvironmentSwitch(message, "land"), true);
    assert.equal(getEnvironmentSwitchConfirmationOwner("environment_switch_confirm_request-id"), null);
    assert.match(capture.prompt.embeds[0].toJSON().description, /does not restore Main settings/);
    assert.match(capture.updates[0].content, /Switching environments/);
});
