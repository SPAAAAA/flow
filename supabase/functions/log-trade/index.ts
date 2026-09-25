// FLOW log-trade: records a member's swap ONLY after reading it from the Solana blockchain.
// The member must be signed in, the transaction must be signed/paid by their wallet,
// and the SOL + token amounts are taken from the chain, never from the browser.
import { createClient } from "npm:@supabase/supabase-js@2";

const RPC = Deno.env.get("SOLANA_RPC") ?? "https://solana-rpc.publicnode.com";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const B58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getTx(sig: string) {
  for (let i = 0; i < 8; i++) {
    try {
      const r = await fetch(RPC, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }] }),
      });
      const j = await r.json();
      if (j.result) return j.result;
    } catch (_) { /* retry */ }
    await sleep(2500);
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const { signature, mint, symbol } = await req.json();
    if (typeof signature !== "string" || !B58.test(signature) || signature.length < 64 || signature.length > 90) return json({ error: "bad signature" }, 400);
    if (typeof mint !== "string" || !B58.test(mint) || mint.length < 32 || mint.length > 44) return json({ error: "bad mint" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await admin.auth.getUser(jwt);
    if (!u?.user) return json({ error: "not signed in" }, 401);
    const { data: prof } = await admin.from("profiles").select("id,wallet").eq("id", u.user.id).single();
    if (!prof) return json({ error: "no profile" }, 400);

    const { data: dup } = await admin.from("trades").select("id,side,sol_amount,tokens").eq("signature", signature).maybeSingle();
    if (dup) return json({ ok: true, trade: dup, duplicate: true });

    const tx = await getTx(signature);
    if (!tx) return json({ error: "transaction not found yet" }, 404);
    if (tx.meta?.err) return json({ error: "transaction failed on-chain" }, 400);
    if (tx.blockTime && Date.now() / 1000 - tx.blockTime > 86400) return json({ error: "transaction is older than 24h" }, 400);

    const keys: string[] = tx.transaction.message.accountKeys.map((k: any) => (typeof k === "string" ? k : k.pubkey));
    if (keys[0] !== prof.wallet) return json({ error: "this transaction was not made by your wallet" }, 403);

    const mine = (arr: any[] | undefined) => (arr || []).filter((b) => b.mint === mint && b.owner === prof.wallet);
    const sum = (arr: any[]) => arr.reduce((s, b) => s + Number(b.uiTokenAmount?.uiAmountString || 0), 0);
    const preT = mine(tx.meta.preTokenBalances), postT = mine(tx.meta.postTokenBalances);
    const dTok = sum(postT) - sum(preT);
    if (!dTok) return json({ error: "no change in that token" }, 400);
    const side = dTok > 0 ? "buy" : "sell";

    // SOL moved by the swap = wallet balance change, excluding the network fee
    let dSol = (tx.meta.postBalances[0] - tx.meta.preBalances[0] + tx.meta.fee) / 1e9;
    // a buy may create the token account (≈0.00204 SOL rent, refundable) — that isn't a cost of the coin
    if (side === "buy" && !preT.length && postT.length) dSol += 0.00203928;
    const sol = Math.max(0, side === "buy" ? -dSol : dSol);

    const row = {
      user_id: prof.id, mint, symbol: typeof symbol === "string" ? symbol.slice(0, 20) || null : null, side,
      sol_amount: Number(sol.toFixed(6)), tokens: Math.abs(dTok), signature, verified: true,
      created_at: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : new Date().toISOString(),
    };
    const { data, error } = await admin.from("trades").insert(row).select("id,side,sol_amount,tokens").single();
    if (error) return json({ error: error.code === "23505" ? "already recorded" : error.message }, error.code === "23505" ? 200 : 500);
    return json({ ok: true, trade: data });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
