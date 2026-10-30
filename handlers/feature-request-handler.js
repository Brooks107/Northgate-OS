const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags
} = require("discord.js");

const REQUESTS_FILE = path.join(__dirname, "..", "feature-requests.json");
const REQUEST_ACTIONS = new Set([
    "decline",
    "forward_coolbeanz",
    "forward_westcliff",
    "take",
    "hold",
    "complete",
    "impossible",
    "continue",
    "modal_decline",
    "modal_hold"
]);
const activeRequests = new Set();

function loadRequests() {
    try {
        const requests = JSON.parse(fs.readFileSync(REQUESTS_FILE, "utf8"));
        if (!requests || typeof requests !== "object" || Array.isArray(requests)) {
            throw new Error("feature-requests.json must contain a request object");
        }
        return requests;
    } catch (error) {
        if (error.code === "ENOENT") return {};
        throw error;
    }
}

function saveRequests(requests) {
    const temporaryFile = `${REQUESTS_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryFile, JSON.stringify(requests, null, 2), "utf8");
    fs.renameSync(temporaryFile, REQUESTS_FILE);
}

function createReference(requests) {
    let reference;
    do {
        reference = `FR-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    } while (requests[reference]);
    return reference;
}

function makeEmbed(request) {
    return new EmbedBuilder()
        .setColor(request.status === "Complete" ? 0x2ecc71 : request.status === "Rendered Impossible" || request.status === "Declined" ? 0xe74c3c : 0x3498db)
        .setTitle(`Feature Request ${request.reference}`)
        .addFields(
            { name: "Bot", value: request.bot, inline: true },
            { name: "Status", value: request.status, inline: true },
            { name: "Description", value: request.description },
            { name: "Requester", value: `<@${request.requesterId}> (${request.requesterTag})` },
            { name: "Requested timeframe", value: request.timeframe },
            { name: "Submitted", value: `<t:${Math.floor(new Date(request.submittedAt).getTime() / 1000)}:F>` }
        )
        .setTimestamp(new Date(request.submittedAt));
}

function button(customId, label, style) {
    return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
}

function reviewRows(reference) {
    return [
        new ActionRowBuilder().addComponents(
            button(`frequest:decline:${reference}`, "Decline", ButtonStyle.Danger),
            button(`frequest:forward_coolbeanz:${reference}`, "Forward to coolbeanz02778", ButtonStyle.Secondary),
            button(`frequest:forward_westcliff:${reference}`, "Forward to Westcliff7799", ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            button(`frequest:take:${reference}`, "Take this request", ButtonStyle.Success),
            button(`frequest:hold:${reference}`, "Put on hold", ButtonStyle.Primary)
        )
    ];
}

function outcomeRows(reference) {
    return [new ActionRowBuilder().addComponents(
        button(`frequest:complete:${reference}`, "Complete", ButtonStyle.Success),
        button(`frequest:impossible:${reference}`, "Rendered Impossible", ButtonStyle.Danger)
    )];
}

function continueRows(reference) {
    return [new ActionRowBuilder().addComponents(
        button(`frequest:continue:${reference}`, "Continue request", ButtonStyle.Primary)
    )];
}

function isReviewer(userId, config) {
    return String(config.featureRequests?.initialReviewerId || "") === userId;
}

function getAction(customId) {
    const match = customId.match(/^frequest:([a-z_]+):(FR-[A-Z0-9-]+)$/);
    if (!match || !REQUEST_ACTIONS.has(match[1])) return null;
    return { action: match[1], reference: match[2] };
}

async function updateReviewMessage(client, request, components) {
    if (!request.reviewChannelId || !request.reviewMessageId) return;
    const channel = await client.channels.fetch(request.reviewChannelId);
    const message = await channel.messages.fetch(request.reviewMessageId);
    await message.edit({ embeds: [makeEmbed(request)], components });
}

async function notifyRequester(client, request, content) {
    const requester = await client.users.fetch(request.requesterId);
    await requester.send({
        content: `${content}\n\n**Reference:** ${request.reference}\n**Bot:** ${request.bot}`
    });
}

async function submit(interaction, client, config) {
    const reviewerId = String(config.featureRequests?.initialReviewerId || "");
    if (!/^\d{17,20}$/.test(reviewerId)) {
        throw new Error("featureRequests.initialReviewerId is missing or invalid in config.json");
    }

    const requests = loadRequests();
    const reference = createReference(requests);
    const request = {
        reference,
        requesterId: interaction.user.id,
        requesterTag: interaction.user.tag,
        bot: interaction.options.getString("bot", true),
        description: interaction.options.getString("description", true).trim(),
        timeframe: interaction.options.getString("timeframe", true).trim(),
        submittedAt: new Date().toISOString(),
        status: "Under review",
        assignedTo: reviewerId
    };

    const reviewer = await client.users.fetch(reviewerId);
    const reviewMessage = await reviewer.send({
        embeds: [makeEmbed(request)],
        components: reviewRows(reference)
    });

    request.reviewChannelId = reviewMessage.channelId;
    request.reviewMessageId = reviewMessage.id;
    requests[reference] = request;
    saveRequests(requests);

    return interaction.reply({
        content: `✅ Your feature request was sent for review.\n**Reference:** ${reference}`,
        flags: MessageFlags.Ephemeral
    });
}

async function openReasonModal(interaction, action, reference) {
    const isHold = action === "hold";
    const modal = new ModalBuilder()
        .setCustomId(`frequest:modal_${isHold ? "hold" : "decline"}:${reference}`)
        .setTitle(isHold ? "Put Request on Hold" : "Decline Feature Request");
    const reason = new TextInputBuilder()
        .setCustomId("reason")
        .setLabel("Reason")
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(1000)
        .setRequired(true);
    const rows = [new ActionRowBuilder().addComponents(reason)];

    if (isHold) {
        const timeframe = new TextInputBuilder()
            .setCustomId("timeframe")
            .setLabel("Estimated response timeframe")
            .setPlaceholder("For example, within one week")
            .setStyle(TextInputStyle.Short)
            .setMaxLength(100)
            .setRequired(true);
        rows.push(new ActionRowBuilder().addComponents(timeframe));
    }

    return interaction.showModal(modal.addComponents(...rows));
}

async function handleButton(interaction, client, config, action, reference) {
    const requests = loadRequests();
    const request = requests[reference];
    if (!request) {
        return interaction.reply({
            content: "❌ This feature request could not be found.",
            flags: MessageFlags.Ephemeral
        });
    }

    if (action === "decline" || action === "hold") {
        if (!isReviewer(interaction.user.id, config) || request.status !== "Under review") {
            return interaction.reply({
                content: "❌ Only the initial reviewer can use this action while the request is under review.",
                flags: MessageFlags.Ephemeral
            });
        }
        return openReasonModal(interaction, action, reference);
    }

    if (action === "forward_coolbeanz" || action === "forward_westcliff") {
        if (!isReviewer(interaction.user.id, config) || request.status !== "Under review") {
            return interaction.reply({
                content: "❌ Only the initial reviewer can forward a request while it is under review.",
                flags: MessageFlags.Ephemeral
            });
        }

        const recipientId = String(config.featureRequests?.[
            action === "forward_coolbeanz" ? "coolbeanzId" : "westcliffId"
        ] || "");
        if (!/^\d{17,20}$/.test(recipientId)) {
            throw new Error(`featureRequests recipient for ${action} is missing or invalid in config.json`);
        }

        request.status = "Forwarded";
        request.assignedTo = recipientId;
        const recipient = await client.users.fetch(recipientId);
        const forwardedMessage = await recipient.send({
            embeds: [makeEmbed(request)],
            components: outcomeRows(reference)
        });
        request.assignedChannelId = forwardedMessage.channelId;
        request.assignedMessageId = forwardedMessage.id;
        requests[reference] = request;
        saveRequests(requests);
        await interaction.message.edit({ embeds: [makeEmbed(request)], components: [] });
        return interaction.reply({
            content: `✅ ${recipient} has received feature request ${reference}.`,
            flags: MessageFlags.Ephemeral
        });
    }

    if (action === "take") {
        if (!isReviewer(interaction.user.id, config) || request.status !== "Under review") {
            return interaction.reply({
                content: "❌ Only the initial reviewer can take a request while it is under review.",
                flags: MessageFlags.Ephemeral
            });
        }
        request.status = "In progress";
        request.assignedTo = interaction.user.id;
        requests[reference] = request;
        saveRequests(requests);
        await interaction.message.edit({ embeds: [makeEmbed(request)], components: outcomeRows(reference) });
        return interaction.reply({
            content: `✅ You have taken feature request ${reference}.`,
            flags: MessageFlags.Ephemeral
        });
    }

    if (action === "continue") {
        if (!isReviewer(interaction.user.id, config) || request.status !== "On hold") {
            return interaction.reply({
                content: "❌ Only the initial reviewer can continue a request that is on hold.",
                flags: MessageFlags.Ephemeral
            });
        }
        request.status = "Under review";
        request.assignedTo = interaction.user.id;
        requests[reference] = request;
        saveRequests(requests);
        await interaction.message.edit({ embeds: [makeEmbed(request)], components: reviewRows(reference) });
        return interaction.reply({
            content: `✅ Feature request ${reference} is back under review.`,
            flags: MessageFlags.Ephemeral
        });
    }

    if (action === "complete" || action === "impossible") {
        if (request.assignedTo !== interaction.user.id ||
            !["In progress", "Forwarded"].includes(request.status)) {
            return interaction.reply({
                content: "❌ Only the person assigned to an active request can record its outcome.",
                flags: MessageFlags.Ephemeral
            });
        }
        request.status = action === "complete" ? "Complete" : "Rendered Impossible";
        requests[reference] = request;
        saveRequests(requests);
        await interaction.message.edit({ embeds: [makeEmbed(request)], components: [] });
        await notifyRequester(
            client,
            request,
            action === "complete"
                ? "✅ Your feature request has been completed."
                : "❌ The team determined that your feature request is immpossible to complete."
        );
        return interaction.reply({
            content: `✅ Feature request ${reference} marked ${request.status}.`,
            flags: MessageFlags.Ephemeral
        });
    }
}

async function handleModal(interaction, client, config, action, reference) {
    if (!isReviewer(interaction.user.id, config)) {
        return interaction.reply({
            content: "❌ Only the initial reviewer can process this request.",
            flags: MessageFlags.Ephemeral
        });
    }

    const requests = loadRequests();
    const request = requests[reference];
    if (!request || request.status !== "Under review") {
        return interaction.reply({
            content: "❌ This request is no longer under review.",
            flags: MessageFlags.Ephemeral
        });
    }

    const reason = interaction.fields.getTextInputValue("reason").trim();
    if (action === "modal_decline") {
        request.status = "Declined";
        request.decisionReason = reason;
        requests[reference] = request;
        saveRequests(requests);
        await updateReviewMessage(client, request, []);
        await notifyRequester(client, request, `❌ Your feature request was declined.\n**Reason:** ${reason}`);
        return interaction.reply({
            content: `✅ Feature request ${reference} was declined and the requester was notified.`,
            flags: MessageFlags.Ephemeral
        });
    }

    const estimatedTimeframe = interaction.fields.getTextInputValue("timeframe").trim();
    request.status = "On hold";
    request.holdReason = reason;
    request.holdTimeframe = estimatedTimeframe;
    requests[reference] = request;
    saveRequests(requests);
    await updateReviewMessage(client, request, continueRows(reference));
    await notifyRequester(
        client,
        request,
        `⏸️ Your feature request has been put on hold.\n**Reason:** ${reason}\n**Estimated timeframe:** ${estimatedTimeframe}`
    );
    return interaction.reply({
        content: `✅ Feature request ${reference} is on hold and the requester was notified.`,
        flags: MessageFlags.Ephemeral
    });
}

async function execute(interaction, client, config) {
    const parsed = getAction(interaction.customId);
    if (!parsed) {
        return interaction.reply({
            content: "❌ This feature request action is no longer active.",
            flags: MessageFlags.Ephemeral
        });
    }

    if (activeRequests.has(parsed.reference)) {
        return interaction.reply({
            content: "⏳ This request is already being updated. Please wait a moment and try again.",
            flags: MessageFlags.Ephemeral
        });
    }

    activeRequests.add(parsed.reference);
    try {
        if (interaction.isButton()) {
            return await handleButton(interaction, client, config, parsed.action, parsed.reference);
        }
        if (interaction.isModalSubmit()) {
            return await handleModal(interaction, client, config, parsed.action, parsed.reference);
        }
        return false;
    } finally {
        activeRequests.delete(parsed.reference);
    }
}

module.exports = { execute, submit };
