/* FLOW — about / FAQ / terms */
(function () {
  const F = FLOW, CFG = F.cfg, N = F.esc(CFG.siteName);
  F.layout("about");
  const fee = CFG.platformFeeBps > 0 && CFG.feeAccount ? `${CFG.platformFeeBps / 100}%` : "0%";
  const faq = [
    ["What is " + N + "?", `${N} is a trading front-end for live Solana meme coins. It shows what's trending, new and about to graduate from the pump.fun bonding curve, and lets you buy and sell directly from your own wallet.`],
    ["Can I create a coin on " + N + "?", `No. ${N} is for discovering and trading existing coins only.`],
    ["Does " + N + " hold my money?", `No. ${N} never has custody of your funds or your keys. Every trade is a transaction you review and sign in your own wallet (Phantom, Solflare or Backpack).`],
    ["Where do trades happen?", `Trades are routed by Jupiter, Solana's swap aggregator, which finds the best price across Solana DEXes — including pump.fun bonding curves, PumpSwap, Raydium, Meteora and Orca.`],
    ["What does it cost?", `${N} fee: ${fee}. You also pay Solana network fees (usually a fraction of a cent, plus a small priority fee so trades land quickly) and any fees charged by the DEX your trade routes through.`],
    ["What is the bonding curve?", `New pump.fun coins trade on a bonding curve. The price rises automatically as people buy. When the market cap reaches the graduation threshold, liquidity moves to PumpSwap and the coin “graduates”. ${N} shows an estimated progress bar for coins still on the curve.`],
    ["Why did my trade fail?", `Usually the price moved more than your slippage setting before your transaction landed. Try again, raise slippage a little, or trade a smaller amount. Make sure you keep some SOL for network fees.`],
    ["Where does the data come from?", `Coin lists and prices come from DEX Screener, charts and trades from GeckoTerminal, token checks from Jupiter, and balances from the Solana blockchain. Data can be delayed or wrong. Always double-check the contract address.`],
    ["Why can't I see my coin?", `${N} shows coins that are trending or recently active. You can always open any coin by pasting its contract address into the search bar.`],
  ];
  F.$("#about").innerHTML = `<div class="prose">
    <h1>How ${N} works</h1>
    <p>${F.esc(CFG.tagline)} No sign-ups, no deposits. Connect your wallet and trade.</p>
    <div class="steps">
      <div class="step"><div class="n">1</div><b>Find a coin</b><p>Browse trending, new and graduating coins, or paste a contract address.</p></div>
      <div class="step"><div class="n">2</div><b>Connect your wallet</b><p>Phantom, Solflare or Backpack. Your keys never leave your wallet.</p></div>
      <div class="step"><div class="n">3</div><b>Buy or sell</b><p>Enter an amount, check the quote and price impact, then confirm in your wallet.</p></div>
      <div class="step"><div class="n">4</div><b>Track it</b><p>Watchlist coins and follow your portfolio on your profile page.</p></div>
    </div>

    <h2 id="faq">FAQ</h2>
    ${faq.map(([q, a]) => `<details class="faq"><summary>${q}</summary><p>${a}</p></details>`).join("")}

    <h2 id="risk">Risk warning</h2>
    <div class="callout"><p style="margin:0">Meme coins are highly speculative and have no intrinsic value. Prices can drop to zero in minutes. Many coins are created by anonymous people and can be abandoned or manipulated (“rug pulls”). Anyone can launch a coin with any name or image, so a coin appearing on ${N} is <b>not</b> an endorsement. Never trade money you can't afford to lose, and never share your seed phrase. ${N} will never ask for it.</p></div>

    <h2 id="terms">Terms of use</h2>
    <p>By using ${N} you agree that: (1) ${N} is a non-custodial interface to public blockchain protocols and third-party services and does not execute, hold or control trades or funds; (2) you are 18 or older and legally allowed to use crypto-asset services where you live; (3) you are solely responsible for your transactions, the security of your wallet and any taxes owed; (4) information shown on ${N} is provided “as is”, may be inaccurate or delayed, and is not financial, investment or legal advice; (5) ${N} is not liable for any losses from using the site, from third-party protocols, or from the coins themselves; (6) you won't use ${N} for anything illegal, including market manipulation or sanctioned activity.</p>
    <p class="muted">Last updated ${new Date().toISOString().slice(0, 10)}.</p>
  </div>`;
  if (location.hash) setTimeout(() => F.$(location.hash)?.scrollIntoView(), 50);
})();
