const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createTicketReservations } = require("../utils/ticket-reservations");

test("active ticket numbers survive channel deletion and restart until explicitly closed", t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "northgate-ticket-reservations-"));
    const registryPath = path.join(root, "ticket-reservations.json");
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const mainChannelId = "11111111111111111";
    const openerId = "22222222222222222";
    const legacyRecords = [{
        channelId: mainChannelId,
        ticketId: 7,
        ticketName: "support-7",
        openerId,
        status: "🟢 Open"
    }];
    const reservations = createTicketReservations(registryPath);
    reservations.init(legacyRecords);
    reservations.reconcile([], true);

    assert.deepEqual([...reservations.getActiveTicketIds()], [7]);
    assert.equal(reservations.findActiveByTicketId(7).status, "orphaned");

    reservations.closeByChannelId(mainChannelId);
    const restarted = createTicketReservations(registryPath);
    restarted.init(legacyRecords);
    restarted.reconcile([{
        id: "33333333333333333",
        name: "support-7",
        topic: `owner:${openerId}`,
        guildId: "vault-guild"
    }], true);
    assert.deepEqual([...restarted.getActiveTicketIds()], []);

    const newVaultChannel = {
        id: "44444444444444444",
        name: "support-7",
        topic: `owner:${openerId}`,
        guildId: "vault-guild"
    };
    restarted.register(newVaultChannel);
    restarted.reconcile([
        { id: "33333333333333333", name: "support-7", topic: `owner:${openerId}` },
        newVaultChannel
    ], true);

    assert.deepEqual([...restarted.getActiveTicketIds()], [7]);
    assert.equal(restarted.getActiveRecords().length, 1);
    assert.equal(restarted.getActiveRecords()[0].channelId, newVaultChannel.id);

    const saved = JSON.parse(fs.readFileSync(registryPath, "utf8"));
    assert.deepEqual(
        Object.keys(saved.reservations[newVaultChannel.id]).sort(),
        ["category", "channelMissing", "openerId", "status", "ticketId"]
    );
});
