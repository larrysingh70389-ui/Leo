
import { REST, Routes } from 'discord.js';
import { commands } from './src/commands.js';
import { config } from './src/config.js';

const rest = new REST({ version: '10' }).setToken(config.discordToken);
let currentOperation = 'initialize Discord REST client';

try {
  currentOperation = 'authenticate bot token with Discord (GET /users/@me)';
  console.log('Checking bot token identity with Discord.');

  const botUser = await rest.get(Routes.user());
  const applicationId = config.clientId || botUser.id;

  if (applicationId !== botUser.id) {
    throw new Error(
      'CLIENT_ID does not match the application ID belonging to DISCORD_TOKEN.'
    );
  }

  if (!/^\d{17,20}$/.test(applicationId)) {
    throw new Error('The resolved Discord application ID is invalid.');
  }

  currentOperation = 'serialize and validate local slash-command definitions';

  const commandPayloads = commands.map((command) => command.toJSON());
  const expectedNames = commandPayloads.map((command) => command.name);

  console.log(`Found ${commandPayloads.length} local slash commands.`);
  console.log(`Command names: ${expectedNames.join(', ')}`);

  if (commandPayloads.length > 100) {
    throw new Error('Discord supports at most 100 application commands per scope.');
  }

  if (new Set(expectedNames).size !== expectedNames.length) {
    throw new Error('Local slash-command definitions contain duplicate names.');
  }

  for (const requiredName of ['ticketpanel', 'embed']) {
    if (!expectedNames.includes(requiredName)) {
      throw new Error(
        `The local slash-command definitions are missing /${requiredName}.`
      );
    }
  }

  // Validate each command before sending anything to Discord.
  for (const command of commandPayloads) {
    if (!command.name || !command.description) {
      throw new Error(
        `Command "${command.name || 'unknown'}" is missing its name or description.`
      );
    }
  }

  const route = Routes.applicationCommands(applicationId);

  currentOperation = `register global application commands (PUT ${route})`;

  console.log(
    `Registering ${commandPayloads.length} global commands for application ${applicationId}.`
  );

  const registered = await rest.put(route, {
    body: commandPayloads
  });

  currentOperation = `verify registered global application commands (GET ${route})`;

  const verified = await rest.get(route);
  const registeredNames = verified.map((command) => command.name);

  currentOperation = 'verify global command registration';

  if (new Set(registeredNames).size !== registeredNames.length) {
    throw new Error('Discord returned duplicate global application commands.');
  }

  const missingNames = expectedNames.filter(
    (name) => !registeredNames.includes(name)
  );

  if (missingNames.length > 0 || registeredNames.length !== expectedNames.length) {
    throw new Error(
      `Registered command set does not match local definitions. Missing: ${
        missingNames.join(', ') || 'none'
      }.`
    );
  }

  console.log(
    `SUCCESS: Discord registered and verified ${verified.length} global commands.`
  );
  console.log('Confirmed commands: /ticketpanel and /embed.');

  // Clean up legacy guild commands when a GUILD_ID is configured.
  if (config.guildId) {
    const guildRoute = Routes.applicationGuildCommands(
      applicationId,
      config.guildId
    );

    try {
      currentOperation = `list legacy guild commands (GET ${guildRoute})`;

      const existingGuildCommands = await rest.get(guildRoute);

      const retiredNames = new Set([
        'dm', 'cryptobalance', 'balance', 'tip', 'pay', 'daily', 'weekly',
        'work', 'beg', 'leaderboard', 'profile', 'stats', 'inventory',
        'shop', 'buy', 'sell', 'economy', 'coinflip', 'dice', 'slots',
        'blackjack', 'mines', 'roulette', 'higherlower', 'duel',
        'economy-config', 'economy-add', 'economy-remove', 'economy-set',
        'economy-reset', 'economy-user', 'economy-giveall'
      ]);

      const managedNames = new Set([...expectedNames, ...retiredNames]);

      for (const guildCommand of existingGuildCommands) {
        if (
          (guildCommand.type === 1 || guildCommand.type === undefined) &&
          managedNames.has(guildCommand.name)
        ) {
          currentOperation = `remove legacy guild command /${guildCommand.name}`;

          await rest.delete(
            Routes.applicationGuildCommand(
              applicationId,
              config.guildId,
              guildCommand.id
            )
          );
        }
      }

      console.log('Legacy guild-command cleanup completed.');
    } catch (error) {
      if (
        error?.status === 403 &&
        [50001, 50013].includes(error?.code)
      ) {
        console.warn(
          'Global commands were registered, but legacy guild cleanup was denied. ' +
          'Check GUILD_ID and the bot’s access to that server.'
        );
      } else {
        throw error;
      }
    }
  }

  if (registered.length !== expectedNames.length) {
    throw new Error('Discord returned an unexpected number of registered commands.');
  }

  console.log('Slash-command deployment completed successfully.');
} catch (error) {
  const status = Number.isInteger(error?.status)
    ? ` (HTTP ${error.status})`
    : '';

  const code = Number.isInteger(error?.code)
    ? ` (Discord code ${error.code})`
    : '';

  console.error(
    `Slash command deployment failed during: ${currentOperation}${status}${code}.`
  );

  console.error('Actual error:', error?.message ?? String(error));

  if (error?.rawError) {
    console.error('Discord API error details:', JSON.stringify(error.rawError));
  }

  if (error?.errors) {
    console.error('Validation details:', JSON.stringify(error.errors));
  }

  if (error?.stack) {
    console.error('Stack trace:', error.stack);
  }

  process.exitCode = 1;
}
