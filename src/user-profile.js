import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

const imageSizes = [128, 256, 512, 1024];

export async function createProfileImagePayload(client, userId, kind, size = 512) {
  if (!['avatar', 'banner'].includes(kind)) throw new Error('Unknown profile image type.');
  if (!imageSizes.includes(size)) throw new Error('Unsupported image size.');

  const user = await client.users.fetch(userId);
  const animated = kind === 'avatar'
    ? Boolean(user.avatar?.startsWith('a_'))
    : Boolean(user.banner?.startsWith('a_'));
  const imageUrlFor = (extension, forceStatic = false) => kind === 'avatar'
    ? user.displayAvatarURL({ extension, size, forceStatic })
    : user.bannerURL({ extension, size, forceStatic });
  const imageUrl = imageUrlFor(animated ? 'gif' : 'png');
  if (!imageUrl) throw new Error(`${user.username} does not have a profile banner.`);

  const staticPngUrl = imageUrlFor('png', true);
  const webpUrl = imageUrlFor('webp', true);
  const formatLinks = `[PNG](${staticPngUrl}) · [WebP](${webpUrl})${animated ? ` · [GIF](${imageUrl})` : ''}`;
  const embed = new EmbedBuilder()
    .setTitle(`${user.username}’s ${kind}`)
    .setDescription(`${formatLinks}\nImage size: ${size}px`)
    .setImage(imageUrl)
    .setColor(0x5865f2);
  const components = [new ActionRowBuilder().addComponents(
    imageSizes.map((option) => new ButtonBuilder()
      .setCustomId(`profile-image:${kind}:${userId}:${option}`)
      .setLabel(`${option}px`)
      .setStyle(option === size ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(option === size))
  )];
  return { embeds: [embed], components };
}

export async function handleProfileImageButton(interaction) {
  const [, kind, userId, sizeText] = interaction.customId.split(':');
  const size = Number(sizeText);
  if (!imageSizes.includes(size)) throw new Error('Invalid profile image size.');
  const payload = await createProfileImagePayload(interaction.client, userId, kind, size);
  await interaction.update(payload);
  return true;
}
