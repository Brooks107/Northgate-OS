const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    ChannelType,
    PermissionFlagsBits,
    ButtonBuilder,
    ButtonStyle,
    AttachmentBuilder,
    MessageFlags,
    OverwriteType
} = require("discord.js");

const ticketTopic = require("../ticket-topic");
const ticketTracker = require("../ticket-tracker");

module.exports = {
    async execute(interaction, client, config) {

        // -------------------------------------------------
        // HIRING BUTTON → OPEN MODAL
        // -------------------------------------------------
        if (interaction.isButton() && interaction.customId === "ticket_hire") {
            const modal = new ModalBuilder()
                .setCustomId("modal_ticket_hire")
                .setTitle("Hiring Request");

            const nameInput = new TextInputBuilder()
                .setCustomId("applicant_name")
                .setLabel("What is your name?")
                .setStyle(TextInputStyle.Short)
                .setMaxLength(50)
                .setRequired(true);

            const robloxid = new TextInputBuilder()
                .setCustomId("roblox_id")
                .setLabel("What is your roblox ID?")
                .setPlaceholder("Numbers only, for example 123456789")
                .setStyle(TextInputStyle.Short)
                .setMaxLength(20)
                .setRequired(true);
    
            
            const roleInput = new TextInputBuilder()
                .setCustomId("job_role")
                .setLabel("Which role are you applying for?")
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const experienceInput = new TextInputBuilder()
                .setCustomId("experience")
                .setLabel("Tell us about your experience")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);

            const whyInput = new TextInputBuilder()
                .setCustomId("why_join")
                .setLabel("Why do you want to work with us?")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);

            return interaction.showModal(
                modal.addComponents(
                    new ActionRowBuilder().addComponents(nameInput),
                    new ActionRowBuilder().addComponents(robloxid),
                    new ActionRowBuilder().addComponents(roleInput),
                    new ActionRowBuilder().addComponents(experienceInput),
                    new ActionRowBuilder().addComponents(whyInput)
                )
            );
        }

        // -------------------------------------------------
        // CLAIM BUTTON
        // -------------------------------------------------
        if (
            interaction.isButton() &&
            (interaction.customId === "ticket_claim" || interaction.customId === "hiring_claim")
        ) {
            const isStaff = (config.hiringticketaccess || []).some(roleId =>
                interaction.member?.roles?.cache?.has(roleId)
            );

            if (!isStaff) {
                return interaction.reply({
                    content: "❌ Only staff can claim this ticket.",
                    flags: MessageFlags.Ephemeral
                });
            }

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const message = interaction.message;

            const newRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("hiring_claim")
                    .setLabel(`Claimed by ${interaction.user.username}`)
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(true),

                new ButtonBuilder()
                    .setCustomId("hiring_close")
                    .setLabel("🔒 Close Ticket")
                    .setStyle(ButtonStyle.Danger)
            );

            await message.edit({ components: [newRow] });
            const ticketState = ticketTopic.parse(interaction.channel.topic);
            await interaction.channel.setTopic(ticketTopic.build({
                ownerId: ticketState.ownerId,
                claimedBy: interaction.user.id
            }));
            await ticketTracker.syncTicket(interaction.channel, {
                type: "claimed",
                status: `🟡 Claimed by ${interaction.user.tag}`,
                userId: interaction.user.id
            });

            return interaction.editReply("📝 You have claimed this ticket.");
        }

        // -------------------------------------------------
        // HIRING MODAL → CREATE TICKET
        // -------------------------------------------------
        if (interaction.isModalSubmit() && interaction.customId === "modal_ticket_hire") {
            const categoryId = config.hiringticketcategory || config.reportsticketcategory || config.generalticketcategory;
            const prefix = "hiring";
            client.refreshActiveTicketIds(interaction.guild);
            const ticketId = client.getNextTicketId();

            if (!ticketId) {
                return interaction.reply({
                    content: "❌ All 20 ticket slots are currently in use. Please wait for a ticket to close.",
                    flags: MessageFlags.Ephemeral
                });
            }

            client.activeTicketIds.add(ticketId);

            const applicantName = interaction.fields.getTextInputValue("applicant_name");
            const jobRole = interaction.fields.getTextInputValue("job_role");
            const experience = interaction.fields.getTextInputValue("experience");
            const whyJoin = interaction.fields.getTextInputValue("why_join");
            const robloxId = interaction.fields.getTextInputValue("roblox_id");

            // NorthGate Studios Staff Management reads the bc!hire line sent below, and
            // posts the welcome in this ticket when staff run /hire, so it has to be
            // able to see the ticket. Only added when that bot is really in this
            // server: an overwrite for someone who is not would stop the ticket being
            // created at all.
            const staffBotId = String(config.staffmanagerbotid || "");
            const staffBot = /^\d{17,20}$/.test(staffBotId)
                ? await interaction.guild.members.fetch(staffBotId).catch(() => null)
                : null;

            let ticketChannel;

            try {
                const visibleRoleIds = config.hiringticketaccess || [];

                ticketChannel = await interaction.guild.channels.create({
                    name: `${prefix}-${ticketId}`,
                    type: ChannelType.GuildText,
                    parent: categoryId,
                    topic: ticketTopic.build({ ownerId: interaction.user.id }),
                    permissionOverwrites: [
                        { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                        {
                            id: interaction.user.id,
                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.SendMessages,
                                PermissionFlagsBits.ReadMessageHistory
                            ]
                        },
                        ...[...new Set(visibleRoleIds)].map(roleId => ({
                            id: roleId,
                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.SendMessages,
                                PermissionFlagsBits.ReadMessageHistory
                            ]
                        })),
                        {
                            id: client.user.id,
                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.SendMessages,
                                PermissionFlagsBits.ReadMessageHistory,
                                PermissionFlagsBits.ManageChannels
                            ]
                        },
                        ...(staffBot ? [{
                            id: staffBot.id,
                            type: OverwriteType.Member,
                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.SendMessages,
                                PermissionFlagsBits.ReadMessageHistory,
                                PermissionFlagsBits.EmbedLinks,
                                PermissionFlagsBits.AddReactions
                            ]
                        }] : [])
                    ]
                });
            } catch (err) {
                client.activeTicketIds.delete(ticketId);
                throw err;
            }

            const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("hiring_claim")
                    .setLabel("📝 Claim Ticket")
                    .setStyle(ButtonStyle.Primary),

                new ButtonBuilder()
                    .setCustomId("hiring_close")
                    .setLabel("🔒 Close Ticket")
                    .setStyle(ButtonStyle.Danger)
            );

            await ticketChannel.send({
                content: "<@&1538588862148771910> <@&1535764413422899210> <@&1536398794240041050> <@&1536398792520372404>",
                allowedMentions: { roles: ["1538588862148771910", "1535764413422899210", "1536398794240041050", "1536398792520372404"] },
                embeds: [
                    {
                        title: `🧑‍💼 Hiring Ticket #${ticketId}`,
                        description: "A new hiring application has been created.",
                        color: 0x2ecc71,
                        fields: [
                            { name: "👤 Applicant", value: interaction.user.tag, inline: true },
                            { name: "📛 Name", value: applicantName, inline: true },
                            { name: "⚙️ Roblox ID", value: robloxId, inline: true },
                            { name: "🎯 Role", value: jobRole, inline: true },
                            { name: "🧠 Experience", value: experience },
                            { name: "💡 Why join?", value: whyJoin }
                        ]
                    }
                ],
                components: [buttons]
            });

            // Hand the applicant's details to Staff Management, which fills them in
            // when staff run /hire in this ticket after the interview.
            await sendHireDetails(ticketChannel, interaction.user.id, applicantName, robloxId);

            // Create tracking embed
            await ticketTracker.createTicketEmbed(ticketChannel, {
                id: ticketId,
                title: "Hiring Application",
                userId: interaction.user.id,
                description: `Role: ${jobRole}, Experience: ${experience}`,
                createdAt: new Date().toLocaleString()
            }, client, config);

            return interaction.reply({
                content: `✅ Your hiring ticket (#${ticketId}) has been created: <#${ticketChannel.id}>`,
                flags: MessageFlags.Ephemeral
            });
        }

        // -------------------------------------------------
        // HIRING CLOSE BUTTON → TRANSCRIPT + FREE ID + SAFE DELETE
        // -------------------------------------------------
        if (
            interaction.isButton() &&
            (interaction.customId === "hiring_close" || interaction.customId === "ticket_close")
        ) {
            const channel = interaction.channel;
            const match = channel.name.match(/^hiring-(\d+)(?:-|$)/);
            if (match) {
                const id = parseInt(match[1]);
                client.activeTicketIds.delete(id);
            }

            await interaction.reply({
                content: "🔒 Ticket closed. Saving transcript...",
                flags: MessageFlags.Ephemeral
            });

            await saveTranscript(channel, interaction.user, config);

            // Remove from tracker
            await ticketTracker.removeTracking(channel);

            setTimeout(() => {
                interaction.guild.channels.delete(channel.id).catch(() => {});
            }, 3000);
        }
    }
};

// "bc" is bot communication: a line one NorthGate bot posts for another to read.
//
//   bc!hire <Discord ID> <nickname> <Roblox ID>
//
// NorthGate Studios Staff Management only listens to this bot (set there with
// /config ticket_bot), remembers the details for this ticket, and uses them when
// staff run /hire here. It only accepts a Roblox ID made of digits and a nickname
// of up to 50 characters, so details that would be rejected are not sent. Staff
// are told instead, and fill them in on /hire themselves.
async function sendHireDetails(channel, discordId, name, robloxId) {
    const nickname = String(name ?? "").trim().replace(/\s+/g, " ");
    const roblox = String(robloxId ?? "").trim();

    const problems = [];
    if (!/^\d{1,20}$/.test(roblox)) problems.push("the Roblox ID is not a number");
    if (!nickname || nickname.length > 50) problems.push("the name is empty or longer than 50 characters");

    try {
        if (problems.length) {
            await channel.send({
                content: `ℹ️ These hiring details were not passed to Staff Management because ${problems.join(" and ")}. When hiring, run /hire with user, nickname and roblox_id filled in.`,
                allowedMentions: { parse: [] }
            });
            return false;
        }

        // The name is whatever the applicant typed, so nothing in it may ping.
        await channel.send({
            content: `bc!hire ${discordId} ${nickname} ${roblox}`,
            allowedMentions: { parse: [] }
        });
        return true;
    } catch (err) {
        console.error("[bc] could not send the hiring details:", err.message);
        return false;
    }
}

async function saveTranscript(channel, closedBy, config) {
    try {
        const all = [];
        let lastId = null;

        while (true) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;

            const batch = await channel.messages.fetch(options);
            if (batch.size === 0) break;

            all.push(...batch.values());
            lastId = batch.last().id;
        }

        const messages = all.reverse();

        const lines = [];
        lines.push(`Transcript for #${channel.name}`);
        lines.push(`Closed by: ${closedBy.tag}`);
        lines.push(`Saved: ${new Date().toLocaleString()}`);
        lines.push(`Messages: ${messages.length}`);
        lines.push("=".repeat(50));
        lines.push("");

        for (const msg of messages) {
            const time = msg.createdAt.toLocaleString();
            lines.push(`[${time}] ${msg.author.tag}: ${msg.content || "(no text)"}`);

            for (const att of msg.attachments.values()) {
                lines.push(`    [file] ${att.name}: ${att.url}`);
            }
            for (const emb of msg.embeds) {
                lines.push(`    [embed] ${emb.title || ""} ${emb.description || ""}`);
            }
        }

        const file = new AttachmentBuilder(
            Buffer.from(lines.join("\n"), "utf-8"),
            { name: `${channel.name}-transcript.txt` }
        );

        const transcriptChannelId = config?.channels?.transcriptschannelid || config?.transcriptschannelid;
        const logChannel = transcriptChannelId
            ? await channel.guild.channels.fetch(transcriptChannelId).catch(() => null)
            : null;

        if (!logChannel) {
            console.error("Transcript failed: transcriptschannelid is wrong or the bot can't see that channel.");
            return;
        }

        await logChannel.send({
            content: `📄 Transcript for **${channel.name}** (closed by ${closedBy.tag})`,
            files: [file],
            allowedMentions: { parse: [] }
        });

    } catch (err) {
        console.error("Transcript failed:", err);
    }
}
