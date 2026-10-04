const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");

const ticketTopic = require("../ticket-topic");
const {
    ProgressFailure,
    createInteractionProgress
} = require("../utils/progress-embed");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("deny")
        .setDescription("Deny a commission ticket by ID.")
        .addIntegerOption(option =>
            option.setName("id")
                .setDescription("The commission ticket ID to deny")
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName("reason")
                .setDescription("Reason for denial")
                .setRequired(true)
        ),

    async execute(interaction, client, config) {
        const isAuthorized = config.commissionticketaccess?.some(roleId =>
            interaction.member?.roles?.cache?.has(roleId)
        );

        if (!isAuthorized) {
            return interaction.reply({
                content: "❌ You are not authorized to use `/deny`.",
                ephemeral: true
            });
        }

        // 🔒 GLOBAL LOCK CHECK
        if (config.locked) {
            return interaction.reply({
                content: "🚫 NorthGate OS is currently **locked**. Command `/deny` cannot be used.",
                flags: MessageFlags.Ephemeral
            });
        }

        const id = interaction.options.getInteger("id");
        const reason = interaction.options.getString("reason");

        const progress = createInteractionProgress(interaction, `Denying commission #${id}`, [
            "Find the commission ticket",
            "Find the ticket opener",
            "Post the denial in the ticket",
            "Notify the ticket opener by DM"
        ]);
        await progress.start();
        let ticketChannel;
        let user = null;
        try {
            await progress.runStep(0, async () => {
                ticketChannel = interaction.guild.channels.cache.find(ch =>
                    ch.name.startsWith(`commission-${id}`)
                );
                if (!ticketChannel) throw new ProgressFailure(`Commission ticket #${id} does not exist.`);
            });
            await progress.runStep(1, async () => {
                const { ownerId } = ticketTopic.parse(ticketChannel.topic);
                if (ownerId) user = await interaction.client.users.fetch(ownerId).catch(() => null);
            });
            await progress.runStep(2, () => ticketChannel.send({
                content: `❌ **Your commission has been denied.**\n**Reason:** ${reason}`
            }));
            if (user) {
                const dmSent = await progress.runStep(3, async () => {
                    try {
                        await user.send({
                            content: `❌ Your commission ticket (#${id}) has been **denied**.\n**Reason:** ${reason}`
                        });
                        return true;
                    } catch (error) {
                        console.warn(`[deny] Could not DM commission opener ${user.id}:`, error.message);
                        return false;
                    }
                });
                if (!dmSent) await progress.warnStep(3);
            } else {
                await progress.runStep(3, async () => {});
                await progress.warnStep(3);
            }

            await progress.complete(`❌ Commission ticket #${id} denied. A denial message has been posted in the ticket.`);
        } catch (error) {
            if (error instanceof ProgressFailure) return;
            throw error;
        }
    }
};
