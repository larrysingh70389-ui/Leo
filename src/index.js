import fs from 'node:fs';
import path from 'node:path';
import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { config } from './config.js';
import { askAi, limitDiscordMessage } from './ai.js';
import { handleLoginTimeButton, handleLoginTimeCommand } from './login-time.js';
import { handleProfileImageButton } from './user-profile.js';
import { handleTicketButton } from './tickets.js';
import { publicErrorMessage } from './error-message.js';
import { handlePrefixCommand, handleSlashCommand, PREFIX, parsePrefixCommand } from './prefix.js';

const lockFile = path.resolve(process.cwd(), '.bot.lock');
const activeMessageIds = new Set();

try {
  if (fs.existsSync(lockFile)) {
    const previousPid = Number(fs.readFileSync(lockFile, 'utf8').trim());
    if (Number.isInteger(previousPid) && previousPid > 0) {
      try {
        process.kill(previousPid, 0);
        console.error(`A bot instance is already running with PID ${previousPid}. Refusing duplicate start.`);
        process.exit(1);
      } catch {
        fs.unlinkSync(lockFile);
      }
    }
  }
  fs.writeFileSync(lockFile, String(process.pid));
} catch (error) {
  console.error('Failed to create bot lock file:', error instanceof Error ? error.message : error);
  process.exit(1);
}

process.on('exit', () => {
  try {
    if (fs.existsSync(lockFile) && fs.readFileSync(lockFile, 'utf8').trim() === String(process.pid)) {
      fs.unlinkSync(lockFile);
    }
  } catch {
    // ignore cleanup errors
  }
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    try {
      await interaction.deferReply({
        ephemeral: interaction.commandName === 'ticketpanel' || interaction.commandName === 'embed'
      });
      if (interaction.commandName === 'log') await handleLoginTimeCommand(interaction);
      else await handleSlashCommand(interaction);
    } catch (error) {
      console.error(`Slash command error /${interaction.commandName}:`, error instanceof Error ? error.name : 'unknown error');
      const response = { content: `❌ ${publicErrorMessage(error)}` };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(response).catch(() => undefined);
      } else {
        await interaction.reply(response).catch(() => undefined);
      }
    }
    return;
  }

  if (interaction.isButton() || interaction.isAnySelectMenu() || interaction.isModalSubmit()) {
    try {
      if (interaction.isButton() && interaction.customId.startsWith('ticket:')) {
        await handleTicketButton(interaction);
        return;
      }
      if (interaction.isButton() && interaction.customId.startsWith('login-time:')) {
        await handleLoginTimeButton(interaction);
        return;
      }
      if (interaction.isButton() && interaction.customId.startsWith('profile-image:')) {
        await handleProfileImageButton(interaction);
        return;
      }
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: '⚠️ This interaction is no longer active.' }).catch(() => undefined);
      } else {
        await interaction.reply({ content: '⚠️ This interaction is no longer active.' }).catch(() => undefined);
      }
    } catch (error) {
      console.error('Component interaction error:', error instanceof Error ? error.name : 'unknown error');
      const response = { content: `❌ ${publicErrorMessage(error)}` };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(response).catch(() => undefined);
      } else {
        await interaction.reply(response).catch(() => undefined);
      }
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (activeMessageIds.has(message.id)) return;
  activeMessageIds.add(message.id);
  setTimeout(() => activeMessageIds.delete(message.id), 5000);

  if (message.content.trim().toLowerCase() === '1tf') {
    if (!message.reference?.messageId) {
      await message.reply('Reply to a message with `1tf` and I will explain it.');
      return;
    }

    try {
      const referencedMessage = await message.fetchReference();
      const context = `Explain the meaning and intent of this Discord message in plain language.\nAuthor: ${referencedMessage.author.tag}\nMessage: ${referencedMessage.content}`;
      const answer = await askAi(referencedMessage.content, context);
      await message.reply(limitDiscordMessage(answer));
    } catch (error) {
      console.error('Error handling 1tf:', error instanceof Error ? error.name : 'unknown error');
      await message.reply(`I could not explain that message: ${publicErrorMessage(error)}`);
    }
    return;
  }

  if (message.content.startsWith(PREFIX)) {
    await handlePrefixCommand(message);
  }
});

client.on(Events.Error, (error) => console.error('Discord client error:', error.name));
process.on('unhandledRejection', (error) => console.error('Unhandled promise rejection:', error instanceof Error ? error.name : 'unknown error'));

export { PREFIX, parsePrefixCommand };

client.login(config.discordToken).catch((error) => {
  const status = Number.isInteger(error?.status) ? ` (HTTP ${error.status})` : '';
  const code = Number.isInteger(error?.code) ? ` (Discord code ${error.code})` : '';
  console.error(`Could not log in to Discord${status}${code}: ${error instanceof Error ? error.name : 'unknown error'}.`);
  process.exitCode = 1;
});
