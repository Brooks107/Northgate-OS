const { ComponentType } = require("discord.js");

const TICKET_OPEN_BUTTON_IDS = new Set([
    "ticket_support",
    "ticket_appeal",
    "ticket_hire",
    "ticket_partnership"
]);
const TICKET_CREATION_INTERACTION_IDS = new Set([
    ...TICKET_OPEN_BUTTON_IDS,
    "modal_ticket_support",
    "modal_ticket_appeal",
    "modal_ticket_hire",
    "modal_ticket_partnership"
]);

async function setTicketPanelsLocked(client, channelId, locked) {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased() || !channel.messages) {
        throw new Error(`Ticket panel channel ${channelId} is not a text channel.`);
    }

    let before;
    let changedButtons = 0;

    while (true) {
        const messages = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
        if (messages.size === 0) break;

        for (const message of messages.values()) {
            let messageChanged = false;
            const components = message.components.map(row => ({
                type: row.type,
                components: row.components.map(component => {
                    const serialized = component.toJSON();
                    if (
                        component.type === ComponentType.Button &&
                        TICKET_OPEN_BUTTON_IDS.has(component.customId) &&
                        Boolean(component.disabled) !== locked
                    ) {
                        serialized.disabled = locked;
                        messageChanged = true;
                        changedButtons++;
                    }
                    return serialized;
                })
            }));

            if (messageChanged) await message.edit({ components });
        }

        before = [...messages.values()].reduce((oldestId, message) =>
            !oldestId || BigInt(message.id) < BigInt(oldestId) ? message.id : oldestId,
        undefined);
        if (messages.size < 100) break;
    }

    return changedButtons;
}

module.exports = { setTicketPanelsLocked, TICKET_CREATION_INTERACTION_IDS };
