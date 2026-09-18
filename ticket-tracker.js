const { EmbedBuilder } = require("discord.js");
const fs = require("fs");
const path = require("path");
const ticketArchive = require("./utils/ticket-archive");

/**
 * Ticket tracking system - creates and updates embeds in a private channel
 * Each ticket gets its own embed that shows original info + injected updates
 */

const TRACKING_FILE = path.join(__dirname, "ticket-tracking.json");

// In-memory map: ticketChannelId -> { messageId, embeds: [] }
let trackedTickets = {};

function loadTracking() {
    try {
        if (fs.existsSync(TRACKING_FILE)) {
            trackedTickets = JSON.parse(fs.readFileSync(TRACKING_FILE, "utf8"));
        }
    } catch (err) {
        console.error("[ticket-tracker] Failed to load tracking:", err.message);
        trackedTickets = {};
    }
}

function saveTracking() {
    try {
        fs.writeFileSync(TRACKING_FILE, JSON.stringify(trackedTickets, null, 2));
    } catch (err) {
        console.error("[ticket-tracker] Failed to save tracking:", err.message);
    }
}

module.exports = {
    init: loadTracking,

    /**
     * Create a new embed for a ticket
     * @param {Channel} ticketChannel - The ticket channel
     * @param {Object} ticketInfo - { title, user, description, category }
     */
    async createTicketEmbed(ticketChannel, ticketInfo, client, config) {
        const archiveBase = {
            ticketId: ticketInfo.id,
            status: "open",
            openedAt: ticketInfo.createdAt || new Date().toISOString(),
            ticket: ticketInfo,
            channel: {
                id: ticketChannel.id,
                name: ticketChannel.name,
                topic: ticketChannel.topic || null
            },
            notes: ["• Ticket created"],
            events: [{ type: "created", timestamp: new Date().toISOString() }]
        };

        if (!config.trackerChannelId) {
            ticketArchive.upsert(ticketChannel.id, archiveBase);
            return;
        }

        try {
            const trackerChannel = await client.channels.fetch(config.trackerChannelId);
            if (!trackerChannel) return;

            const embed = new EmbedBuilder()
                .setTitle(`🎫 ${ticketInfo.title || "Support Ticket"} #${ticketInfo.id || "?"}`)
                .setColor("#0099ff")
                .setDescription(ticketInfo.description || "No description")
                .addFields(
                    { name: "📋 User", value: `<@${ticketInfo.userId}>` || "Unknown", inline: true },
                    { name: "📌 Status", value: "🟢 Open", inline: true },
                    { name: "📝 Progress Notes", value: "• Ticket created", inline: false },
                    { name: "⏰ Created", value: new Date().toLocaleString(), inline: true }
                )
                .setFooter({ text: `Channel: ${ticketChannel.name}` })
                .setTimestamp();

            const message = await trackerChannel.send({ embeds: [embed] });

            trackedTickets[ticketChannel.id] = {
                messageId: message.id,
                channelId: message.channelId,
                ticketId: ticketInfo.id,
                originalInfo: ticketInfo,
                notes: ["• Ticket created"]
            };

            ticketArchive.upsert(ticketChannel.id, {
                ...archiveBase,
                dashboardChannel: {
                    id: trackerChannel.id,
                    name: trackerChannel.name
                },
                dashboardMessage: ticketArchive.serializeDashboardMessage(message)
            });

            saveTracking();
            console.log(`[ticket-tracker] Created embed for ${ticketChannel.name}`);
        } catch (err) {
            console.error("[ticket-tracker] Failed to create embed:", err.message);
        }
    },

    /**
     * Inject information into a ticket's embed
     * @param {Channel} ticketChannel - The ticket channel
     * @param {string} info - The info to inject
     */
    async injectInfo(ticketChannel, info, client) {
        const tracked = trackedTickets[ticketChannel.id];
        if (!tracked) {
            return { success: false, error: "Ticket not tracked" };
        }

        try {
            const channel = await client.channels.fetch(tracked.channelId);
            const message = await channel.messages.fetch(tracked.messageId);

            // Add to notes
            tracked.notes.push(`• ${info}`);

            // Keep last 10 notes
            if (tracked.notes.length > 10) {
                tracked.notes = tracked.notes.slice(-10);
            }

            // Rebuild embed with original info + new notes
            const embed = new EmbedBuilder()
                .setTitle(`🎫 ${tracked.originalInfo.title || "Support Ticket"} #${tracked.ticketId || "?"}`)
                .setColor("#0099ff")
                .setDescription(tracked.originalInfo.description || "No description")
                .addFields(
                    { name: "📋 User", value: `<@${tracked.originalInfo.userId}>` || "Unknown", inline: true },
                    { name: "📌 Status", value: "🟢 Open", inline: true },
                    { name: "📝 Progress Notes", value: tracked.notes.join("\n") || "No notes", inline: false },
                    { name: "⏰ Created", value: tracked.originalInfo.createdAt || new Date().toLocaleString(), inline: true },
                    { name: "🔄 Last Updated", value: new Date().toLocaleString(), inline: true }
                )
                .setFooter({ text: `Channel: ${ticketChannel.name}` })
                .setTimestamp();

            await message.edit({ embeds: [embed] });
            saveTracking();

            ticketArchive.upsert(ticketChannel.id, {
                status: "open",
                channel: {
                    id: ticketChannel.id,
                    name: ticketChannel.name,
                    topic: ticketChannel.topic || null
                },
                notes: [...tracked.notes],
                dashboardMessage: ticketArchive.serializeDashboardMessage(message),
                events: [
                    ...(ticketArchive.get(ticketChannel.id)?.events || []),
                    { type: "note", info, timestamp: new Date().toISOString() }
                ]
            });

            console.log(`[ticket-tracker] Injected info into ${ticketChannel.name}`);
            return { success: true, noteCount: tracked.notes.length };
        } catch (err) {
            console.error("[ticket-tracker] Failed to inject info:", err.message);
            return { success: false, error: err.message };
        }
    },

    /**
     * Update ticket status
     */
    async updateStatus(ticketChannel, newStatus, client) {
        const tracked = trackedTickets[ticketChannel.id];
        if (!tracked) return;

        try {
            const channel = await client.channels.fetch(tracked.channelId);
            const message = await channel.messages.fetch(tracked.messageId);

            const embeds = message.embeds;
            if (embeds.length > 0) {
                const embed = EmbedBuilder.from(embeds[0]);
                const fields = embed.data.fields || [];
                const statusIndex = fields.findIndex(f => f.name === "📌 Status");
                if (statusIndex >= 0) {
                    fields[statusIndex].value = newStatus;
                }
                embed.data.fields = fields;
                await message.edit({ embeds: [embed] });

                ticketArchive.upsert(ticketChannel.id, {
                    status: newStatus,
                    dashboardMessage: ticketArchive.serializeDashboardMessage(message),
                    events: [
                        ...(ticketArchive.get(ticketChannel.id)?.events || []),
                        { type: "status", status: newStatus, timestamp: new Date().toISOString() }
                    ]
                });
            }
        } catch (err) {
            console.error("[ticket-tracker] Failed to update status:", err.message);
        }
    },

    /**
     * Persist channel/topic changes and reflect a live event in the dashboard.
     */
    async syncTicket(ticketChannel, event) {
        const tracked = trackedTickets[ticketChannel.id];
        const archiveEntry = ticketArchive.get(ticketChannel.id);
        if (!tracked && !archiveEntry) return;

        let dashboardMessage = null;
        if (tracked) {
            try {
                const dashboardChannel = await ticketChannel.guild.channels.fetch(tracked.channelId);
                dashboardMessage = await dashboardChannel.messages.fetch(tracked.messageId);
                const embed = dashboardMessage.embeds[0]
                    ? EmbedBuilder.from(dashboardMessage.embeds[0])
                    : null;
                if (embed) {
                    const fields = embed.data.fields || [];
                    const statusField = fields.find(field => field.name === "📌 Status");
                    if (statusField) statusField.value = event.status || event.label || "🟢 Open";
                    await dashboardMessage.edit({ embeds: [embed] });
                }
            } catch (error) {
                console.error(`[ticket-tracker] Failed to sync ${ticketChannel.name}:`, error.message);
            }
        }

        ticketArchive.upsert(ticketChannel.id, {
            status: event.status || archiveEntry?.status || "open",
            channel: {
                id: ticketChannel.id,
                name: ticketChannel.name,
                topic: ticketChannel.topic || null
            },
            dashboardMessage: ticketArchive.serializeDashboardMessage(dashboardMessage),
            events: [
                ...(archiveEntry?.events || []),
                { ...event, timestamp: new Date().toISOString() }
            ]
        });
    },

    /**
     * Remove a ticket from tracking (when closed)
     */
    async removeTracking(ticketChannel) {
        let tracked = trackedTickets[ticketChannel.id];
        
        // If not in memory, try to load from file
        if (!tracked) {
            try {
                const fileData = JSON.parse(fs.readFileSync(TRACKING_FILE, "utf8"));
                tracked = fileData[ticketChannel.id];
            } catch (err) {
                console.warn(`[ticket-tracker] Could not load tracking from file for ${ticketChannel.name}`);
            }
        }

        if (!tracked) {
            console.warn(`[ticket-tracker] No tracking found for ${ticketChannel.name}`);
            ticketArchive.upsert(ticketChannel.id, {
                status: "closed",
                closedAt: new Date().toISOString(),
                channel: {
                    id: ticketChannel.id,
                    name: ticketChannel.name,
                    topic: ticketChannel.topic || null
                },
                events: [
                    ...(ticketArchive.get(ticketChannel.id)?.events || []),
                    { type: "closed", timestamp: new Date().toISOString() }
                ]
            });
            return;
        }

        try {
            const dashboardChannel = await ticketChannel.guild.channels.fetch(tracked.channelId);
            const message = await dashboardChannel.messages.fetch(tracked.messageId);

            ticketArchive.upsert(ticketChannel.id, {
                status: "closed",
                closedAt: new Date().toISOString(),
                channel: {
                    id: ticketChannel.id,
                    name: ticketChannel.name,
                    topic: ticketChannel.topic || null
                },
                dashboardMessage: ticketArchive.serializeDashboardMessage(message),
                events: [
                    ...(ticketArchive.get(ticketChannel.id)?.events || []),
                    { type: "closed", timestamp: new Date().toISOString() }
                ]
            });
            
            if (message) {
                await message.delete();
                console.log(`[ticket-tracker] Deleted embed for ${ticketChannel.name}`);
            }
        } catch (err) {
            console.error(`[ticket-tracker] Failed to delete embed for ${ticketChannel.name}:`, err.message);
        }

        delete trackedTickets[ticketChannel.id];
        saveTracking();
    },

    /**
     * Get tracking info for a ticket
     */
    getTracking(ticketChannelId) {
        return trackedTickets[ticketChannelId];
    }
};
