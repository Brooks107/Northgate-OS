const { EmbedBuilder } = require("discord.js");
const fs = require("fs");
const path = require("path");

/**
 * Ticket tracking system - creates and updates embeds in a private channel
 * Each ticket gets its own embed that shows original info + injected updates
 */

const TRACKING_FILE = path.join(__dirname, "ticket-tracking.json");
const TICKET_CHANNEL_PATTERN = /^(support|appeal|commission|hiring|partnership|interrogation)-(\d+)(?:-|$)/i;
const SCAN_LOG_CHANNEL_ID = "1548387829628010703";

// In-memory map: ticketChannelId -> { messageId, embeds: [] }
let trackedTickets = {};
let scanDiagnostics = null;
let scanDiagnosticsMessageId = null;
let reconciliationRunning = false;
let hourlyReconciliationTimer = null;

function getTicketStatus(status, eventType, fallback = "🟢 Open") {
    const combined = `${eventType || ""} ${status || ""}`.toLowerCase();
    if (combined.includes("closed") || combined.includes("close")) return "🔴 Closed";
    if (combined.includes("unclaim") || combined.includes("open")) return "🟢 Open";
    if (combined.includes("claim") || combined.includes("transfer")) return "🟡 Claimed";
    return fallback;
}

function hydrateTicketRecord(record) {
    record.status = getTicketStatus(record.status, record.lastEvent);
    delete record.dashboardStatus;
    return record;
}

function loadTracking() {
    try {
        if (fs.existsSync(TRACKING_FILE)) {
            const savedTracking = JSON.parse(fs.readFileSync(TRACKING_FILE, "utf8"));
            trackedTickets = {};
            scanDiagnostics = savedTracking?._scanDiagnostics || null;
            scanDiagnosticsMessageId = savedTracking?._scanDiagnosticsMessageId || null;
            if (savedTracking && typeof savedTracking === "object" && !Array.isArray(savedTracking)) {
                for (const [ticketChannelId, record] of Object.entries(savedTracking)) {
                    if (!ticketChannelId.startsWith("_") && record && typeof record === "object" && !Array.isArray(record)) {
                        trackedTickets[ticketChannelId] = hydrateTicketRecord(record);
                    }
                }
            }
        }
    } catch (err) {
        console.error("[ticket-tracker] Failed to load tracking:", err.message);
        trackedTickets = {};
    }
}

function saveTracking() {
    try {
        const temporaryFile = `${TRACKING_FILE}.tmp`;
        const serializedTickets = Object.fromEntries(Object.entries(trackedTickets).map(([ticketChannelId, ticket]) => {
            const record = { ...ticket };
            delete record.dashboardStatus;
            return [ticketChannelId, {
                ...record,
                status: ticket.status || getTicketStatus(ticket.status, ticket.lastEvent)
            }];
        }));
        if (scanDiagnostics) serializedTickets._scanDiagnostics = scanDiagnostics;
        if (scanDiagnosticsMessageId) serializedTickets._scanDiagnosticsMessageId = scanDiagnosticsMessageId;
        fs.writeFileSync(temporaryFile, JSON.stringify(serializedTickets, null, 2));
        fs.renameSync(temporaryFile, TRACKING_FILE);
    } catch (err) {
        console.error("[ticket-tracker] Failed to save tracking:", err.message);
    }
}

function getEmbedField(embed, name) {
    return embed.fields?.find(field => field.name === name)?.value || "";
}

function getCurrentEmbedStatus(message, fallback) {
    return message.embeds?.[0]?.fields?.find(field => field.name === "📌 Status")?.value || fallback || "🟢 Open";
}

function setDisplayMetadata(tracked, ticketChannel) {
    const originalInfo = tracked.originalInfo || {};
    const metadata = {
        ticketName: ticketChannel.name,
        ticketTitle: originalInfo.title || tracked.ticketTitle || "Support Ticket",
        userId: originalInfo.userId || tracked.userId || null
    };
    const changed = Object.entries(metadata).some(([key, value]) => tracked[key] !== value);
    Object.assign(tracked, metadata);
    return changed;
}

async function fetchAllMessages(channel) {
    const messages = [];
    let before;

    while (true) {
        const batch = await channel.messages.fetch({
            limit: 100,
            ...(before ? { before } : {})
        });
        messages.push(...batch.values());
        if (batch.size < 100) break;
        before = batch.last()?.id;
        if (!before) break;
    }

    return messages;
}

async function sendScanDiagnostics(client, diagnostics) {
    try {
        const loggingChannel = await client.channels.fetch(SCAN_LOG_CHANNEL_ID);
        if (!loggingChannel || typeof loggingChannel.send !== "function") return;

        const skippedExamples = diagnostics.skippedExamples
            .map(example => `${example.reason}: ${example.channelName || example.footer || "no footer"} / ${example.ticketNumber || example.title || "no ticket number"}`)
            .join("\n")
            .slice(0, 1024);
        const embed = new EmbedBuilder()
            .setTitle("Ticket Tracker Scan")
            .setColor(diagnostics.status === "completed" ? 0x2b6cb0 : 0xc0392b)
            .setDescription(`Scan ${diagnostics.status}.`)
            .addFields(
                { name: "Active ticket channels", value: String(diagnostics.activeTicketChannels), inline: true },
                { name: "Messages scanned", value: String(diagnostics.messagesScanned), inline: true },
                { name: "Embeds scanned", value: String(diagnostics.embedsScanned), inline: true },
                { name: "Matching active tickets", value: String(diagnostics.activeTicketsWithMatchingEmbeds), inline: true },
                { name: "Imported", value: String(diagnostics.imported), inline: true },
                { name: "Already tracked", value: String(diagnostics.alreadyTrackedTickets), inline: true },
                { name: "No active match", value: String(diagnostics.embedsWithoutActiveTicketMatch), inline: true },
                { name: "Other authors", value: String(diagnostics.messagesFromOtherAuthors), inline: true }
            )
            .setTimestamp(new Date(diagnostics.completedAt));

        if (diagnostics.lastError) {
            embed.addFields({ name: "Error", value: diagnostics.lastError.slice(0, 1024), inline: false });
        }
        if (skippedExamples) {
            embed.addFields({ name: "Skipped examples", value: skippedExamples, inline: false });
        }

        let message = scanDiagnosticsMessageId
            ? await loggingChannel.messages.fetch(scanDiagnosticsMessageId).catch(() => null)
            : null;

        if (!message && loggingChannel.messages?.fetch) {
            const recentMessages = await loggingChannel.messages.fetch({ limit: 100 });
            const existingPanels = recentMessages.filter(candidate =>
                candidate.author?.id === client.user?.id &&
                candidate.embeds?.some(existingEmbed => existingEmbed.title === "Ticket Tracker Scan")
            );
            message = existingPanels.first() || null;
            for (const duplicate of existingPanels.values()) {
                if (duplicate.id !== message?.id) await duplicate.delete().catch(() => {});
            }
        }

        if (message) {
            await message.edit({ embeds: [embed] });
        } else {
            message = await loggingChannel.send({ embeds: [embed] });
        }
        scanDiagnosticsMessageId = message.id;
        saveTracking();
    } catch (error) {
        console.error("[ticket-tracker] Could not send scan report to logging channel:", error.message);
    }
}

async function runReconciliation(client, config) {
    const diagnostics = {
        lastRunAt: new Date().toISOString(),
        status: "running",
        trackerChannelId: config?.trackerChannelId || null,
        activeTicketChannels: 0,
        messagesScanned: 0,
        messagesWithEmbeds: 0,
        messagesFromCurrentBot: 0,
        messagesFromOtherAuthors: 0,
        embedsScanned: 0,
        embedsMissingFooterOrNumber: 0,
        embedsWithoutActiveTicketMatch: 0,
        ambiguousTicketMatches: 0,
        activeTicketsWithMatchingEmbeds: 0,
        alreadyTrackedTickets: 0,
        duplicateEmbedsForTicket: 0,
        imported: 0,
        skippedExamples: []
    };
    scanDiagnostics = diagnostics;
    saveTracking();

    const finishScan = async status => {
        diagnostics.status = status;
        diagnostics.completedAt = new Date().toISOString();
        saveTracking();
        await sendScanDiagnostics(client, diagnostics);
    };

    if (!config?.trackerChannelId) {
        diagnostics.lastError = "trackerChannelId is not configured";
        await finishScan("skipped");
        return 0;
    }

    let trackerChannel;
    try {
        trackerChannel = await client.channels.fetch(config.trackerChannelId);
    } catch (error) {
        console.error("[ticket-tracker] Could not fetch tracker channel for reconciliation:", error.message);
        diagnostics.lastError = error.message;
        await finishScan("failed");
        return 0;
    }

    if (!trackerChannel?.messages?.fetch) {
        console.error("[ticket-tracker] Tracker channel cannot be read; skipping reconciliation.");
        diagnostics.lastError = "Tracker channel cannot be read";
        await finishScan("failed");
        return 0;
    }

    const activeChannels = [];
    for (const guild of client.guilds.cache.values()) {
        try {
            const channels = await guild.channels.fetch();
            for (const channel of channels.values()) {
                const match = channel?.name?.match(TICKET_CHANNEL_PATTERN);
                if (match && (typeof channel.isTextBased !== "function" || channel.isTextBased())) {
                    activeChannels.push({ channel, ticketId: Number(match[2]) });
                }
            }
        } catch (error) {
            console.error(`[ticket-tracker] Could not scan ticket channels in ${guild.name}:`, error.message);
            diagnostics.lastError = `Could not scan ticket channels in ${guild.name}: ${error.message}`;
        }
    }
    diagnostics.activeTicketChannels = activeChannels.length;

    let messages;
    try {
        messages = await fetchAllMessages(trackerChannel);
    } catch (error) {
        console.error("[ticket-tracker] Could not read tracker messages for reconciliation:", error.message);
        diagnostics.lastError = error.message;
        await finishScan("failed");
        return 0;
    }
    diagnostics.messagesScanned = messages.length;

    const activeByName = new Map();
    let metadataUpdated = false;
    for (const active of activeChannels) {
        const tracked = trackedTickets[active.channel.id];
        if (tracked && setDisplayMetadata(tracked, active.channel)) metadataUpdated = true;

        const matches = activeByName.get(active.channel.name) || [];
        matches.push(active);
        activeByName.set(active.channel.name, matches);
    }

    const candidatesByChannel = new Map();
    for (const message of messages) {
        if (!message.embeds?.length) continue;
        diagnostics.messagesWithEmbeds++;
        if (message.author?.id === client.user?.id) {
            diagnostics.messagesFromCurrentBot++;
        } else {
            diagnostics.messagesFromOtherAuthors++;
        }

        for (const embed of message.embeds || []) {
            diagnostics.embedsScanned++;
            const footerMatch = embed.footer?.text?.match(/^Channel:\s*(.+)$/);
            const titleMatch = embed.title?.match(/#\s*(\d+)\b/);
            if (!footerMatch || !titleMatch) {
                diagnostics.embedsMissingFooterOrNumber++;
                if (diagnostics.skippedExamples.length < 10) {
                    diagnostics.skippedExamples.push({
                        messageId: message.id,
                        reason: "Embed is missing the expected Channel footer or #ticket number",
                        title: embed.title || null,
                        footer: embed.footer?.text || null
                    });
                }
                continue;
            }

            const namedChannels = activeByName.get(footerMatch[1]) || [];
            const matchingChannels = namedChannels.filter(active => active.ticketId === Number(titleMatch[1]));
            if (matchingChannels.length !== 1) {
                if (matchingChannels.length > 1) {
                    diagnostics.ambiguousTicketMatches++;
                } else {
                    diagnostics.embedsWithoutActiveTicketMatch++;
                }
                if (diagnostics.skippedExamples.length < 10) {
                    diagnostics.skippedExamples.push({
                        messageId: message.id,
                        reason: matchingChannels.length > 1 ? "More than one active channel matched" : "No active channel matched footer and ticket number",
                        channelName: footerMatch[1],
                        ticketNumber: Number(titleMatch[1])
                    });
                }
                continue;
            }

            const channelId = matchingChannels[0].channel.id;
            const candidates = candidatesByChannel.get(channelId) || [];
            candidates.push({ message, embed, ticketId: matchingChannels[0].ticketId });
            candidatesByChannel.set(channelId, candidates);
        }
    }

    const knownMessageIds = new Set(Object.values(trackedTickets).map(ticket => ticket.messageId).filter(Boolean));
    diagnostics.activeTicketsWithMatchingEmbeds = candidatesByChannel.size;
    let added = 0;

    for (const [channelId, candidates] of candidatesByChannel) {
        if (trackedTickets[channelId]) {
            diagnostics.alreadyTrackedTickets++;
            continue;
        }
        if (candidates.length !== 1) {
            diagnostics.duplicateEmbedsForTicket++;
            continue;
        }

        const { message, embed, ticketId } = candidates[0];
        if (knownMessageIds.has(message.id)) {
            diagnostics.alreadyTrackedTickets++;
            continue;
        }

        const channel = activeChannels.find(active => active.channel.id === channelId)?.channel;
        if (!channel) continue;

        const userMatch = getEmbedField(embed, "📋 User").match(/^<@!?(\d+)>$/);
        const notes = getEmbedField(embed, "📝 Progress Notes")
            .split("\n")
            .map(note => note.trim())
            .filter(Boolean);

        const recoveredStatus = getEmbedField(embed, "📌 Status") || "🟢 Open";
        const recoveredTracking = {
            messageId: message.id,
            channelId: message.channelId || trackerChannel.id,
            ticketId,
            originalInfo: {
                id: ticketId,
                title: (embed.title || "Support Ticket").replace(/^🎫\s*/, "").replace(/\s+#\s*\d+\s*$/, ""),
                userId: userMatch?.[1] || null,
                description: embed.description || "No description",
                createdAt: getEmbedField(embed, "⏰ Created") || message.createdAt?.toISOString()
            },
            notes: notes.length ? notes : ["• Ticket created"],
            status: getTicketStatus(recoveredStatus, "reconciled"),
            updatedAt: message.editedAt?.toISOString() || message.createdAt?.toISOString() || new Date().toISOString(),
            lastEvent: "reconciled"
        };
        setDisplayMetadata(recoveredTracking, channel);
        trackedTickets[channelId] = recoveredTracking;
        knownMessageIds.add(message.id);
        added++;
    }
    diagnostics.imported = added;
    await finishScan("completed");

    if (added || metadataUpdated) {
        saveTracking();
        console.log(`[ticket-tracker] Reconciled ${added} active ticket(s); refreshed ${metadataUpdated ? "existing" : "no"} record labels.`);
    } else {
        console.log("[ticket-tracker] No missing active ticket records found.");
    }

    return added;
}

async function reconcileActiveTickets(client, config) {
    if (reconciliationRunning) return 0;

    reconciliationRunning = true;
    try {
        return await runReconciliation(client, config);
    } finally {
        reconciliationRunning = false;
    }
}

function startHourlyReconciliation(client, config) {
    if (hourlyReconciliationTimer) clearInterval(hourlyReconciliationTimer);

    hourlyReconciliationTimer = setInterval(() => {
        reconcileActiveTickets(client, config).catch(error => {
            console.error("[ticket-tracker] Hourly reconciliation failed:", error.message);
        });
    }, 60 * 60 * 1000);
    hourlyReconciliationTimer.unref?.();
}

module.exports = {
    init: loadTracking,
    reconcileActiveTickets,
    startHourlyReconciliation,

    /**
     * Create a new embed for a ticket
     * @param {Channel} ticketChannel - The ticket channel
     * @param {Object} ticketInfo - { title, user, description, category }
     */
    async createTicketEmbed(ticketChannel, ticketInfo, client, config) {
        if (!config.trackerChannelId) {
            console.warn("[ticket-tracker] trackerChannelId is not configured; ticket was not added to the dashboard.");
            return;
        }

        try {
            const trackerChannel = await client.channels.fetch(config.trackerChannelId);
            if (!trackerChannel || typeof trackerChannel.send !== "function") {
                console.error("[ticket-tracker] Configured tracker channel is unavailable or cannot receive messages.");
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle(`🎫 ${ticketInfo.title || "Support Ticket"} #${ticketInfo.id || "?"}`)
                .setColor("#0099ff")
                .setDescription(ticketInfo.description || "No description")
                .addFields(
                    { name: "📋 User", value: ticketInfo.userId ? `<@${ticketInfo.userId}>` : "Unknown", inline: true },
                    { name: "📌 Status", value: "🟢 Open", inline: true },
                    { name: "📝 Progress Notes", value: "• Ticket created", inline: false },
                    { name: "⏰ Created", value: new Date().toLocaleString(), inline: true }
                )
                .setFooter({ text: `Channel: ${ticketChannel.name}` })
                .setTimestamp();

            const message = await trackerChannel.send({ embeds: [embed] });

            trackedTickets[ticketChannel.id] = {
                ticketName: ticketChannel.name,
                ticketTitle: ticketInfo.title || "Support Ticket",
                userId: ticketInfo.userId || null,
                messageId: message.id,
                channelId: message.channelId,
                ticketId: ticketInfo.id,
                originalInfo: ticketInfo,
                notes: ["• Ticket created"],
                status: "🟢 Open",
                updatedAt: new Date().toISOString(),
                lastEvent: "created"
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
                    { name: "📋 User", value: tracked.originalInfo.userId ? `<@${tracked.originalInfo.userId}>` : "Unknown", inline: true },
                    { name: "📌 Status", value: getCurrentEmbedStatus(message, tracked.status), inline: true },
                    { name: "📝 Progress Notes", value: tracked.notes.join("\n") || "No notes", inline: false },
                    { name: "⏰ Created", value: tracked.originalInfo.createdAt || new Date().toLocaleString(), inline: true },
                    { name: "🔄 Last Updated", value: new Date().toLocaleString(), inline: true }
                )
                .setFooter({ text: `Channel: ${ticketChannel.name}` })
                .setTimestamp();

            await message.edit({ embeds: [embed] });
            tracked.updatedAt = new Date().toISOString();
            tracked.lastEvent = "note_added";
            saveTracking();

            console.log(`[ticket-tracker] Injected info into ${ticketChannel.name}`);
            return { success: true, noteCount: tracked.notes.length };
        } catch (err) {
            console.error("[ticket-tracker] Failed to inject info:", err.message);
            return { success: false, error: err.message };
        }
    },

    /**
     * Replace or delete a note by its 1-based position in the progress notes.
     */
    async substituteNote(ticketChannel, noteId, note, client) {
        const tracked = trackedTickets[ticketChannel.id];
        if (!tracked) {
            return { success: false, error: "Ticket not tracked" };
        }

        const noteIndex = noteId - 1;
        if (!Number.isInteger(noteId) || noteId < 1 || noteIndex >= tracked.notes.length) {
            return { success: false, error: `Note ${noteId} does not exist on this ticket.` };
        }

        try {
            const channel = await client.channels.fetch(tracked.channelId);
            const message = await channel.messages.fetch(tracked.messageId);

            if (note) {
                tracked.notes[noteIndex] = `• ${note}`;
            } else {
                tracked.notes.splice(noteIndex, 1);
            }

            const embed = new EmbedBuilder()
                .setTitle(`🎫 ${tracked.originalInfo.title || "Support Ticket"} #${tracked.ticketId || "?"}`)
                .setColor("#0099ff")
                .setDescription(tracked.originalInfo.description || "No description")
                .addFields(
                    { name: "📋 User", value: tracked.originalInfo.userId ? `<@${tracked.originalInfo.userId}>` : "Unknown", inline: true },
                    { name: "📌 Status", value: getCurrentEmbedStatus(message, tracked.status), inline: true },
                    { name: "📝 Progress Notes", value: tracked.notes.join("\n") || "No notes", inline: false },
                    { name: "⏰ Created", value: tracked.originalInfo.createdAt || new Date().toLocaleString(), inline: true },
                    { name: "🔄 Last Updated", value: new Date().toLocaleString(), inline: true }
                )
                .setFooter({ text: `Channel: ${ticketChannel.name}` })
                .setTimestamp();

            await message.edit({ embeds: [embed] });
            tracked.updatedAt = new Date().toISOString();
            tracked.lastEvent = note ? "note_updated" : "note_deleted";
            saveTracking();

            return { success: true, noteCount: tracked.notes.length };
        } catch (err) {
            console.error(`[ticket-tracker] Failed to substitute note in ${ticketChannel.name}:`, err.message);
            return { success: false, error: err.message };
        }
    },

    /**
     * Update ticket status
     */
    async updateStatus(ticketChannel, newStatus, client) {
        const tracked = trackedTickets[ticketChannel.id];
        if (!tracked) return;

        tracked.status = getTicketStatus(newStatus, "status_updated", tracked.status);
        setDisplayMetadata(tracked, ticketChannel);
        tracked.updatedAt = new Date().toISOString();
        tracked.lastEvent = "status_updated";
        saveTracking();

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
     * Persist channel/topic changes and reflect a live event in the dashboard.
     */
    async syncTicket(ticketChannel, event) {
        const tracked = trackedTickets[ticketChannel.id];
        if (!tracked) return;

        const dashboardStatus = event.status || event.label || tracked.status || "🟢 Open";
        tracked.status = getTicketStatus(dashboardStatus, event.type, tracked.status);
        setDisplayMetadata(tracked, ticketChannel);
        if (event.userId) tracked.assignedTo = event.userId;
        if (event.type === "unclaimed") delete tracked.assignedTo;
        tracked.updatedAt = new Date().toISOString();
        tracked.lastEvent = event.type || "updated";
        saveTracking();

        try {
            const dashboardChannel = await ticketChannel.guild.channels.fetch(tracked.channelId);
            const dashboardMessage = await dashboardChannel.messages.fetch(tracked.messageId);
            const embed = dashboardMessage.embeds[0]
                ? EmbedBuilder.from(dashboardMessage.embeds[0])
                : null;
            if (embed) {
                const fields = embed.data.fields || [];
                const statusField = fields.find(field => field.name === "📌 Status");
                if (statusField) statusField.value = dashboardStatus;
                embed.data.fields = fields;
                await dashboardMessage.edit({ embeds: [embed] });
            }
        } catch (error) {
            console.error(`[ticket-tracker] Failed to sync ${ticketChannel.name}:`, error.message);
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
                tracked = fileData[ticketChannel.id]
                    ? hydrateTicketRecord(fileData[ticketChannel.id])
                    : null;
            } catch (err) {
                console.warn(`[ticket-tracker] Could not load tracking from file for ${ticketChannel.name}`);
            }
        }

        if (!tracked) {
            console.warn(`[ticket-tracker] No tracking found for ${ticketChannel.name}`);
            return;
        }

        trackedTickets[ticketChannel.id] = tracked;
        try {
            const dashboardChannel = await ticketChannel.guild.channels.fetch(tracked.channelId);
            const message = await dashboardChannel.messages.fetch(tracked.messageId);
            if (message) {
                await message.delete();
                console.log(`[ticket-tracker] Deleted embed for ${ticketChannel.name}`);
            }
        } catch (err) {
            console.error(`[ticket-tracker] Failed to delete embed for ${ticketChannel.name}:`, err.message);
        } finally {
            tracked.status = "🔴 Closed";
            tracked.closedAt = tracked.closedAt || new Date().toISOString();
            tracked.updatedAt = new Date().toISOString();
            tracked.lastEvent = "closed";
            saveTracking();
        }
    },

    /**
     * Get tracking info for a ticket
     */
    getTracking(ticketChannelId) {
        return trackedTickets[ticketChannelId];
    }
};
