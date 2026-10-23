const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const ticketTopic = require("../ticket-topic");
const ticketTracker = require("../ticket-tracker");
const { logCommand } = require("../utils/command-logger");
const { buildHelpEmbeds, packIntoMessages } = require("../utils/help");
const {
    ProgressFailure,
    createMessageProgress
} = require("../utils/progress-embed");

// !help sends one embed per NorthGate bot. The command tables live in
// ../utils/help, which is also where a new command has to be added.
async function sendPrivateHelp(message) {
    const messages = packIntoMessages(buildHelpEmbeds(message.client));

    await message.delete().catch(() => {});
    try {
        for (const embeds of messages) await message.author.send({ embeds });
    } catch (error) {
        console.error("[help] could not send private command help:", error);
        const fallback = await message.channel.send({
            content: "❌ I could not DM you the command list. Please turn on direct messages from server members and try `!help` again.",
            allowedMentions: { users: [] }
        });
        setTimeout(() => fallback.delete().catch(() => {}), 10_000);
    }
}

module.exports = async function handlePrefixCommand(message, config) {
    if (message.author.bot) return;

    if (message.content.trim().toLowerCase() === "!help") {
        await logCommand(message, config, "!help", "Prefix command", []);
        await sendPrivateHelp(message);
        return;
    }

    if (
        config.maintenanceMode &&
        (message.content.startsWith("!msg") || message.content.startsWith("d!") || message.content.startsWith("n!")) &&
        !config.developers?.includes(message.author.id)
    ) {
        await message.reply("🔴 The bot is currently offline for maintenance.");
        return;
    }

    if (message.channel.isDMBased?.() && message.content.startsWith("!msg")) {
        const match = message.content.match(/^!msg\s+(\d+)\s+([\s\S]+)$/);
        if (!match) {
            return message.reply("❌ Usage: `!msg <channel id> <message>`");
        }

        await logCommand(message, config, "!msg", "Developer DM command", [match[1], match[2].trim()]);

        if (!config.developers?.includes(message.author.id)) {
            return message.reply("❌ Only developers can use this command.");
        }

        const progress = createMessageProgress(message, "Sending developer message", [
            "Find the destination text channel",
            "Send the message"
        ]);
        await progress.start();

        let channel;
        try {
            await progress.runStep(0, async () => {
                channel = await message.client.channels.fetch(match[1]).catch(() => null);
                if (!channel?.isTextBased?.() || typeof channel.send !== "function") {
                    throw new ProgressFailure("I could not find a text channel with that ID or I cannot send messages there.");
                }
            });
            await progress.runStep(1, async () => {
                try {
                    await channel.send(match[2].trim());
                } catch (error) {
                    console.error("[msg] failed to send message from DM:", error);
                    throw new ProgressFailure("I could not send a message in that channel. Check my channel permissions.");
                }
            });
            await progress.complete(`✅ Message sent to <#${channel.id}>.`);
        } catch (error) {
            if (error instanceof ProgressFailure) return;
            console.error("[msg] progress update failed:", error);
            return;
        }
    }

    // --- Developer Prefix (d!) ---
    if (message.content.startsWith("d!")) {
        const args = message.content.slice(2).trim().split(/ +/);
        const command = args.shift()?.toLowerCase();

        if (command === "forceclaim") {
            await logCommand(message, config, `d!${command}`, "Developer command", args);

            if (!config.developers?.includes(message.author.id)) {
                return message.reply("❌ Only developers can run this command - It is used to fix claiming issues and override any problems by forcing claim onto the author of the command");
            }

            const id = Number(args[0]);
            if (!Number.isInteger(id) || id < 1) {
                return message.reply("❌ Please provide a valid ticket ID: `d!forceclaim <id>`");
            }

            const progress = createMessageProgress(message, `Force-claiming ticket #${id}`, [
                "Find the ticket channel",
                "Find the ticket control message",
                "Update the ticket claim button",
                "Save the ticket claim"
            ]);
            await progress.start();

            let ticketChannel;
            let ticketMessage;
            try {
                await progress.runStep(0, async () => {
                    ticketChannel = message.guild?.channels.cache.find(channel =>
                        ["support", "appeal", "hiring", "partnership", "interrogation"]
                            .some(prefix => channel.name.startsWith(`${prefix}-${id}`))
                    );
                    if (!ticketChannel) throw new ProgressFailure(`Ticket #${id} does not exist.`);
                });
                await progress.runStep(1, async () => {
                    const initialMessages = await ticketChannel.messages.fetch({
                        after: ticketChannel.id,
                        limit: 10
                    }).catch(() => null);
                    ticketMessage = initialMessages?.find(m =>
                        m.author.id === message.client.user.id && m.components.length > 0
                    ) || initialMessages?.find(m => m.author.id === message.client.user.id);
                    if (!ticketMessage) {
                        throw new ProgressFailure(`Could not find the original ticket control message in ${ticketChannel}.`);
                    }
                });

                const isInterrogationTicket = ticketChannel.name.startsWith(`interrogation-${id}`);

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`ticket_claimed_${message.author.id}`)
                        .setLabel(`🙋‍♂️ Claimed by ${message.author.displayName || message.author.username}`)
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId(isInterrogationTicket ? "intero_close" : "ticket_close")
                        .setLabel("🔒 Close Ticket")
                        .setStyle(ButtonStyle.Danger)
                );

                await progress.runStep(2, () => ticketMessage.edit({ components: [row] }));

                await progress.runStep(3, async () => {
                    if (ticketTopic && typeof ticketTopic.parse === "function") {
                        const { ownerId } = ticketTopic.parse(ticketChannel.topic || "");
                        await ticketChannel.setTopic(ticketTopic.build({ ownerId, claimedBy: message.author.id }));
                    }
                });
                await progress.complete(`📝 You have force claimed ticket #${id}.`);
            } catch (error) {
                if (error instanceof ProgressFailure) return true;
                console.error(`[forceclaim] failed for ticket #${id}:`, error);
            }
            return true;
        }

        return;
    }

    // --- Main Prefix (n!) ---
    const prefix = "n!";
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();
    const recognizedCommands = new Set(["ping", "purge", "links", "rules", "inject", "sub"]);

    if (recognizedCommands.has(command)) {
        await logCommand(message, config, `n!${command}`, "Prefix command", args);
    }

    if (command === "inject") {
        const ticketId = Number(args.shift());
        const info = args.join(" ");

        if (!Number.isInteger(ticketId) || ticketId < 1) {
            return message.reply("❌ Usage: `n!inject <ticket id> <info>`");
        }

        const isStaff = config.supportTeamRoles?.some(roleId =>
            message.member?.roles?.cache?.has(roleId)
        ) || config.developers?.includes(message.author.id);

        if (!isStaff) {
            return message.reply({ content: "❌ Only staff can inject info into a ticket." });
        }

        if (!info) {
            return message.reply({ content: "❌ Please provide info to inject: `n!inject <ticket id> <info>`" });
        }

        const ticketChannel = message.guild?.channels.cache.find(channel =>
            channel.name === `support-${ticketId}` ||
            channel.name === `appeal-${ticketId}` ||
            channel.name === `hiring-${ticketId}` ||
            channel.name === `partnership-${ticketId}` ||
            channel.name === `interrogation-${ticketId}`
        );

        if (!ticketChannel) {
            return message.reply(`❌ Ticket #${ticketId} does not exist in this server.`);
        }

        const progress = createMessageProgress(message, `Injecting information into ${ticketChannel.name}`, [
            "Fetch the ticket tracker entry",
            "Update the tracker embed",
            "Save the updated tracker entry",
            "Confirm the update"
        ]);
        await progress.start();
        const result = await ticketTracker.injectInfo(ticketChannel, info, message.client, progress);
        if (!result.success) {
            await progress.stopWithFailure(result.error);
            return;
        }

        await progress.runStep(3, () => message.react("✅"));
        await progress.complete("Your info has been loaded into the ticket tracker and archived.");
        console.log(`[inject] ${message.author.tag} injected info into ${ticketChannel.name}`);
        return;
    }

    if (command === "sub") {
        const ticketId = Number(args.shift());
        const noteId = Number(args.shift());
        const note = args.join(" ").trim();

        if (!Number.isInteger(ticketId) || ticketId < 1 || !Number.isInteger(noteId) || noteId < 1) {
            return message.reply("❌ Usage: `n!sub <ticket id> <note id> <message>` (leave message blank to delete)");
        }

        const isStaff = config.supportTeamRoles?.some(roleId =>
            message.member?.roles?.cache?.has(roleId)
        ) || config.developers?.includes(message.author.id);

        if (!isStaff) {
            return message.reply({ content: "❌ Only staff can substitute notes in a ticket." });
        }

        const ticketChannel = message.guild?.channels.cache.find(channel =>
            channel.name === `support-${ticketId}` ||
            channel.name === `appeal-${ticketId}` ||
            channel.name === `hiring-${ticketId}` ||
            channel.name === `partnership-${ticketId}` ||
            channel.name === `interrogation-${ticketId}`
        );

        if (!ticketChannel) {
            return message.reply(`❌ Ticket #${ticketId} does not exist in this server.`);
        }

        const progress = createMessageProgress(message, `${note ? "Updating" : "Deleting"} ticket note #${noteId}`, [
            "Fetch the ticket tracker entry",
            "Update the tracker embed",
            "Save the updated tracker entry",
            "Confirm the update"
        ]);
        await progress.start();
        const result = await ticketTracker.substituteNote(ticketChannel, noteId, note, message.client, progress);
        if (!result.success) {
            await progress.stopWithFailure(result.error);
            return;
        }

        await progress.runStep(3, () => message.react("✅"));
        await progress.complete(`Ticket note #${noteId} ${note ? "updated" : "deleted"}.`);
        console.log(`[sub] ${message.author.tag} ${note ? "updated" : "deleted"} note ${noteId} in ${ticketChannel.name}`);
        return;
    }

    if (command === "ping") {
        const latency = Date.now() - message.createdTimestamp;
        const embed = new EmbedBuilder()
            .setColor(0x3498db)
            .setTitle("🏓 Pong!")
            .setDescription(`Latency: **${latency}ms**`)
            .setTimestamp();
        await message.reply({ embeds: [embed] });
        return;
    }

    if (command === "purge") {
        if (!message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return message.reply("❌ You need the **Manage Messages** permission to use this command.");
        }

        const amount = parseInt(args[0]);
        if (!amount || amount < 1 || amount > 100) {
            return message.reply("Please provide a number between **1** and **100**.");
        }

        const progress = createMessageProgress(message, "Purging messages", [
            "Remove the purge command",
            `Fetch up to ${amount} recent messages`,
            "Delete the fetched messages"
        ]);
        await progress.start();

        let deletedCount = 0;
        try {
            await progress.runStep(0, async () => {
                try {
                    await message.delete();
                } catch (error) {
                    console.warn("[purge] could not delete the invoking command:", error.message);
                }
            });

            let messages;
            await progress.runStep(1, async () => {
                messages = await message.channel.messages.fetch({ limit: amount });
            });

            await progress.runStep(2, async () => {
                const progressMessageId = progress.getMessage().id;
                const purgeableMessages = messages.filter(item => item.id !== progressMessageId);
                if (purgeableMessages.size > 0) {
                    const deleted = await message.channel.bulkDelete(purgeableMessages, true);
                    deletedCount = deleted.size;
                }
            });
            await progress.complete(`🧹 Deleted **${deletedCount}** messages.`);
            setTimeout(() => {
                progress.getMessage().delete().catch(error => {
                    console.warn("[purge] could not remove the progress message:", error.message);
                });
            }, 3000);
        } catch (error) {
            console.error("[purge] failed to remove messages:", error);
        }
        return;
    }

    if (command === "links") {
        if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply("❌ Only administrators can use this command.");
        }

        const progress = createMessageProgress(message, "Posting the links embed", [
            "Find the configured links channel",
            "Post the portfolio links"
        ]);
        await progress.start();

        let linksChannel;
        try {
            await progress.runStep(0, async () => {
                const linksChannelId = (
                    config.channels?.linkschannel?.id ??
                    config.channels?.linkschannelid ??
                    config.channels?.linksChannelId ??
                    config.linksChannelId ??
                    config.linkschannelid
                );

                if (!linksChannelId || !/^[0-9]+$/.test(String(linksChannelId))) {
                    throw new ProgressFailure("The links channel is not configured yet.");
                }

                linksChannel = await message.guild?.channels.fetch(linksChannelId).catch(() => null);
                if (!linksChannel || !linksChannel.isTextBased?.()) {
                    throw new ProgressFailure("The configured links channel is invalid or not accessible.");
                }
            });
        } catch (error) {
            if (error instanceof ProgressFailure) return;
            console.error("[links] failed to find the configured channel:", error);
            return;
        }

        const embed = {
            title: "Northgate Studios Portfolio",
            description: "Below you can find our official links to our projects, website, social media platforms and more.",
            color: 0x00ff00,
            image: {
                url: "https://media.discordapp.net/attachments/1444636404801081448/1535285319123861534/Pixelated_Animated_Nostalgic_90s_Illustrations_Discord_Profile_Banner_13.gif?ex=6a98d3a0&is=6a978220&hm=ce2bb40a5d10ad11b9ec19aa3f0ba9a205639cbc6a95f8ef7b7f684111c81275&"
            },
            footer: {
                text: "Created by Brooks | Powered By Vortigern Industries"
            },
            fields: [
                {
                    name: "Our Website",
                    value: "[Our Website](https://northgate-studios.com/)"
                },
                {
                    name: "Our Website Status Page",
                    value: "[Status Page](https://status.vortigernindustries.com)"
                },
                {
                    name: "SPONSORS",
                    value: "[Vortigern Industries](https://discord.gg/XHZJ9qjs2B)"
                },
                {
                    name: "Our Youtube",
                    value: "[Northgate Studios](https://www.youtube.com/@NorthGate.Studios)"
                },
                {
                    name: "Our Roblox Group",
                    value: "[Northgate Studios](https://www.roblox.com/communities/33030494/NORTHGATE-Studios#!/about)"
                }
            ]
        };

        try {
            await progress.runStep(1, async () => {
                try {
                    await linksChannel.send({ embeds: [embed] });
                } catch (error) {
                    console.error("[links] failed to send links embed:", error);
                    throw new ProgressFailure("I cannot send the links embed in that channel. Check channel permissions.");
                }
            });
            await progress.complete(`✅ Links embed posted in ${linksChannel}.`);
        } catch (error) {
            if (error instanceof ProgressFailure) return;
            console.error("[links] progress update failed:", error);
        }

        return;
    }
    if (command === "ticketrules") {
        if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply("❌ Only Administrators can use this command")
        }
        
        const embed = {
            title: "Northgate Studios Ticket Regulations",
            description: [
                "**NOTICE**",
                "",
                "By opening a NGC ticket using the <@1536279872127762492> ticket system, you consent to the storage of your data in our tracking channels and the retention of that data in our ticket archive stored in our systems - This information stored will only be accessible to all staff throughout the time your ticket is open. After closure only <@1259124148798754907> and <@1410407078643765340> may go back and look at the full archive. Please DM them to request any erasures.",
                "",
                `Northgate Studios reserves the right to close, deny or otherwise turn down service towards any ticket opener at NGC with, or without notice. Including but not limited to: "Partnerships", "Hiring" and "Appeals"`,
                "",
            ].join("\n"),
            image: {
                url: "https://media.discordapp.net/attachments/1292046260261621851/1365439251545591888/NGC_poster-1.gif?width=400&height=225&ex=6abe27a6&is=6abcd626&hm=0b40ae378e158dfb4cc9f0fa3ea1b944f1dcb8294f64477aa56434696ee1c078&",
            },
            footer: {
                text: "Official ticket regulations | Created by Brooks | Powered by Vortigern Industries"
            },
            fields: [
                {
                    name: "Informational Technology Team",
                    value: "Throughout the course of your ticket you **may** see IT members interacting with your ticket and running commands, please know this is not affecting the outcome of whatever ticket type you have open and we're just ensuring the integrity of our systems. IT Members may also decide to handle very small scale incidents to take some of the weight off the shoulders of the Upper Management and Support Team.",
                },
                {
                    name: "No ticket spamming",
                    value: "If you come to the unfortunate conclusion your ticket has been closed and you haven't gained the result you were looking for, please do not immediately re-open a new ticket trying again.",
                },
                {
                    name: "Inactivity",
                    value: "If a ticket goes inactive for longer than 24 hours, a warning will be posted inside the chat by a support member - If 24 hours passes and this still hasn't been replied to then the ticket will be closed.",
                },
                {
                    name: "General Etiquette",
                    value: "Please have common sense when opening a ticket. Support Staff cannot be active 24/7 and may have some delays between replies, therefore please do not repeatedly tag and harass members of staff to reply to your ticket. Please keep all conversations within the ticket to a respectful manner, we at NGC want the best for our community and ask you to be polite and respectful."
                },
                {
                    name: "Confidentiality",
                    value: "Any conversions that happen within a ticket are confidential and restricted to you and the members of staff who have access - Please ask permission before sending external entities screenshots or forwarding messages. This is for the privacy and safety of our staff and any users who may be involved in any ongoing situation.",
                },
                {
                    name: "Enforcement",
                    value: "The above policies will be enforced at all times, regardless of whether you have read them or not. Not reading rules is not an excuse for misconduct and will be met equally as harshly as someone who has read the rules."
                    
                }
            ]
        };
        try {
            await message.channel.send({ embeds: [embed] });
        } catch (err) {
            console.error("[rules] failed to send rules embed:", err);
            return message.reply("❌ I cannot send the rules embed in that channel. Check channel permissions.");
        }
    
    }
    if (command === "rules") {
        if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply("❌ Only administrators can use this command.");
        }

        const progress = createMessageProgress(message, "Posting the rules embed", [
            "Find the configured rules channel",
            "Post the server rules"
        ]);
        await progress.start();

        let rulesChannel;
        try {
            await progress.runStep(0, async () => {
                const rulesChannelId = (
                    config.channels?.ruleschannel?.id ??
                    config.channels?.ruleschannelid ??
                    config.channels?.rulesChannelId ??
                    config.rulesChannelId ??
                    config.ruleschannelid
                );

                if (!rulesChannelId || !/^[0-9]+$/.test(String(rulesChannelId))) {
                    throw new ProgressFailure("The rules channel is not configured yet.");
                }

                rulesChannel = await message.guild?.channels.fetch(rulesChannelId).catch(() => null);
                if (!rulesChannel || !rulesChannel.isTextBased?.()) {
                    throw new ProgressFailure("The configured rules channel is invalid or not accessible.");
                }
            });
        } catch (error) {
            if (error instanceof ProgressFailure) return;
            console.error("[rules] failed to find the configured channel:", error);
            return;
        }

        const embed = {
            title: "Northgate Studios Rules",
            description: [
                "**NOTICE**",
                "",
                "By joining any Northgate Studios server, project, game, or community, you agree to follow all rules, policies, and staff decisions enforced by Northgate.",
                "",
                "These policies take effect across all Northgate Studios' projects.",
                "",
                "Northgate Studios reserves the right to warn, kick, remove, suspend, ban, or otherwise take administrative action against any community of staff member at any time with or without notice, for any reason deemed appropriate by staff members of ownership.",
                "",
                "",
                "---------------------------------------------------"
            ].join("\n"),
            image: {
                url: "https://cdn.discordapp.com/attachments/1172091235461238815/1518658520948408330/Copy_of_Studio_intro.gif?ex=6a98fbb6&is=6a97aa36&hm=e642fd4324eeb9a807652e1e1f6684b562058aec310c6c8bedf367267d3d81c9&"
            },
            footer: {
                text: "Created by Casper | Powered By Vortigern Industries"
            },
            fields: [
                {
                    name: "Be respectful.",
                    value: "This means no derogatory, rude, or harassing comments. Treat others as you want to be treated."
                },
                {
                    name: "No inappropriate language.",
                    value: "Keep profanity to a reasonable minimum. Any derogatory language directed at any user is prohibited. Swearing is permitted only in casual channels, while profanity should be avoided in all other channels."
                },
                {
                    name: "No spamming.",
                    value: "Do not send a series of small messages one after another. These interupt the chat and can make it difficult to scroll through the server. Please keep your messages to atleast 5 words long while chatting unless the situation is deemed appropriate by staff."
                },
                {
                    name: "No pornographic, explicit or adult content",
                    value: "Under no circumstances should any member of this server including staff members post pornographic, explicit or adult content. Here at Northgate we stride to provide a safe community for our members and younger users here at Northgate."
                },
                {
                    name: "No advertising.",
                    value: "Do not send invasive or unsolicited advertisements Whether it is other communities or streams, you can post your content in the media channel if it is relevant, follows all rules and is beneficial to the community. If you are unsure, please ask a staff member before posting."
                },
                {
                    name: "Do not share personally identifiable information (PII).",
                    value: "Do not share any personally identifiable information (PII) about yourself or others, including but not limited to addresses, phone numbers, email addresses, and social security numbers and other private information."
                },
                {
                    name: "Avoid any misleading or false information.",
                    value: "Please check the authenticity of any information before sharing it around our community, and only share from reliable and trusted sources, False or misleading information can be harmful, undermining trust and integrity between members of the community. If you are unsure, please ask a staff member before sharing."
                },
                {
                    name: "Follow the per-channel instructions.",
                    value: "Each channel on the server has its own set of rules about what kind of content is permitted. Please follow these guidelines and understand the purpose of each channel."
                },
                {
                    name: "Follow Discord's Terms of Service and Community Guidelines.",
                    value: "All members of this server must follow Discord's Terms of Service and Community Guidelines. Any violation of these rules may result in disciplinary action, including but not limited to warnings, temporary or permanent bans from the server, or legal action if necessary."
                },
                {
                    name: "Do not share or distribute hacks, cheats, or other unauthorized tools or services.",
                    value: "The server strictly prohibits the sharing or distribution of hacks, cheats, or other unauthorized tools or services."
                },
                {
                    name: "Do not share or distribute viruses or malicious software.",
                    value: "The server strictly prohibits the sharing or distribution of viruses or malicious software."
                },
                {
                    name: "Do not impersonate other users or staff members or any other organisation.",
                    value: "This includes but is not limited to using similar usernames, profile pictures, or other identifying information to mislead others into thinking you are someone else. Impersonation can cause confusion and harm to the community and is strictly prohibited."
                },
                {
                    name: "Do not abuse server bots or other automated systems.",
                    value: "Do not attempt to bypass, exploit or otherwise misuse our server bots - Especially our custom bots, spamming commands, features or constantly triggering automod responses can crash the bot and any other bots ran on the hosting service, distrupting bots for multiple different organisations throughout SCP:RP and Vortigern Industries."
                },
                {
                    name: "Do not engage in any illegal activities.",
                    value: [
                        "This includes but is not limited to sharing or distributing illegal content, engaging in illegal activities, or promoting illegal activities. Any illegal activities will be reported to the appropriate authorities and may result in legal action.",
                        "",
                        "",
                        "TL:DR",
                        "Have Common Sense",
                        ""
                    ].join("\n")
                }
            ]
        };

        try {
            await progress.runStep(1, async () => {
                try {
                    await rulesChannel.send({ embeds: [embed] });
                } catch (error) {
                    console.error("[rules] failed to send rules embed:", error);
                    throw new ProgressFailure("I cannot send the rules embed in that channel. Check channel permissions.");
                }
            });
            await progress.complete(`✅ Rules embed posted in ${rulesChannel}.`);
        } catch (error) {
            if (error instanceof ProgressFailure) return;
            console.error("[rules] progress update failed:", error);
        }
    }
};