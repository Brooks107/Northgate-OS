const fs = require("fs");
const path = require("path");

const ARCHIVE_FILE = path.join(__dirname, "ticket-archive.json");

function loadArchive() {
    try {
        if (!fs.existsSync(ARCHIVE_FILE)) return {};
        const contents = fs.readFileSync(ARCHIVE_FILE, "utf8").trim();
        return contents ? JSON.parse(contents) : {};
    } catch (error) {
        console.error("[ticket-archive] Failed to load archive:", error.message);
        return {};
    }
}

function saveArchive(archive) {
    try {
        const temporaryFile = `${ARCHIVE_FILE}.tmp`;
        fs.writeFileSync(temporaryFile, JSON.stringify(archive, null, 2));
        fs.renameSync(temporaryFile, ARCHIVE_FILE);
    } catch (error) {
        console.error("[ticket-archive] Failed to save archive:", error.message);
    }
}

function serializeEmbed(embed) {
    return typeof embed?.toJSON === "function" ? embed.toJSON() : embed ?? null;
}

function serializeDashboardMessage(message) {
    if (!message) return null;

    return {
        id: message.id,
        channelId: message.channelId,
        url: message.url,
        content: message.content,
        embeds: message.embeds?.map(serializeEmbed) || [],
        components: message.components?.map(component =>
            typeof component.toJSON === "function" ? component.toJSON() : component
        ) || [],
        editedTimestamp: message.editedTimestamp,
        updatedAt: new Date().toISOString()
    };
}

function upsert(ticketChannelId, ticketData) {
    const archive = loadArchive();
    const previous = archive[ticketChannelId] || {};
    archive[ticketChannelId] = {
        ...previous,
        ...ticketData,
        channelId: ticketChannelId,
        updatedAt: new Date().toISOString()
    };
    saveArchive(archive);
}

function recordEvent(ticketChannelId, event) {
    const archive = loadArchive();
    const ticket = archive[ticketChannelId];
    if (!ticket) return;

    ticket.events = Array.isArray(ticket.events) ? ticket.events : [];
    ticket.events.push({
        ...event,
        timestamp: event.timestamp || new Date().toISOString()
    });
    ticket.updatedAt = new Date().toISOString();
    saveArchive(archive);
}

function get(ticketChannelId) {
    return loadArchive()[ticketChannelId] || null;
}

function recordMessage(channelId, message) {
    const archive = loadArchive();
    const ticket = archive[channelId];
    if (!ticket) return;

    ticket.messages = Array.isArray(ticket.messages) ? ticket.messages : [];
    ticket.messages.push({
        id: message.id,
        authorId: message.author?.id || null,
        authorTag: message.author?.tag || message.author?.username || null,
        content: message.content || "",
        attachments: [...(message.attachments?.values() || [])].map(attachment => ({
            name: attachment.name,
            url: attachment.url
        })),
        embeds: message.embeds?.map(serializeEmbed) || [],
        createdAt: message.createdAt?.toISOString?.() || new Date().toISOString()
    });
    ticket.updatedAt = new Date().toISOString();
    saveArchive(archive);
}

module.exports = {
    get,
    loadArchive,
    recordMessage,
    recordEvent,
    serializeDashboardMessage,
    upsert
};
