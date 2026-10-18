import { ApplicationIntegrationType, ChannelType, InteractionContextType, SlashCommandBuilder } from 'discord.js';

const networks = [
	{ name: 'Bitcoin', value: 'bitcoin' },
	{ name: 'Litecoin', value: 'litecoin' },
	{ name: 'Solana', value: 'solana' },
	{ name: 'Ethereum', value: 'ethereum' },
	{ name: 'Base', value: 'base' },
	{ name: 'Arbitrum', value: 'arbitrum' },
	{ name: 'Polygon', value: 'polygon' }
];
const assets = [
	{ name: 'Bitcoin (BTC)', value: 'bitcoin' },
	{ name: 'Litecoin (LTC)', value: 'litecoin' },
	{ name: 'Solana (SOL)', value: 'solana' },
	{ name: 'Ethereum (ETH)', value: 'ethereum' },
	{ name: 'USD Coin (USDC)', value: 'usdc' }
];

function defineCommand(name, description, options = [], guildOnly = false) {
	const command = new SlashCommandBuilder()
		.setName(name)
		.setDescription(description)
		.setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
		.setContexts(guildOnly
			? [InteractionContextType.Guild]
			: [InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]);
	const addOption = {
		string: 'addStringOption',
		integer: 'addIntegerOption',
		number: 'addNumberOption',
		attachment: 'addAttachmentOption',
		boolean: 'addBooleanOption',
		user: 'addUserOption'
	};

	for (const definition of options) {
		command[addOption[definition.type]]((option) => {
			option.setName(definition.name).setDescription(definition.description).setRequired(Boolean(definition.required));
			if (definition.choices) option.addChoices(...definition.choices);
			if (definition.min !== undefined) option.setMinValue(definition.min);
			return option;
		});
	}

	return command;
}

const text = (name, description, required = true, choices) => ({ type: 'string', name, description, required, choices });
const user = (name, description, required = true) => ({ type: 'user', name, description, required });
const attachment = (name, description, required = true) => ({ type: 'attachment', name, description, required });

export const commands = [
	new SlashCommandBuilder()
		.setName('log')
		.setDescription('Track login time by week')
		.setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
		.setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
		.addSubcommand((subcommand) => subcommand.setName('in').setDescription('Start a login session'))
		.addSubcommand((subcommand) => subcommand.setName('out').setDescription('End your login session'))
		.addSubcommand((subcommand) => subcommand.setName('time').setDescription('Show your login time this week'))
		.addSubcommand((subcommand) => subcommand.setName('leaderboard').setDescription('Show this week’s login time leaderboard'))
		.addSubcommand((subcommand) => subcommand
			.setName('reset')
			.setDescription('Reset login time for this week')
			.addBooleanOption((option) => option
				.setName('all')
				.setDescription('Reset every user')
				.setRequired(false))),
	new SlashCommandBuilder()
		.setName('check')
		.setDescription('Check server users')
		.setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
		.setContexts([InteractionContextType.Guild])
		.addSubcommand((subcommand) => {
			subcommand.setName('users').setDescription('Check presence, verification, and account age');
			for (let index = 1; index <= 10; index += 1) {
				subcommand.addUserOption((option) => option
					.setName(`user${index}`)
					.setDescription(`${index === 1 ? 'First' : `User ${index}`} server user to check`)
					.setRequired(index === 1));
			}
			return subcommand;
		}),
	defineCommand('setup', 'Configure your public wallet addresses').addSubcommandGroup((group) => group
		.setName('wallet')
		.setDescription('Manage your public wallet addresses')
		.addSubcommand((subcommand) => subcommand
			.setName('set')
			.setDescription('Add or update a public address')
			.addStringOption((option) => option.setName('asset').setDescription('Asset').setRequired(true).addChoices(...assets))
			.addStringOption((option) => option.setName('network').setDescription('Blockchain network').setRequired(true).addChoices(...networks))
			.addStringOption((option) => option.setName('address').setDescription('Public wallet address').setRequired(true)))
		.addSubcommand((subcommand) => subcommand
			.setName('remove')
			.setDescription('Remove a configured address')
			.addStringOption((option) => option.setName('asset').setDescription('Asset').setRequired(true).addChoices(...assets))
			.addStringOption((option) => option.setName('network').setDescription('Blockchain network').setRequired(true).addChoices(...networks)))),
	defineCommand('help', 'Show available commands'),
	new SlashCommandBuilder()
		.setName('ticketpanel')
		.setDescription('Post the support ticket panel')
		.setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
		.setContexts([InteractionContextType.Guild]),
	new SlashCommandBuilder()
		.setName('embed')
		.setDescription('Create and send a custom embed')
		.setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
		.setContexts([InteractionContextType.Guild])
		.addChannelOption((option) => option
			.setName('channel')
			.setDescription('Text channel where the embed will be sent')
			.addChannelTypes(ChannelType.GuildText)
			.setRequired(true))
		.addStringOption((option) => option.setName('title').setDescription('Embed title').setMaxLength(256))
		.addStringOption((option) => option.setName('description').setDescription('Embed description').setMaxLength(4096))
		.addStringOption((option) => option.setName('color').setDescription('Hex color such as #5865F2'))
		.addStringOption((option) => option.setName('image').setDescription('Image URL'))
		.addStringOption((option) => option.setName('thumbnail').setDescription('Thumbnail URL'))
		.addStringOption((option) => option.setName('footer').setDescription('Footer text').setMaxLength(2048))
		.addStringOption((option) => option.setName('author').setDescription('Author text').setMaxLength(256))
		.addStringOption((option) => option.setName('content').setDescription('Message text sent alongside the embed').setMaxLength(2000))
		.addStringOption((option) => option
			.setName('template')
			.setDescription('Configured embed template')
			.addChoices({ name: 'Server rules', value: 'server-rules' })),
	defineCommand('say', 'Send a message as the bot', [text('message', 'Message to send')]),
	defineCommand('everyone', 'Mention everyone', [text('message', 'Message to send')]),
	defineCommand('here', 'Mention online members', [text('message', 'Message to send')]),
	defineCommand('paidticket', 'Mark a ticket paid and send its payment screenshot', [
		{ type: 'number', name: 'amount', description: 'Payment amount', required: true, min: 0.01 },
		user('user', 'Payment recipient'),
		attachment('screenshot', 'Payment screenshot')
	], true),
	defineCommand('ask', 'Ask the configured AI', [text('question', 'Your question')]),
	defineCommand('calc', 'Evaluate an arithmetic expression', [text('expression', 'Expression to calculate')]),
	defineCommand('wallet', 'Show bot-configured public wallet addresses'),
	defineCommand('wallets', 'Show a user’s configured public wallet addresses', [user('user', 'User whose public addresses to show', false)]),
	defineCommand('balance', 'Check any public crypto address', [
		text('network', 'Blockchain network', true, networks),
		text('address', 'Public wallet address')
	]),
	defineCommand('price', 'Get a coin price', [text('coin', 'Coin identifier'), text('currency', 'Quote currency', false)]),
	defineCommand('tokenprice', 'Get a token price', [text('token', 'Token identifier'), text('currency', 'Quote currency', false)]),
	defineCommand('qr', 'Generate a QR code', [text('content', 'Text or URL to encode')]),
	defineCommand('summarize', 'Summarize text with the configured AI', [text('text', 'Text to summarize')]),
	defineCommand('txid', 'Look up a transaction', [text('hash', 'Transaction hash'), text('network', 'Network')]),
	defineCommand('ticketpaid', 'Check a transaction receipt status', [text('txid', 'Transaction hash'), text('network', 'Network')]),
	defineCommand('wallethistory', 'Show recent public wallet transactions', [text('network', 'Network'), text('address', 'Wallet address', false)]),
	defineCommand('address', 'Show a bot-configured public address', [text('coin', 'Coin symbol'), text('network', 'Network')]),
	defineCommand('addresses', 'Show all bot-configured public addresses'),
	defineCommand('tokeninfo', 'Show public token information', [text('token', 'Token identifier or address')]),
	defineCommand('convert', 'Convert between coins using current prices', [text('amount', 'Amount'), text('from', 'Source coin'), text('to', 'Target coin')]),
	defineCommand('walletcheck', 'Check configured public address formats'),
	defineCommand('explorer', 'Create a public explorer link', [text('type', 'Address or transaction', true, [{ name: 'Address', value: 'address' }, { name: 'Transaction', value: 'tx' }]), text('value', 'Address or transaction hash'), text('network', 'Network')]),
	defineCommand('payinfo', 'Show public payment address information', [text('coin', 'Coin symbol'), text('network', 'Network')]),
	defineCommand('reward', 'Show the configured reward information'),
	defineCommand('vouch', 'Post a public vouch', [user('user', 'User to vouch for'), text('message', 'Vouch message')]),
	defineCommand('serverinfo', 'Show server information', [], true),
	defineCommand('avatar', 'Show a user’s Discord avatar', [user('user', 'User whose avatar to show', false)]),
	defineCommand('banner', 'Show a user’s Discord profile banner', [user('user', 'User whose banner to show', false)])
];
