const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    MessageFlags
} = require("discord.js");

const ticketTopic = require("../ticket-topic");
const {
    ProgressFailure,
    createInteractionProgress
} = require("../utils/progress-embed");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("approve")
        .setDescription("Approve a commission ticket by ID.")
        .addIntegerOption(option =>
            option.setName("id")
                .setDescription("The commission ticket ID to approve")
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName("commissioner")
                .setDescription("Person requesting the commission")
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName("payment")
                .setDescription("Payment agreed for the commission")
                .setRequired(true)
        )
        .addUserOption(option =>
            option.setName("developer_1")
                .setDescription("The main developers for the commission")
                .setRequired(true)
        )
        .addUserOption(option =>
            option.setName("supervisor")
                .setDescription("The supervisor for the commission")
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName("message")
                .setDescription("Optional approval message")
                .setRequired(false)
        )
        .addUserOption(option =>
            option.setName("developer_2")
                .setDescription("The main developers for the commission")
                .setRequired(false)
        )
        .addUserOption(option =>
            option.setName("developer_3")
                .setDescription("The main developers for the commission")
                .setRequired(false)
        )
        .addUserOption(option =>
            option.setName("developer_4")
                .setDescription("The main developers for the commission")
                .setRequired(false)
        )
        .addUserOption(option =>
            option.setName("developer_5")
                .setDescription("The main developers for the commission")
                .setRequired(false)
        ),

    async execute(interaction, client, config) {
        const isAuthorized = config.commissionticketaccess?.some(roleId =>
            interaction.member?.roles?.cache?.has(roleId)
        );

        if (!isAuthorized) {
            return interaction.reply({
                content: "❌ You are not authorized to use `/approve`.",
                ephemeral: true
            });
        }

        // 🔒 GLOBAL LOCK CHECK
        if (config.locked) {
            return interaction.reply({
                content: "🚫 NorthGate OS is currently **locked**. Command `/approve` cannot be used.",
                flags: MessageFlags.Ephemeral
            });
        }

        const id = interaction.options.getInteger("id");
        const commissioner = interaction.options.getString("commissioner");
        const payment = interaction.options.getString("payment");
        const message = interaction.options.getString("message") || "Your commission has been approved.";
        const developer1 = interaction.options.getUser("developer_1");
        const developer2 = interaction.options.getUser("developer_2") || "No second";
        const developer3 = interaction.options.getUser("developer_3") || "No third";
        const developer4 = interaction.options.getUser("developer_4") || "No fourth";
        const developer5 = interaction.options.getUser("developer_5") || "No fifth";
        const supervisor = interaction.options.getUser("supervisor");

        const progress = createInteractionProgress(interaction, `Approving commission #${id}`, [
            "Find the commission ticket",
            "Find the ticket opener",
            "Post the approval in the ticket",
            "Notify the ticket opener by DM",
            "Find and validate the active commissions forum",
            "Create the active commission thread"
        ]);
        await progress.start();
        let ticketChannel;
        let user = null;
        let activeCommissionsChannel;
        let thread;
        try {
            await progress.runStep(0, async () => {
                ticketChannel = interaction.guild.channels.cache.find(ch =>
                    ch.name.startsWith(`commission-${id}`)
                );
                if (!ticketChannel) throw new ProgressFailure(`Commission ticket #${id} does not exist.`);
            });
            let ownerId;
            await progress.runStep(1, async () => {
                ({ ownerId } = ticketTopic.parse(ticketChannel.topic));
                if (ownerId) user = await interaction.client.users.fetch(ownerId).catch(() => null);
            });
            await progress.runStep(2, () => ticketChannel.send({
                content: `✅ **Your commission has been accepted!**\n${message}`
            }));
            if (user) {
                const dmSent = await progress.runStep(3, async () => {
                    try {
                        await user.send({
                            content: `✅ Your commission ticket (#${id}) has been **approved**.\n${message}`
                        });
                        return true;
                    } catch (error) {
                        console.warn(`[approve] Could not DM commission opener ${user.id}:`, error.message);
                        return false;
                    }
                });
                if (!dmSent) await progress.warnStep(3);
            } else {
                await progress.runStep(3, async () => {});
                await progress.warnStep(3);
            }

        // -------------------------------------------------
        // RESOLVE ACTIVE COMMISSIONS CHANNEL
        // -------------------------------------------------
        const activeCommissionsChannelId =
            config?.channels?.activeCommissionsChannelId ??
            config?.channels?.activeCommissionsChannel ??
            config?.activeCommissionsChannelId ??
            config?.activeCommissionsChannel;

            await progress.runStep(4, async () => {
                activeCommissionsChannel = activeCommissionsChannelId
                    ? await interaction.guild.channels.fetch(activeCommissionsChannelId).catch(() => null)
                    : null;
                if (!activeCommissionsChannel) {
                    throw new ProgressFailure("Active commissions channel is missing from config or cannot be accessed.");
                }
                if (activeCommissionsChannel.type !== ChannelType.GuildForum) {
                    throw new ProgressFailure("Active commissions channel must be a forum channel.");
                }
            });

        // -------------------------------------------------
        // BUTTON ROW
        // -------------------------------------------------
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`commission_complete_${id}`)
                .setLabel("Complete")
                .setStyle(ButtonStyle.Success)
        );

        // -------------------------------------------------
        // CREATE FORUM THREAD WITH EMBED
        // -------------------------------------------------
            thread = await progress.runStep(5, () => activeCommissionsChannel.threads.create({
            name: `commission-${id}`,
            autoArchiveDuration: 10080,
            reason: "Commission approved",
            message: {
                content: `📝 **Commission #${id} is now active.**`,
                embeds: [
                    {
                        title: `Commission #${id} - ${commissioner}`,
                        color: 0x00ff00,
                        fields: [
                            { name: "Commissioner", value: `${commissioner}` },
                            { name: "Payment", value: payment },
                            { name: "Developers", value: `${developer1} | ${developer2} | ${developer3} | ${developer4} | ${developer5}` },
                            { name: "Supervisor", value: `${supervisor}` }
                        ]
                    }
                ],
                components: [row]
            }
            }));

        // -------------------------------------------------
        // CONFIRM TO STAFF
        // -------------------------------------------------
        // The ticket ID stays reserved: commission-<id>-<user> still exists, and
        // releasing it now would let a new ticket take the same number, giving two
        // channels one ID. /close frees it when the channel is actually deleted.
            await progress.complete(`✅ Commission ticket #${id} approved. ${thread}`);
        } catch (error) {
            if (error instanceof ProgressFailure) return;
            throw error;
        }
    }
};
