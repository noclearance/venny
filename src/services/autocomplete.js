function clip(text, max = 100) {
  const s = String(text || '');
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function filterChoices(items, query, toChoice) {
  const q = String(query ?? '').trim().toLowerCase();
  const choices = [];
  for (const item of items) {
    const choice = toChoice(item);
    if (!choice) continue;
    const name = clip(choice.name);
    const hay = `${name} ${choice.value}`.toLowerCase();
    if (q && !hay.includes(q)) continue;
    choices.push({ name, value: choice.value });
    if (choices.length >= 25) break;
  }
  return choices;
}

async function respond(interaction, choices) {
  try {
    await interaction.respond(choices);
  } catch {
    // Discord times autocomplete out at 3s — ignore late replies
  }
}

module.exports = { clip, filterChoices, respond };
