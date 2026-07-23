function formatMessage(msg) {
  const lines = [];

  const meta = [msg.time, msg.date].filter(Boolean).join(' · ');
  lines.push(meta ? `**${msg.sender}** · ${meta}` : `**${msg.sender}**`);

  if (msg.text) {
    lines.push(msg.text);
  }

  if (msg.imageFilename) {
    lines.push(`![${msg.imageFilename}](./imagens/${msg.imageFilename})`);
  } else if (msg.hadImage) {
    lines.push('*[mídia não exportada]*');
  }

  return lines.join('\n');
}

function buildMarkdown(messages, metadata) {
  const { contactName, exportedAt, total } = metadata;

  const header = [
    `# Conversa: ${contactName}`,
    `Exportado em: ${exportedAt}`,
    `Total de mensagens: ${total}`,
    '',
    '---',
    '',
    '',
  ].join('\n');

  const body = messages.map((msg) => formatMessage(msg)).join('\n\n');

  return header + body;
}
