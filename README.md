# FLOW

A pump.fun-style site for discovering and trading live Solana meme coins, with a blue accent. Users connect their own wallet (Phantom, Solflare or Backpack) and trade through Jupiter. FLOW never holds anyone's funds. Coin creation is not included on purpose.

It's a static site (plain HTML, CSS and JavaScript) with no build step, so it runs on **GitHub Pages** as-is.

## Pages

| Page | What it does |
|---|---|
| `index.html` | "Now trending" strip, then a live coin grid or list with tabs: Trending, New, About to graduate, Top gainers, Market cap, Volume, Watchlist. Also has a pump.fun-only filter and a liquidity filter. Refreshes every 30 s. |
| `coin.html?c=<mint>` | Candle chart (1m to 1D), price stats, trades feed, top holders, about/links, token safety checks, bonding-curve progress, your position, and the **Buy/Sell panel** (quick amounts, % sell buttons, slippage, live quote, price impact, route). |
| `profile.html?a=<wallet>` | Any wallet's portfolio value, SOL balance, coins held (with values), and recent activity. Without `?a=` it shows the connected wallet. |
| `leaderboard.html` | Top market cap, top gainers, most traded, and top traders (most active wallets across recent trades on the hottest coins). |
| `about.html` | How it works, FAQ, risk warning, and terms. |

The search bar (press `/`) finds coins by name or ticker. You can also paste any contract or wallet address into it.

## Put it online (GitHub Pages)

1. Create a repository on GitHub, for example `flow`.
2. Upload **everything in this folder** to the root of the repo, including the hidden `.nojekyll` file. You can drag and drop the files on github.com, or run:
   ```bash
   git init && git add . && git commit -m "FLOW"
   git branch -M main
   git remote add origin https://github.com/<you>/flow.git
   git push -u origin main
   ```
3. On GitHub, open the repo's **Settings → Pages**. Under **Source**, choose *Deploy from a branch*, then *main* and */ (root)*, and click **Save**.
4. After about a minute the site is live at `https://<you>.github.io/flow/`. To use your own domain, set it in the same Pages screen.

## Required: add a Solana RPC key (free, 2 minutes)

The public Solana endpoint **blocks requests from browsers**. Without your own endpoint these features show a notice instead of data: top holders, profile activity, and trade confirmation. Trading itself still works, because the wallet sends the transaction.

1. Sign up at <https://www.helius.dev> (the free plan is enough to start).
2. Copy your mainnet RPC URL. It looks like `https://mainnet.helius-rpc.com/?api-key=…`
3. Paste it into `assets/js/config.js` as `rpcUrl`.
4. In the Helius dashboard, restrict the key to your site's domain (for example `you.github.io`), so nobody else can use up your quota. The key is visible in the site's source, which is normal for browser RPC keys. The domain restriction is what protects it.

## Chat, profiles and online members (Supabase)

The global chat, editable names and profile pictures, and the **Online members** leaderboard tab all run on a free Supabase project, which is already connected in `config.js`.

- Users sign in by signing a free message in their wallet (Sign in with Solana). This proves they own the wallet, so nobody can post under someone else's name or edit their profile.
- The database layout and security rules are in `supabase/schema.sql`. Run it again in the Supabase SQL Editor if you ever start a fresh project.
- **Make yourself admin**, so you can delete any chat message. First sign in on FLOW once, then run this in the SQL Editor:
  `update public.profiles set is_admin = true where wallet = 'YOUR_WALLET';`
- **Ban someone:** `update public.profiles set banned = true where wallet = 'THEIR_WALLET';`
- Chat has a 3-second slow mode. Messages can be up to 400 characters, and profile pictures are resized to 256 px.
- Free-plan projects pause after about a week with no visitors. Open the Supabase dashboard to resume it.

## Settings (`assets/js/config.js`)

| Setting | Meaning |
|---|---|
| `siteName`, `tagline` | Branding |
| `rpcUrl` | Your Solana RPC (see above) |
| `jupiterBase`, `jupiterApiKey` | The free Jupiter tier works out of the box. For higher traffic, get a key at <https://portal.jup.ag> and switch the base to `https://api.jup.ag/swap/v1`. |
| `platformFeeBps`, `feeAccount` | Optional FLOW fee per trade (100 = 1%). See below. |
| `defaultSlippageBps` | Default slippage (500 = 5%) |
| `quickBuys` | Quick-buy buttons, in SOL |
| `featured` | Mint addresses to pin at the top of the home page |
| `blocklist` | Mint addresses to hide (scams, impersonators) |
| `graduationMcapUsd` | Market cap used to draw the bonding-curve progress bar |
| `socials` | Links to your X, Telegram and Discord, shown in the sidebar |

To change colors, edit the variables at the top of `assets/css/style.css`. `--accent` is the blue.

## Earning fees (optional)

Jupiter lets front-ends add a platform fee to each swap:

1. Create a referral account at <https://referral.jup.ag> and create a fee token account for **SOL** (wrapped SOL). Every trade touches SOL, so this one account collects fees on both buys and sells.
2. Put that token account address in `feeAccount`, and set `platformFeeBps` (for example `100` for 1%).
3. Check Jupiter's current docs before going live, because the fee setup has changed over time.

The FAQ and the trade panel show the fee to users automatically.

## Where the data comes from

- **DEX Screener**: trending, boosted and new coins, prices, market cap, liquidity, volume, and search
- **GeckoTerminal**: chart candles and the live trades feed. If candles are unavailable, the chart falls back to DEX Screener's embedded chart.
- **Jupiter**: swap quotes and transactions (routes across pump.fun, PumpSwap, Raydium, Meteora, Orca and more), token safety checks, holder counts, and wallet holdings
- **Your RPC**: top holders, activity, and confirmations

All of these are free public APIs with rate limits. For a large audience, consider paid tiers or a small caching backend.

## Things to know before launch

- **Legal:** in the EU, and in the Netherlands in particular, offering crypto trading services can fall under MiCA or AFM rules, especially if you charge fees. Get advice from a lawyer before launching publicly. The terms on `about.html` are a starting template, not legal advice.
- Test with small amounts first. Phantom works best on desktop, and on mobile inside Phantom's built-in browser.
