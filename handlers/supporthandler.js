const {
      ModalBuilder,
      TextInputBuilder,
      TextInputStyle,
      ActionRowBuilder,
      ChannelType,
      PermissionFlagsBits,
      ButtonBuilder,
      ButtonStyle,
      AttachmentBuilder
  } = require("discord.js");

  module.exports = {
      async execute(interaction, client, config) {

          // -------------------------------------------------
          // SUPPORT BUTTONS → OPEN MODAL
          // -------------------------------------------------
          if (
              interaction.isButton() &&
              (interaction.customId === "ticket_support" ||
               interaction.customId === "ticket_appeal")
          ) {

              const modal = new ModalBuilder()
                  .setCustomId(
                      interaction.customId === "ticket_support"
                          ? "modal_ticket_support"
                          : "modal_ticket_appeal"
                  )
                  .setTitle(
                      interaction.customId === "ticket_support"
                          ? "General Support Ticket"
                          : "Appeal Ticket"
                  );

              const issueTitle = new TextInputBuilder()
                  .setCustomId("issue_title")
                  .setLabel(
                      interaction.customId === "ticket_support"
                          ? "What is your issue?"
                          : "Reason for appeal?"
                  )
                  .setStyle(TextInputStyle.Short)
                  .setRequired(true);

              const issueDesc = new TextInputBuilder()
                  .setCustomId("issue_desc")
                  .setLabel(
                      interaction.customId === "ticket_support"
                          ? "Describe your issue"
                          : "Explain your appeal"
                  )
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(true);

              return interaction.showModal(
                  modal.addComponents(
                      new ActionRowBuilder().addComponents(issueTitle),
                      new ActionRowBuilder().addComponents(issueDesc)
                  )
              );
          }

          // -------------------------------------------------
          // SUPPORT MODALS → CREATE TICKET
          // -------------------------------------------------
          if (
              interaction.isModalSubmit() &&
              (interaction.customId === "modal_ticket_support" ||
               interaction.customId === "modal_ticket_appeal")
          ) {

              const isSupport = interaction.customId === "modal_ticket_support";

              const prefix = isSupport ? "support" : "appeal";
              const categoryId = isSupport
                  ? config.generalticketcategory
                  : config.appealsticketcategory;

              const ticketId = client.getNextTicketId();

              if (!ticketId) {
                  return interaction.reply({
                      content: "❌ All 20 ticket slots are currently in use. Please wait for a ticket to close.",
                      ephemeral: true
                  });
              }

              client.activeTicketIds.add(ticketId);

              const issueTitle = interaction.fields.getTextInputValue("issue_title");
              const issueDesc = interaction.fields.getTextInputValue("issue_desc");

              const ticketChannel = await interaction.guild.channels.create({
                  name: `${prefix}-${ticketId}-${interaction.user.username}`,
                  type: ChannelType.GuildText,
                  parent: categoryId,
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
                      ...config.supportTeamRoles.map(roleId => ({
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
                      }
                  ]
              });

              const buttons = new ActionRowBuilder().addComponents(
                  new ButtonBuilder()
                      .setCustomId("ticket_claim")
                      .setLabel("📝 Claim Ticket")
                      .setStyle(ButtonStyle.Primary),

                  new ButtonBuilder()
                      .setCustomId("support_close")
                      .setLabel("🔒 Close Ticket")
                      .setStyle(ButtonStyle.Danger)
              );

              await ticketChannel.send({
                  embeds: [
                      {
                          title: `📩 ${isSupport ? "Support" : "Appeal"} Ticket #${ticketId}`,
                          description: "A new ticket has been created.",
                          color: 0x3498db,
                          fields: [
                              { name: "👤 User", value: interaction.user.tag },
                              { name: "🎫 Issue", value: issueTitle },
                              { name: "📝 Description", value: issueDesc }
                          ]
                      }
                  ],
                  components: [buttons]
              });

              return interaction.reply({
                  content: `✅ Your ticket (#${ticketId}) has been created: <#${ticketChannel.id}>`,
                  ephemeral: true
              });
          }

          // -------------------------------------------------
          // SUPPORT CLOSE BUTTON → TRANSCRIPT + FREE ID + SAFE DELETE
          // -------------------------------------------------
          if (interaction.isButton() && interaction.customId === "support_close") {

              const channel = interaction.channel;   // grab it before it gets deleted

              const match = channel.name.match(/^.+-(\d+)-/);
              if (match) {
                  const id = parseInt(match[1]);
                  client.activeTicketIds.delete(id);
              }

              await interaction.reply({
                  content: "🔒 Ticket closed. Saving transcript...",
                  ephemeral: true
              });

              // save the transcript BEFORE the channel is deleted
              await saveTranscript(channel, interaction.user, config);

              setTimeout(() => {
                  interaction.guild.channels.delete(channel.id).catch(() => {});
              }, 3000);
          }
      }
  };

  // -------------------------------------------------
  // TRANSCRIPT HELPER
  // -------------------------------------------------
  async function saveTranscript(channel, closedBy, config) {
      try {
          // 1. grab every message, 100 at a time
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

          const messages = all.reverse();   // oldest first so it reads like a convo

          // 2. build the text
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

          // 3. send it as a .txt file
          const file = new AttachmentBuilder(
              Buffer.from(lines.join("\n"), "utf-8"),
              { name: `${channel.name}-transcript.txt` }
          );

          const logChannel = await channel.guild.channels
              .fetch(config.transcriptschannelid)
              .catch(() => null);

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