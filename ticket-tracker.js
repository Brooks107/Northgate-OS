const { EmbedBuilder } = require("discord.js");
const fs = require("fs");
const path = require("path");

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
        if (!config.trackerChannelId) return;

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
            }
        } catch (err) {
            console.error("[ticket-tracker] Failed to update status:", err.message);
        }
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
            return;
        }

        try {
            const dashboardChannel = await ticketChannel.guild.channels.fetch(tracked.channelId);
            const message = await dashboardChannel.messages.fetch(tracked.messageId);
            
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
