const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");

const OWNERSHIP_DEFCON_WARNING =
    "⚠️ **DEFCON use agreement — ownership confirmation required.**\n\n" +
    "By selecting **I Agree**, you confirm that you are using the DEFCON system in defense of a legitimate emergency. " +
    "Activating DEFCON to obtain unauthorized developer permissions without prior authorization from the Executive Director " +
    "of Technology and Informational Security is prohibited. If this misuse is repeated, your ID will be removed from the DEFCON protocol.";

function buildConfirmationComponents(userId, token) {
    const confirmationId = `${userId}_${token}`;
    const agreeId = `defcon_owner_agree_${confirmationId}`;
    const cancelId = `defcon_owner_cancel_${confirmationId}`;
    return {
        agreeId,
        cancelId,
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(agreeId)
                    .setLabel("I Agree - Emergency Use Only")
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(cancelId)
                    .setLabel("Cancel")
                    .setStyle(ButtonStyle.Secondary)
            )
        ]
    };
}

async function waitForConfirmation(response, userId, agreeId, cancelId) {
    try {
        const choice = await response.awaitMessageComponent({
            filter: interaction =>
                interaction.user.id === userId &&
                [agreeId, cancelId].includes(interaction.customId),
            time: 60_000
        });
        const agreed = choice.customId === agreeId;
        await choice.update({
            content: agreed
                ? "✅ DEFCON use agreement acknowledged. Continuing with the command."
                : "🛑 DEFCON command cancelled. No DEFCON action was taken.",
            components: []
        });
        return agreed;
    } catch (error) {
        if (
            error.code !== "InteractionCollectorError" ||
            !error.message.includes("reason: time")
        ) {
            throw error;
        }
        await response.edit({
            content: "⌛ DEFCON confirmation expired. No DEFCON action was taken.",
            components: []
        });
        return false;
    }
}

async function confirmMessage(message) {
    const { agreeId, cancelId, components } = buildConfirmationComponents(
        message.author.id,
        message.id
    );
    if (!message.client.activeDefconOwnerConfirmations) {
        message.client.activeDefconOwnerConfirmations = new Set();
    }
    message.client.activeDefconOwnerConfirmations.add(message.id);

    try {
        const response = await message.reply({
            content: OWNERSHIP_DEFCON_WARNING,
            components
        });
        return await waitForConfirmation(response, message.author.id, agreeId, cancelId);
    } finally {
        message.client.activeDefconOwnerConfirmations.delete(message.id);
    }
}

module.exports = {
    confirmMessage
};
