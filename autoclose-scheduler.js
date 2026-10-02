const fs = require("fs");
const path = require("path");
const closeCommand = require("./commands/close");

const SCHEDULE_FILE = path.join(__dirname, "auto-closes.json");
const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const RETRY_DELAY_MS = 60_000;

const jobs = new Map();
const timers = new Map();
let client;
let config;

function parseDuration(value) {
    const match = String(value).trim().match(/^(\d+)(s|m|h|d)$/i);
    if (!match) return null;

    const amount = Number(match[1]);
    const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2].toLowerCase()];
    const duration = amount * unitMs;
    return Number.isSafeInteger(duration) && duration > 0 && duration <= MAX_DURATION_MS
        ? duration
        : null;
}

function saveJobs() {
    const temporaryFile = `${SCHEDULE_FILE}.tmp`;
    fs.writeFileSync(temporaryFile, JSON.stringify([...jobs.values()], null, 2));
    fs.renameSync(temporaryFile, SCHEDULE_FILE);
}

function removeJob(channelId) {
    const timer = timers.get(channelId);
    if (timer) clearTimeout(timer);
    timers.delete(channelId);
    jobs.delete(channelId);
    saveJobs();
}

function arm(job, delay = Math.max(0, job.runAt - Date.now())) {
    const previousTimer = timers.get(job.channelId);
    if (previousTimer) clearTimeout(previousTimer);

    const timer = setTimeout(() => {
        timers.delete(job.channelId);
        runJob(job.channelId).catch(error => {
            console.error(`[autoclose] Failed to process ticket #${job.ticketId}:`, error.message);
            if (jobs.has(job.channelId)) arm(job, RETRY_DELAY_MS);
        });
    }, Math.min(delay, MAX_TIMER_DELAY_MS));
    timers.set(job.channelId, timer);
}

async function runJob(channelId) {
    const job = jobs.get(channelId);
    if (!job) return;
    if (job.runAt > Date.now()) return arm(job);

    const channel = await client.channels.fetch(job.channelId);
    if (!channel) {
        removeJob(channelId);
        return;
    }

    const matchingChannel = closeCommand.findTicketChannel(channel.guild, job.ticketId);
    if (!matchingChannel || matchingChannel.id !== job.channelId) {
        removeJob(channelId);
        return;
    }

    const closedBy = {
        id: job.scheduledById,
        tag: `Autoclose timer (scheduled by ${job.scheduledByTag || job.scheduledById})`
    };
    await closeCommand.closeTicket(channel, client, config, closedBy);
    removeJob(channelId);
    console.log(`[autoclose] Closed ticket #${job.ticketId}`);
}

function init(botClient, botConfig) {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    jobs.clear();
    client = botClient;
    config = botConfig;

    try {
        const savedJobs = JSON.parse(fs.readFileSync(SCHEDULE_FILE, "utf8"));
        if (Array.isArray(savedJobs)) {
            for (const job of savedJobs) {
                if (!job?.channelId || !job.guildId || !Number.isInteger(job.ticketId) || !Number.isFinite(job.runAt)) continue;
                jobs.set(job.channelId, job);
                arm(job);
            }
        }
    } catch (error) {
        if (error.code !== "ENOENT") {
            console.error("[autoclose] Could not load schedules:", error.message);
        }
    }

    console.log(`[autoclose] Restored ${jobs.size} scheduled close(s).`);
}

function schedule(channel, durationMs, user) {
    const previous = jobs.get(channel.id);
    const job = {
        channelId: channel.id,
        guildId: channel.guild.id,
        ticketId: Number(channel.name.match(/-(\d+)(?:-|$)/)?.[1]),
        scheduledById: user.id,
        scheduledByTag: user.tag,
        runAt: Date.now() + durationMs
    };

    jobs.set(channel.id, job);
    try {
        saveJobs();
    } catch (error) {
        if (previous) jobs.set(channel.id, previous);
        else jobs.delete(channel.id);
        throw error;
    }

    arm(job);
    return { runAt: job.runAt, replaced: Boolean(previous) };
}

module.exports = { init, schedule, parseDuration, MAX_DURATION_MS };