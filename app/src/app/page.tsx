"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Connection, Transaction, TransactionInstruction } from "@solana/web3.js";
import { Coins, Shield, Timer, Zap } from "lucide-react";
import { buyIx, claimIx, createGameIxs, delegateIx, fetchGame, flipIx, GameState, joinIx, pda, resolveErEndpoint, simpleGameIx, undelegateIx } from "@/lib/program";
const initialBoxes = Array.from({ length: 100 }, (_, i) => (i * 37 + 11) % 7 < 3);
const fmt = (raw: bigint) => (Number(raw) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 });
export default function Home() {
  const { connection } = useConnection(); const wallet = useWallet(); const [gameId, setGameId] = useState("0");
  const [game, setGame] = useState<GameState | null>(null); const [message, setMessage] = useState("选择一局游戏，连接钱包后加入战场。"); const [busy, setBusy] = useState(false);
  const id = useMemo(() => BigInt(gameId || "0"), [gameId]);
  const refresh = useCallback(async () => { const next = await fetchGame(connection, id); setGame(next); if (!next) setMessage(`尚未找到 #${id} 游戏。`); }, [connection, id]);
  useEffect(() => { const timer = setInterval(refresh, 2500); return () => clearInterval(timer); }, [refresh]);
  const send = async (label: string, instruction: TransactionInstruction | TransactionInstruction[], er = false) => {
    if (!wallet.publicKey || !wallet.sendTransaction) return setMessage("请先连接钱包。"); setBusy(true);
    try { const endpoint = er ? await resolveErEndpoint(pda.game(id)) : null; const target = endpoint ? new Connection(endpoint, "confirmed") : connection; const signature = await wallet.sendTransaction(new Transaction().add(...(Array.isArray(instruction) ? instruction : [instruction])), target, { preflightCommitment: "confirmed", skipPreflight: er }); await target.confirmTransaction(signature, "confirmed"); setMessage(`${label}成功：${signature.slice(0, 12)}…${er ? "（ER）" : ""}`); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "交易失败"); } finally { setBusy(false); }
  };
  const boxes = game?.boxes ?? initialBoxes;
  return <main>
    <header className="topbar"><div className="brand"><span className="brand-mark">FV</span><div><strong>FLIP VAULT</strong><small>POWERED BY MAGICBLOCK</small></div></div><WalletMultiButton /></header>
    <section className="hero"><div><p className="eyebrow">REAL-TIME ONCHAIN ARENA</p><h1>翻转阵营。<br/><span>夺取金库。</span></h1><p className="lede">100 个箱子、红绿两方、五分钟实时对抗。每一次翻转都让奖池继续增长。</p></div><div className="rate"><Coins size={20}/><span>固定测试兑换率</span><strong>1 GAME = 0.001 SOL</strong></div></section>
    <section className="stats"><article><Shield/><span>参与玩家</span><strong>{game?.playerCount ?? 0}<small>/100</small></strong></article><article className="red"><span className="dot"/><span>红方箱子</span><strong>{game?.redBoxes ?? boxes.filter(Boolean).length}</strong></article><article className="green"><span className="dot"/><span>绿方箱子</span><strong>{game?.greenBoxes ?? boxes.filter(x => !x).length}</strong></article><article><Coins/><span>实时奖池</span><strong>{fmt(game?.pool ?? BigInt(0))} <small>GAME</small></strong></article></section>
    <section className="arena"><div className="arena-head"><div><p className="eyebrow">GAME CONTROL</p><h2>箱阵 #{gameId}</h2></div><div className="game-search"><label htmlFor="game">游戏编号</label><input id="game" value={gameId} inputMode="numeric" onChange={e => setGameId(e.target.value.replace(/\D/g, ""))}/><button onClick={refresh}>读取</button></div></div>
      <div className="board" aria-label="10乘10翻箱棋盘">{boxes.map((red, index) => <button key={index} aria-label={`翻转第 ${index + 1} 个${red ? "红" : "绿"}色箱子`} disabled={busy || !game} className={red ? "box redbox" : "box greenbox"} onClick={() => wallet.publicKey && send("翻转", flipIx(wallet.publicKey, id, index), true)}><span>{index + 1}</span></button>)}</div><div className="status" role="status"><Zap size={18}/>{message}</div>
    </section>
    <aside className="panel"><div><p className="eyebrow">YOUR COMMAND</p><h2>加入战局</h2><p>保证金 100 GAME，默认预存 100 GAME 点击额度。未使用额度在结算后退回。</p></div><div className="actions">
      <button disabled={busy || !wallet.publicKey} onClick={() => wallet.publicKey && send("购买 200 GAME", buyIx(wallet.publicKey, BigInt(200)))}>购买 200 GAME</button>
      <button className="secondary" disabled={busy || !wallet.publicKey} onClick={() => wallet.publicKey && send("创建游戏", createGameIxs(wallet.publicKey, id))}>创建当前编号游戏</button>
      <button disabled={busy || !wallet.publicKey || !game} onClick={() => wallet.publicKey && send("加入游戏", joinIx(wallet.publicKey, id, BigInt(100)))}>支付并加入</button>
      <button className="secondary" disabled={busy || !wallet.publicKey || !game} onClick={() => wallet.publicKey && send("委托玩家状态", delegateIx(wallet.publicKey, id, 1))}>委托我的玩家状态</button>
      <button className="secondary" disabled={busy || !wallet.publicKey || !game} onClick={() => wallet.publicKey && send("委托游戏状态", delegateIx(wallet.publicKey, id, 0))}>房主委托游戏状态</button>
      <button className="secondary" disabled={busy || !wallet.publicKey || !game} onClick={() => wallet.publicKey && send("开始游戏", simpleGameIx(5, wallet.publicKey, id), true)}>开始游戏</button>
      <button className="secondary" disabled={busy || !wallet.publicKey || !game} onClick={() => wallet.publicKey && send("结算游戏", simpleGameIx(7, wallet.publicKey, id), true)}>触发结算</button>
      <button className="secondary" disabled={busy || !wallet.publicKey || !game} onClick={() => wallet.publicKey && send("提交游戏状态", undelegateIx(wallet.publicKey, pda.game(id)), true)}>提交并解除委托</button>
      <button className="secondary" disabled={busy || !wallet.publicKey || !game} onClick={() => wallet.publicKey && send("提交玩家状态", undelegateIx(wallet.publicKey, pda.player(pda.game(id), wallet.publicKey)), true)}>提交我的玩家状态</button>
      <button className="secondary" disabled={busy || !wallet.publicKey || !game} onClick={() => wallet.publicKey && send("领取奖励", claimIx(wallet.publicKey, id))}>领取奖励 / 退款</button>
    </div><div className="timeline"><Timer/><div><span>链上时间</span><strong>{game ? new Date(Number(game.endAt) * 1000).toLocaleString() : "等待游戏"}</strong></div></div><dl><div><dt>红方玩家</dt><dd>{game?.redPlayers ?? 0}</dd></div><div><dt>绿方玩家</dt><dd>{game?.greenPlayers ?? 0}</dd></div><div><dt>累计翻转</dt><dd>{game?.flips.toString() ?? "0"}</dd></div></dl></aside>
    <footer>Devnet playground · Program <code>ADTf…Qe8i</code> · 资产仅用于测试</footer>
  </main>;
}
