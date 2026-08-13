// Confirmation service — confirm/cancel buttons for destructive actions
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Custom ID format: confirm:<action>:<targetId>:<requesterId>

function buildConfirmationRow(action, targetId, requesterId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`confirm:${action}:${targetId}:${requesterId}`)
      .setLabel('✅ Confirm')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`cancel:${action}:${targetId}:${requesterId}`)
      .setLabel('❌ Cancel')
      .setStyle(ButtonStyle.Secondary),
  );
}

function parseConfirmationId(customId) {
  // confirm:event_cancel:123:456789
  const parts = customId.split(':');
  if (parts.length !== 4) return null;
  return {
    action: parts[1],
    targetId: parts[2],
    requesterId: parts[3],
  };
}

module.exports = { buildConfirmationRow, parseConfirmationId };
