import fs from 'node:fs';
import { ChannelType, EmbedBuilder } from 'discord.js';
import { isAdministrator, isAuthorizedUser } from './command-permissions.js';
import { parseHttpsImageUrl } from './ticket-validation.js';

const RULES_TEMPLATE_PATH = new URL('../config/server-rules.json', import.meta.url);
const rulesTemplate = JSON.parse(fs.readFileSync(RULES_TEMPLATE_PATH, 'utf8'));

function validateTextLimit(value, maxLength, label) {
  if (value !== null && value !== undefined && value.length > maxLength) {
    throw new Error(`${label} cannot exceed ${maxLength} characters.`);
  }
}

function validateEmbedLength(embed, content) {
  const data = embed.toJSON();
  const totalLength = (data.title?.length ?? 0)
    + (data.description?.length ?? 0)
    + (data.author?.name?.length ?? 0)
    + (data.footer?.text?.length ?? 0)
    + (data.fields ?? []).reduce((length, field) => length + field.name.length + field.value.length, 0);
  if (totalLength > 6000) throw new Error('The embed text exceeds Discord’s 6,000-character limit.');
  if (!data.title && !data.description && !data.fields?.length && !data.image && !data.thumbnail) {
    throw new Error('Add embed text, an image, a thumbnail, or choose the Server rules template.');
  }
  if (content?.length > 2000) throw new Error('Message content cannot exceed 2,000 characters.');
}

function createRulesEmbed() {
  if (!rulesTemplate || typeof rulesTemplate.title !== 'string'
    || typeof rulesTemplate.description !== 'string'
    || !Array.isArray(rulesTemplate.fields) || rulesTemplate.fields.length > 25) {
    throw new Error('The configured server rules template is invalid.');
  }
  if (!rulesTemplate.title.length || !rulesTemplate.description.length) {
    throw new Error('The configured server rules template needs a title and description.');
  }
  validateTextLimit(rulesTemplate.title, 256, 'Rules title');
  validateTextLimit(rulesTemplate.description, 4096, 'Rules description');
  const embed = new EmbedBuilder()
    .setTitle(rulesTemplate.title)
    .setDescription(rulesTemplate.description)
    .setColor(0x5865f2);
  for (const field of rulesTemplate.fields) {
    if (!field || typeof field.name !== 'string' || typeof field.value !== 'string') {
      throw new Error('The configured server rules template contains an invalid field.');
    }
    if (!field.name.length || !field.value.length) {
      throw new Error('Configured server rules fields must have a name and value.');
    }
    validateTextLimit(field.name, 256, 'Rules field name');
    validateTextLimit(field.value, 1024, 'Rules field value');
    embed.addFields({ name: field.name, value: field.value, inline: false });
  }
  validateEmbedLength(embed);
  return embed;
}

export async function handleEmbedCommand(interaction) {
  if (!interaction.guild) throw new Error('This command is only available in a server.');
  if (!isAdministrator(interaction) && !isAuthorizedUser(interaction)) {
    throw new Error('You are not authorized to send custom embeds.');
  }

  const channel = interaction.options.getChannel('channel', true);
  if (!channel || channel.type !== ChannelType.GuildText || channel.guildId !== interaction.guild.id) {
    throw new Error('Choose a text channel in this server.');
  }
  const template = interaction.options.getString('template');
  const content = interaction.options.getString('content');
  let embed;
  if (template === 'server-rules') {
    const conflictingOptions = ['title', 'description', 'color', 'image', 'thumbnail', 'footer', 'author']
      .filter((name) => interaction.options.getString(name) !== null);
    if (conflictingOptions.length) {
      throw new Error('Use either the Server rules template or custom embed options, not both.');
    }
    embed = createRulesEmbed();
  } else if (template) {
    throw new Error('The selected embed template is not supported.');
  } else {
    const color = interaction.options.getString('color');
    if (color && !/^#?[0-9a-fA-F]{6}$/.test(color)) {
      throw new Error('Color must be a six-digit hexadecimal value such as #5865F2.');
    }

    embed = new EmbedBuilder().setColor(color ? Number.parseInt(color.replace(/^#/, ''), 16) : 0x5865f2);
    const title = interaction.options.getString('title');
    const description = interaction.options.getString('description');
    const image = parseHttpsImageUrl(interaction.options.getString('image'), 'image URL');
    const thumbnail = parseHttpsImageUrl(interaction.options.getString('thumbnail'), 'thumbnail URL');
    const footer = interaction.options.getString('footer');
    const author = interaction.options.getString('author');
    validateTextLimit(title, 256, 'Title');
    validateTextLimit(description, 4096, 'Description');
    validateTextLimit(footer, 2048, 'Footer');
    validateTextLimit(author, 256, 'Author');
    if (title) embed.setTitle(title);
    if (description) embed.setDescription(description);
    if (image) embed.setImage(image);
    if (thumbnail) embed.setThumbnail(thumbnail);
    if (footer) embed.setFooter({ text: footer });
    if (author) embed.setAuthor({ name: author });
    validateEmbedLength(embed, content);
  }

  if (content !== null && content !== undefined && content.length > 2000) {
    throw new Error('Message content cannot exceed 2,000 characters.');
  }
  const payload = {
    embeds: [embed],
    allowedMentions: { parse: [] },
    ...(content ? { content } : {})
  };
  await channel.send(payload);
  await interaction.editReply(`✅ Embed sent to <#${channel.id}>.`);
  return true;
}
