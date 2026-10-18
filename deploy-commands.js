import { REST, Routes } from 'discord.js';
import { commands } from './src/commands.js';
import { config } from './src/config.js';

const rest = new REST({ version: '10' }).setToken(config.discordToken);
let currentOperation = 'initialize Discord REST client';

try {
	currentOperation = 'authenticate bot token with Discord (GET /users/@me)';
	console.log(`Checking bot token identity with Discord.`);
	const botUser = await rest.get(Routes.user());
	const applicationId = config.clientId || botUser.id;
	if (applicationId !== botUser.id) {
		throw new Error('CLIENT_ID does not match the application ID belonging to DISCORD_TOKEN.');
	}
	if (!/^\d{17,20}$/.test(applicationId)) {
		throw new Error('The resolved Discord application ID is not a valid snowflake.');
	}

	currentOperation = 'serialize and validate local slash-command definitions';
	const commandPayloads = commands.map((command) => command.toJSON());
	const expectedNames = commandPayloads.map((command) => command.name);
	if (commandPayloads.length > 100) {
		throw new Error('Discord supports at most 100 application commands per scope.');
	}
	if (new Set(expectedNames).size !== expectedNames.length) {
		throw new Error('Local slash-command definitions contain duplicate names.');
	}
	for (const requiredName of ['ticketpanel', 'embed']) {
		if (!expectedNames.includes(requiredName)) {
			throw new Error(`The local slash-command definitions are missing /${requiredName}.`);
		}
	}

	const route = Routes.applicationCommands(applicationId);
	currentOperation = `register global application commands (PUT ${route})`;
	console.log(`Registering ${commandPayloads.length} global commands for application ${applicationId}.`);
	const registered = await rest.put(route, { body: commandPayloads });
	currentOperation = `verify registered global application commands (GET ${route})`;
	const verified = await rest.get(route);
	const registeredNames = verified.map((command) => command.name);
	currentOperation = 'verify global command names, permissions, contexts, and integration types';
	if (new Set(registeredNames).size !== registeredNames.length) {
		throw new Error('Discord returned duplicate global application commands.');
	}
	if (registeredNames.length !== expectedNames.length || expectedNames.some((name) => !registeredNames.includes(name))) {
		throw new Error('The registered global command set does not match the local command definitions.');
	}
	const definitionByName = new Map(commandPayloads.map((command) => [command.name, command]));
	for (const command of verified) {
		const definition = definitionByName.get(command.name);
		const expectedContexts = definition.contexts;
		if (command.default_member_permissions !== null && command.default_member_permissions !== undefined) {
			throw new Error(`/${command.name} has restrictive default member permissions.`);
		}
		if (!Array.isArray(command.integration_types)
			|| ![0, 1].every((integrationType) => command.integration_types.includes(integrationType))) {
			throw new Error(`/${command.name} is missing guild or user-install support.`);
		}
		if (!Array.isArray(command.contexts)
			|| expectedContexts.length !== command.contexts.length
			|| expectedContexts.some((context) => !command.contexts.includes(context))) {
			throw new Error(`/${command.name} has unexpected interaction contexts.`);
		}
	}

	let removedGuildCommands = 0;
	let guildCleanupSkipped = false;
	if (config.guildId) {
		const guildRoute = Routes.applicationGuildCommands(applicationId, config.guildId);
		try {
			currentOperation = `list legacy guild commands (GET ${guildRoute})`;
			const existingGuildCommands = await rest.get(guildRoute);
			const retiredNames = new Set([
				'dm', 'cryptobalance', 'balance', 'tip', 'pay', 'daily', 'weekly', 'work', 'beg',
				'leaderboard', 'profile', 'stats', 'inventory', 'shop', 'buy', 'sell', 'economy',
				'coinflip', 'dice', 'slots', 'blackjack', 'mines', 'roulette', 'higherlower', 'duel',
				'economy-config', 'economy-add', 'economy-remove', 'economy-set', 'economy-reset',
				'economy-user', 'economy-giveall'
			]);
			const managedNames = new Set([...expectedNames, ...retiredNames]);
			for (const guildCommand of existingGuildCommands) {
				if ((guildCommand.type === 1 || guildCommand.type === undefined) && managedNames.has(guildCommand.name)) {
					currentOperation = `remove legacy guild command /${guildCommand.name} (DELETE ${Routes.applicationGuildCommand(applicationId, config.guildId, guildCommand.id)})`;
					await rest.delete(Routes.applicationGuildCommand(applicationId, config.guildId, guildCommand.id));
					removedGuildCommands += 1;
				}
			}
			currentOperation = `verify removal of legacy guild commands (GET ${guildRoute})`;
			const remainingGuildCommands = await rest.get(guildRoute);
			const remainingDuplicates = remainingGuildCommands.filter((command) => managedNames.has(command.name));
			if (remainingDuplicates.length) {
				throw new Error('Managed guild-scoped commands remain alongside the global commands.');
			}
		} catch (error) {
			if (error?.status !== 403 || ![50001, 50013].includes(error?.code)) throw error;
			guildCleanupSkipped = true;
			console.warn(`Global commands are registered and verified, but legacy guild-command cleanup could not complete during: ${currentOperation} (HTTP ${error.status}, Discord code ${error.code}). Check GUILD_ID and bot access to that server; global registration is unaffected.`);
		}
	}
	currentOperation = 'verify global command registration count';
	if (registered.length !== expectedNames.length) {
		throw new Error('Discord registered an unexpected number of global application commands.');
	}
	console.log(`Verified ${verified.length} global commands for application ${applicationId}, including /ticketpanel and /embed: unique, unrestricted, guild/user-install enabled${removedGuildCommands ? `; removed ${removedGuildCommands} matching guild commands` : ''}${guildCleanupSkipped ? '; legacy guild cleanup skipped due to denied access' : ''}.`);
} catch (error) {
	const status = Number.isInteger(error?.status) ? ` (HTTP ${error.status})` : '';
	const code = Number.isInteger(error?.code) ? ` (Discord code ${error.code})` : '';
	console.error(`Slash command deployment failed during: ${currentOperation}${status}${code}.`);
	process.exitCode = 1;
}
