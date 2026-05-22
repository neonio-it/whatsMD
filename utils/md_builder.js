function toImageTag(filename, index) {
  const padded = String(index + 1).padStart(3, '0');
  return `![img_${padded}](./imagens/${filename})`;
}

function formatMessage(msg, index) {
  const lines = [];

  lines.push(`**${msg.sender}** · ${msg.time}`);

  if (msg.text) {
    lines.push(msg.text);
  }

  if (msg.imageFilename) {
    lines.push(toImageTag(msg.imageFilename, index));
  } else if (msg.hadImage) {
    lines.push('![mídia indisponível]()');
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
  ].join('\n');

  const body = messages.map((msg, i) => formatMessage(msg, i)).join('\n\n');

  return header + body;
}
