import { REST, Routes } from 'discord.js';
import { commands } from './src/commands.js';
import { config } from './src/config.js';

const rest = new REST({ version: '10' }).setToken(config.discordToken);

try {
	let applicationId = config.clientId;
	if (!applicationId) {
		const botUser = await rest.get(Routes.user());
		applicationId = botUser.id;
	}

	const route = Routes.applicationCommands(applicationId);
	const commandPayloads = commands.map((command) => command.toJSON());
	const registered = await rest.put(route, { body: commandPayloads });
	const verified = await rest.get(route);
	const registeredNames = verified.map((command) => command.name);
	const expectedNames = commandPayloads.map((command) => command.name);
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
	if (config.guildId) {
		const guildRoute = Routes.applicationGuildCommands(applicationId, config.guildId);
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
				await rest.delete(Routes.applicationGuildCommand(applicationId, config.guildId, guildCommand.id));
				removedGuildCommands += 1;
			}
		}
		const remainingGuildCommands = await rest.get(guildRoute);
		const remainingDuplicates = remainingGuildCommands.filter((command) => managedNames.has(command.name));
		if (remainingDuplicates.length) {
			throw new Error('Managed guild-scoped commands remain alongside the global commands.');
		}
	}
	if (registered.length !== expectedNames.length) {
		throw new Error('Discord registered an unexpected number of global application commands.');
	}
	console.log(`Verified ${verified.length} global commands: unique, unrestricted, guild/user-install enabled${removedGuildCommands ? `; removed ${removedGuildCommands} matching guild commands` : ''}.`);
} catch (error) {
	const status = Number.isInteger(error?.status) ? ` (HTTP ${error.status})` : '';
	const code = Number.isInteger(error?.code) ? ` (Discord code ${error.code})` : '';
	console.error(`Slash command registration or verification failed${status}${code}.`);
	process.exitCode = 1;
}
