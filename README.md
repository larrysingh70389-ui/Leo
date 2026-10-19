# Leonidas Discord Bot

A Discord app built with JavaScript and discord.js. Slash commands support Guild Install and User Install. Prefix commands use `+` and require the bot to be installed in a server. The `1tf` reply trigger asks the configured OpenAI model to explain a message.

## Requirements

- Node.js 20 or newer
- A Discord application and bot token
- An OpenAI API key for `/ask`, `/summarize`, and `1tf`

## Setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env` and configure the required values. Never commit `.env`.

   `DISCORD_TOKEN` is required. Set `OPENAI_API_KEY` for AI commands; `OPENAI_MODEL` optionally selects a model available to that API account and defaults to `gpt-4o-mini`. A ChatGPT subscription does not itself provide API usage or billing. CoinGecko public market-data endpoints are used where possible; `COINGECKO_API_KEY` is optional. `EXPLORER_API_KEY` is optional and can be used with the Etherscan-compatible transaction-history endpoint.
   
   For support tickets, configure `TICKET_CATEGORY_ID` with the server category channel ID and `TICKET_SUPPORT_ROLE_IDS` with a comma-separated list of staff role IDs before posting a panel. `TICKET_PANEL_BANNER_URL` optionally accepts a valid HTTPS image URL; an invalid banner is logged and the panel is posted without it. The bot needs **Manage Channels** in the server; it receives view, send, history, and embed permissions in each new ticket. `/ticketpanel` is available to server administrators, configured support staff, and the existing `/say` authorized users.

   `/embed` is available to server administrators and the existing `/say` authorized users. Its `Server rules` template is editable in [`config/server-rules.json`](./config/server-rules.json); update the title, description, or fields there without changing command code.

3. In the Discord Developer Portal, enable **User Install** and **Guild Install**. Include `applications.commands` for User Install and `bot` plus `applications.commands` for Guild Install. Enable **Message Content Intent**, **Server Members Intent**, and **Presence Intent** for prefix commands and `/check`.

4. Register slash commands globally:

   ```sh
   npm run deploy
   ```

   Run this as a separate one-off deployment task after pulling the repository; keep HeavenCloud's normal **Main File** set to `src/index.js`. `npm run deploy` invokes the root `deploy.js` wrapper, which runs the existing `deploy-commands.js` registration and verification logic. It verifies the token's bot identity against `CLIENT_ID`, registers commands globally, then checks command names, contexts, installation types, and permissions through Discord's API. If `GUILD_ID` is configured, matching legacy guild-scoped commands are removed after global registration is verified. If Discord denies access to that optional legacy-cleanup guild, deployment clearly warns that cleanup was skipped while reporting the separately verified global registration. Deployment logs identify the failed operation and Discord HTTP/error codes without logging credentials.

5. Start the bot:

   ```sh
   npm.cmd run pm2:start
   ```

   See the existing PM2 scripts for status, logs, restart, and Windows logon startup.

## Commands

Command replies are public by default. In a DM or an App context with no shared server channel, only the invoking user can see the response. `/check`, `/paidticket`, and `/serverinfo` are server-only. `/say` and `+say` are limited to Discord user IDs `1347457775160266804` and `1406878282275618826`; their bot-authored message ends with a blank line and `                                           -# Sent by leonidas`. `/everyone`, `/here`, and `/log reset all` require the caller to have Administrator permission in a server; these actions are unavailable in DMs. Personal `/log reset` confirmations can only be confirmed or cancelled by the user who requested them. Discord's own channel permissions and context limitations still apply.

### Slash commands

- `/help`
- `/ticketpanel`
- `/embed channel [title] [description] [color] [image] [thumbnail] [footer] [author] [content] [template:server-rules]`
- `/say message`, `/everyone message`, `/here message`
- `/paidticket amount user screenshot`
- `/ask question`, `/summarize text`
- `/calc expression`, `/qr content`
- `/avatar [user]`, `/banner [user]`
- `/check users user1 [user2 … user10]`
- `/serverinfo`, `/vouch user message`, `/reward`
- `/log in|out|time|leaderboard|reset [all]`
- `/setup wallet set asset network address`
- `/setup wallet remove asset network`
- `/wallets [user]`
- `/wallet`, `/address coin network`, `/addresses`, `/walletcheck`
- `/balance network address`
- `/price coin [currency]`, `/tokenprice token [currency]`, `/tokeninfo token`
- `/txid hash network`, `/ticketpaid txid network`, `/wallethistory network [address]`
- `/convert amount from to`, `/explorer type value network`, `/payinfo coin network`

All remaining slash commands have corresponding `+` prefix commands. For example, `+ask question`, `+setup wallet set asset network address`, `+wallets [@user]`, `+balance network address`, `+avatar [@user]`, and `+log in|out|time|leaderboard|reset [all]`. `+paid` is an alias for `+paidticket`. `/dm`, `+dm`, and the former economy/gambling commands are removed.

For `+paidticket <amount> @user` (or its `+paid` alias), reply to the payment-proof message before running the command. The bot forwards that replied-to message to the configured proofs channel and sends the delivery confirmation in the ticket. The caller must have the configured staff role. `/paidticket` continues to accept its screenshot attachment.

`/avatar` and `/banner` default to the command user and include public size buttons. Animated Discord assets use GIF links; static assets include PNG and WebP links.

## Wallets and crypto

`/setup wallet` stores each user's public address for Bitcoin, Litecoin, Solana, Ethereum, or USDC. USDC is supported on Ethereum, Solana, Base, Arbitrum, and Polygon; the configured USDC mint/contract is the official native USDC on each network. Users can update or remove their own address. `/wallets` shows only configured addresses and can display another user's public addresses.

`/balance network address` checks an arbitrary public address, whether or not it is configured. It returns the native balance, native USDC balance where supported, estimated USD values when prices are available, and up to 20 recent transactions. This is read-only: the bot never requests private keys or seed phrases and never signs or sends transactions. Existing EVM JSON-RPC support is retained; public read-only endpoints are used for Bitcoin, Litecoin, and Solana. The EVM transaction-history configuration can use `EXPLORER_API_URL` and `EXPLORER_API_KEY`; public Blockscout endpoints are used if no Etherscan-compatible credentials are configured.

`/wallet`, `/address`, `/addresses`, and `/payinfo` remain bot-configured payment-address commands and are separate from users' `/wallets`.

The `DATABASE_PATH` SQLite database (default `./data/leonidas.sqlite`) stores login time and user-configured public addresses. On first start, existing login-time rows are copied from the old `ECONOMY_DATABASE_PATH` (default `./data/economy.sqlite`) into the new database. The old database and its WAL/SHM files are not modified or deleted. The local `.env` is not changed by this migration.

## AI and login time

`/ask`, `+ask`, `/summarize`, `+summarize`, and the `1tf` reply trigger use the configured OpenAI Chat Completions model. Requests do not retain conversation history. Answers are limited to Discord's 2,000-character message limit.

`/log` and `+log` track login sessions and weekly totals. Weeks run from Monday 00:00 through Sunday in `TIMEZONE` (default `UTC`). Reset actions require button confirmation. Resetting your own totals is available to the requesting user; resetting everyone’s totals requires Administrator permission both to start and confirm the reset.

## Tests

Run the command and feature suite before deploying:

```sh
npm.cmd run test
```

The suite covers command definitions and routing, public crypto balance behavior, wallet persistence, OpenAI and CoinGecko error paths, login-time storage, calculator behavior, ticket-payment handling, and user checks.
