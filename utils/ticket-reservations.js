const fs = require("fs");
const path = require("path");
const ticketTopic = require("../ticket-topic");
const { parseTicketChannelName } = require("./ticket-channel");

const RESERVATIONS_PATH = path.join(__dirname, "..", "ticket-reservations.json");

function parseTicketChannel(channel) {
    return parseTicketChannelName(channel?.name);
}

function isClosedStatus(status) {
    return /closed/i.test(String(status || ""));
}

function createTicketReservations(filePath = RESERVATIONS_PATH) {
    let reservations = new Map();
    let closedTicketIds = new Set();
    let initialized = false;

    function persist() {
        const temporaryPath = `${filePath}.${process.pid}.tmp`;
        try {
            const value = {
                version: 1,
                closedTicketIds: [...closedTicketIds],
                reservations: Object.fromEntries(reservations)
            };
            fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
            fs.renameSync(temporaryPath, filePath);
        } catch (error) {
            try {
                if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
            } catch (cleanupError) {
                console.error("[ticket-reservations] could not remove temporary file:", cleanupError.message);
            }
            throw new Error(`Could not save ticket reservations at ${filePath}: ${error.message}`);
        }
    }

    function init(legacyRecords = []) {
        if (initialized) return;

        let hasSavedRegistry = false;
        try {
            const saved = JSON.parse(fs.readFileSync(filePath, "utf8"));
            if (
                !saved ||
                saved.version !== 1 ||
                !saved.reservations ||
                typeof saved.reservations !== "object" ||
                Array.isArray(saved.reservations) ||
                (saved.closedTicketIds !== undefined && !Array.isArray(saved.closedTicketIds))
            ) {
                throw new Error("Ticket reservation file has an invalid format.");
            }

            for (const ticketId of saved.closedTicketIds || []) {
                if (!Number.isInteger(ticketId) || ticketId < 1 || ticketId > 20) {
                    throw new Error(`Closed ticket ID "${ticketId}" is invalid.`);
                }
                closedTicketIds.add(ticketId);
            }

            for (const [channelId, record] of Object.entries(saved.reservations)) {
                if (
                    !/^\d{17,20}$/.test(channelId) ||
                    !record ||
                    !Number.isInteger(record.ticketId) ||
                    record.ticketId < 1 ||
                    record.ticketId > 20 ||
                    !/^(support|appeal|hiring|partnership|interrogation)$/.test(record.category) ||
                    record.status !== "active" ||
                    typeof record.channelMissing !== "boolean"
                ) {
                    throw new Error(`Ticket reservation for channel ${channelId} is invalid.`);
                }
                reservations.set(channelId, {
                    ticketId: record.ticketId,
                    category: record.category,
                    openerId: /^\d{17,20}$/.test(String(record.openerId || ""))
                        ? String(record.openerId)
                        : null,
                    status: "active",
                    channelMissing: record.channelMissing
                });
            }
            for (const ticketId of closedTicketIds) {
                for (const [channelId, record] of reservations) {
                    if (record.ticketId === ticketId) reservations.delete(channelId);
                }
            }
            hasSavedRegistry = true;
        } catch (error) {
            if (error.code !== "ENOENT") {
                throw new Error(`Could not load ticket reservations at ${filePath}: ${error.message}`);
            }
        }

        if (!hasSavedRegistry) {
            for (const legacy of legacyRecords) {
                if (!legacy || isClosedStatus(legacy.status)) continue;
                const parsed = parseTicketChannel({ name: legacy.ticketName });
                const ticketId = Number(legacy.ticketId || parsed?.ticketId);
                if (
                    !/^\d{17,20}$/.test(String(legacy.channelId || "")) ||
                    !Number.isInteger(ticketId) ||
                    ticketId < 1 ||
                    ticketId > 20 ||
                    !parsed
                ) {
                    continue;
                }
                reservations.set(String(legacy.channelId), {
                    ticketId,
                    category: parsed.category,
                    openerId: /^\d{17,20}$/.test(String(legacy.openerId || ""))
                        ? String(legacy.openerId)
                        : null,
                    status: "active",
                    channelMissing: true
                });
            }
            const firstChannelByTicketId = new Map();
            for (const [channelId, record] of reservations) {
                if (firstChannelByTicketId.has(record.ticketId)) {
                    reservations.delete(channelId);
                } else {
                    firstChannelByTicketId.set(record.ticketId, channelId);
                }
            }
        }

        initialized = true;
        if (!hasSavedRegistry) persist();
    }

    function ensureInitialized() {
        if (!initialized) init();
    }

    function makeRecord(channel, info = {}) {
        const parsed = parseTicketChannel(channel);
        if (!parsed) return null;

        const existing = reservations.get(channel.id);
        const ownerFromTopic = ticketTopic.parse(channel.topic || "").ownerId;
        const openerId = info.openerId || info.userId || ownerFromTopic || existing?.openerId || null;
        return {
            ticketId: parsed.ticketId,
            category: parsed.category,
            openerId: /^\d{17,20}$/.test(String(openerId || "")) ? String(openerId) : null,
            status: "active",
            channelMissing: false
        };
    }

    function register(channel, info = {}) {
        ensureInitialized();
        if (!/^\d{17,20}$/.test(String(channel?.id || ""))) return false;
        const record = makeRecord(channel, info);
        if (!record) return false;

        const previousReservations = new Map(
            [...reservations.entries()].map(([channelId, value]) => [channelId, { ...value }])
        );
        const previousClosedTicketIds = new Set(closedTicketIds);
        if (closedTicketIds.has(record.ticketId)) {
            closedTicketIds.delete(record.ticketId);
            for (const [channelId, existing] of reservations) {
                if (existing.ticketId === record.ticketId) reservations.delete(channelId);
            }
        } else {
            const existingChannel = [...reservations.entries()].find(
                ([channelId, existing]) =>
                    channelId !== channel.id && existing.ticketId === record.ticketId
            );
            if (existingChannel) return false;
        }

        const previous = reservations.get(channel.id);
        if (previous && JSON.stringify(previous) === JSON.stringify(record)) return false;
        reservations.set(channel.id, record);
        try {
            persist();
        } catch (error) {
            reservations = previousReservations;
            closedTicketIds = previousClosedTicketIds;
            throw error;
        }
        return true;
    }

    function reconcile(liveChannels, complete = true) {
        ensureInitialized();
        const previousReservations = new Map(
            [...reservations.entries()].map(([channelId, value]) => [channelId, { ...value }])
        );
        const liveChannelIds = new Set();
        let changed = false;

        for (const channel of liveChannels) {
            if (!channel?.id) continue;
            liveChannelIds.add(channel.id);
            const record = makeRecord(channel);
            if (!record || closedTicketIds.has(record.ticketId)) continue;
            const existingForTicket = [...reservations.entries()].find(
                ([channelId, existing]) =>
                    channelId !== channel.id && existing.ticketId === record.ticketId
            );
            if (existingForTicket) continue;
            const previous = reservations.get(channel.id);
            if (!previous || JSON.stringify(previous) !== JSON.stringify(record)) {
                reservations.set(channel.id, record);
                changed = true;
            }
        }

        if (complete) {
            for (const [channelId, record] of reservations) {
                const channelMissing = !liveChannelIds.has(channelId);
                if (record.channelMissing !== channelMissing) {
                    record.channelMissing = channelMissing;
                    changed = true;
                }
            }
        }

        if (changed) {
            try {
                persist();
            } catch (error) {
                reservations = previousReservations;
                throw error;
            }
        }
    }

    function markChannelDeleted(channelId) {
        ensureInitialized();
        const record = reservations.get(channelId);
        if (!record || record.channelMissing) return false;
        record.channelMissing = true;
        try {
            persist();
        } catch (error) {
            record.channelMissing = false;
            throw error;
        }
        return true;
    }

    function closeByChannelId(channelId) {
        ensureInitialized();
        const record = reservations.get(channelId);
        if (!record) return false;

        const wasClosed = closedTicketIds.has(record.ticketId);
        reservations.delete(channelId);
        closedTicketIds.add(record.ticketId);
        try {
            persist();
        } catch (error) {
            reservations.set(channelId, record);
            if (!wasClosed) closedTicketIds.delete(record.ticketId);
            throw error;
        }
        return true;
    }

    function findActiveByTicketId(ticketId) {
        ensureInitialized();
        const matches = [...reservations.entries()]
            .filter(([, record]) => record.ticketId === Number(ticketId));
        if (!matches.length) return { status: "not-found" };
        if (matches.length > 1) return { status: "ambiguous" };

        const [channelId, record] = matches[0];
        return {
            status: record.channelMissing ? "orphaned" : "active",
            channelId,
            record: { ...record }
        };
    }

    function getActiveTicketIds() {
        ensureInitialized();
        return new Set([...reservations.values()].map(record => record.ticketId));
    }

    function getActiveRecords() {
        ensureInitialized();
        return [...reservations.entries()].map(([channelId, record]) => ({
            channelId,
            ...record
        }));
    }

    return {
        init,
        register,
        reconcile,
        markChannelDeleted,
        closeByChannelId,
        findActiveByTicketId,
        getActiveTicketIds,
        getActiveRecords
    };
}

const activeTicketReservations = createTicketReservations();

module.exports = {
    createTicketReservations,
    ...activeTicketReservations
};
