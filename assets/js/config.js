/* =========================================================
   FLOW — site configuration
   This is the ONLY file you normally need to edit.
   ========================================================= */
window.FLOW_CONFIG = {
  siteName: "FLOW",
  tagline: "Trade Solana meme coins at the speed of flow.",

  // Solana RPC endpoint — used for wallet balances, holders and confirmations.
  // The free public endpoint below is heavily rate-limited and often blocks
  // browsers. Get a free key at https://www.helius.dev and paste the URL here:
  //   "https://mainnet.helius-rpc.com/?api-key=YOUR_KEY"
  // In the Helius dashboard, restrict the key to your site's domain.
  rpcUrl: "https://api.mainnet-beta.solana.com",

  // Jupiter swap API — routes every trade across all Solana DEXes
  // (including pump.fun bonding curves and PumpSwap).
  //   Free tier : https://lite-api.jup.ag/swap/v1   (no key)
  //   With key  : https://api.jup.ag/swap/v1        (key from https://portal.jup.ag)
  jupiterBase: "https://lite-api.jup.ag/swap/v1",
  jupiterApiKey: "",

  // Optional FLOW fee on each trade, in basis points (100 = 1%). 0 = no fee.
  // Requires a Jupiter referral fee account — see README → "Earning fees".
  platformFeeBps: 0,
  feeAccount: "",

  // Default slippage in basis points (500 = 5%). Users can change it per trade.
  defaultSlippageBps: 500,

  // Quick-buy buttons on the trade panel (SOL)
  quickBuys: [0.1, 0.5, 1, 5],

  // Mint addresses you never want shown (scams, impersonators…)
  blocklist: [],

  // Mint addresses always pinned at the top of the home page
  featured: [],

  // Approx. market cap (USD) at which a pump.fun bonding-curve coin graduates.
  // Only used to draw progress bars for coins still on the curve.
  graduationMcapUsd: 69000,

  // Supabase (global chat, member profiles, who's online).
  // From your Supabase project → Project Settings → API. The anon/publishable
  // key is safe to put in the browser — access is protected by the database rules.
  supabaseUrl: "https://jdsgoxjnavuyyvnrwosw.supabase.co",
  supabaseAnonKey: "sb_publishable_3sQSPPULWJjuxqFpcDXLpA_XT9bH63M",

  // Wallets that get the FOUNDER badge (only editable here in the repo)
  founders: ["5ZfqZdmid5jMVixfTZULPNvzRKtxxfCXYW6Xn8E6yDn7"],

  // Social links in the sidebar (leave "" to hide)
  socials: { x: "", telegram: "", discord: "" }
};
