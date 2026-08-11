// A ticket channel's topic carries two independent pieces of state:
//
//   owner:<userId>     who opened the ticket  (needed by /approve and /deny to DM them)
//   claimed:<userId>   which staff member claimed it, if anyone
//
// They are stored together as "owner:123 claimed:456" so that claiming a ticket
// cannot destroy the record of who opened it, and unclaiming cannot destroy the
// owner either. Topics written by older versions of the bot ("claimed:456" on
// its own) still parse correctly.

function build({ ownerId, claimedBy } = {}) {
    const parts = [];
    if (ownerId) parts.push(`owner:${ownerId}`);
    if (claimedBy) parts.push(`claimed:${claimedBy}`);
    return parts.join(" ");
}

function parse(topic) {
    const state = { ownerId: null, claimedBy: null };
    if (!topic) return state;

    const owner = topic.match(/owner:(\d+)/);
    const claimed = topic.match(/claimed:(\d+)/);

    if (owner) state.ownerId = owner[1];
    if (claimed) state.claimedBy = claimed[1];

    return state;
}

module.exports = { build, parse };
