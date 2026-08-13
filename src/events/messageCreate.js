const { Events } = require('discord.js');
const { answerMention } = require('../services/listen');
const bingo = require('../services/bingo');
const bingoUi = require('../services/bingoUi');
const draft = require('../services/bingoDraft');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot) return;

    const pending = bingoUi.takePendingImport(message.author.id);
    if (pending && pending.guildId === message.guildId) {
      try {
        const card = bingo.getBingo(message.guildId, pending.boardId);
        if (card && bingo.isEditable(card)) {
          const note = await bingoUi.ingestList({ guildId: message.guildId }, card, message.content);
          const fresh = bingo.getBingo(message.guildId, card.id);
          await message.reply({ content: note, ...draft.draftPayload(fresh) });
          await bingoUi.syncPostedBoard({ client: message.client, guildId: message.guildId }, fresh);
        }
      } catch (err) {
        console.error('Bingo import from chat failed:', err.message);
      }
      return;
    }

    try {
      await answerMention(message);
    } catch (err) {
      console.error('Mention reply failed:', err.message);
    }
  },
};
