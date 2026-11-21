const TICKET_CHANNEL_PATTERN = /^(support|appeal|hiring|partnership|interrogation)-(\d+)(?:-|$)/i;

function parseTicketChannelName(name) {
    const match = String(name || "").match(TICKET_CHANNEL_PATTERN);
    if (!match) return null;

    const ticketId = Number(match[2]);
    if (!Number.isInteger(ticketId) || ticketId < 1 || ticketId > 20) return null;

    return {
        category: match[1].toLowerCase(),
        ticketId
    };
}

module.exports = { parseTicketChannelName };
