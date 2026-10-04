const { EmbedBuilder, MessageFlags } = require("discord.js");

class ProgressFailure extends Error {}

function createProgressTracker({ title, steps, send, edit }) {
    const completedSteps = new Set();
    const warningSteps = new Set();
    let activeStep = null;
    let failedStep = null;
    let failureMessage = null;
    let completionMessage = null;

    function buildEmbed() {
        const lines = steps.map((step, index) => {
            if (index === failedStep) return `❌ ${step}`;
            if (warningSteps.has(index)) return `⚠️ ${step}`;
            if (completedSteps.has(index)) return `✅ ${step}`;
            if (index === activeStep) return `🔄 ${step}`;
            return `⏳ ${step}`;
        });
        const description = [
            completionMessage,
            failureMessage,
            lines.join("\n")
        ].filter(Boolean).join("\n\n");

        return new EmbedBuilder()
            .setTitle(title)
            .setColor(failedStep !== null ? 0xe74c3c : completionMessage ? 0x2ecc71 : 0x3498db)
            .setDescription(description)
            .setFooter({
                text: failedStep !== null
                    ? `Stopped at step ${failedStep + 1} of ${steps.length}`
                    : completionMessage
                        ? `Completed ${steps.length} of ${steps.length} steps`
                        : `Step ${activeStep === null ? 0 : activeStep + 1} of ${steps.length}`
            })
            .setTimestamp();
    }

    async function refresh() {
        await edit({ embeds: [buildEmbed()] });
    }

    return {
        async start() {
            await send({ embeds: [buildEmbed()] });
        },

        async runStep(index, operation) {
            if (index !== completedSteps.size || index < 0 || index >= steps.length) {
                throw new Error(`Invalid progress step ${index} for "${title}".`);
            }

            activeStep = index;
            await refresh();

            let result;
            try {
                result = await operation();
            } catch (error) {
                failedStep = index;
                activeStep = null;
                failureMessage = error instanceof ProgressFailure
                    ? error.message
                    : "This step failed. Check the bot logs for details.";
                await refresh();
                throw error;
            }

            completedSteps.add(index);
            activeStep = null;
            return result;
        },

        async warnStep(index) {
            if (!completedSteps.has(index)) {
                throw new Error(`Cannot warn for unfinished progress step ${index} in "${title}".`);
            }
            warningSteps.add(index);
            await refresh();
        },

        async complete(message) {
            if (completedSteps.size !== steps.length) {
                throw new Error(`Cannot complete "${title}" before all steps finish.`);
            }
            completionMessage = message;
            await refresh();
        }
    };
}

function createInteractionProgress(interaction, title, steps) {
    return createProgressTracker({
        title,
        steps,
        send: payload => interaction.reply({
            ...payload,
            flags: MessageFlags.Ephemeral
        }),
        edit: payload => interaction.editReply(payload)
    });
}

function createMessageProgress(message, title, steps) {
    let progressMessage;
    const tracker = createProgressTracker({
        title,
        steps,
        send: async payload => {
            progressMessage = await message.reply(payload);
        },
        edit: payload => progressMessage.edit(payload)
    });
    tracker.getMessage = () => progressMessage;
    return tracker;
}

module.exports = {
    ProgressFailure,
    createInteractionProgress,
    createMessageProgress
};
