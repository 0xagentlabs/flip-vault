"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Connection, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  Coins,
  Shield,
  Timer,
  Zap,
  Trophy,
  Swords,
  Users,
  Clock,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  PlusCircle,
  ArrowRight,
  ExternalLink,
  Layers,
} from "lucide-react";
import {
  buyIxs,
  claimIx,
  createGameIxs,
  delegateIx,
  fetchAllGames,
  fetchBalances,
  fetchGame,
  findAvailableGameId,
  fetchPlayer,
  flipIx,
  GameState,
  joinIx,
  pda,
  PlayerState,
  resolveErEndpoint,
  simpleGameIx,
  undelegateIx,
  PROGRAM_ID,
} from "@/lib/program";

const initialBoxes = Array.from({ length: 100 }, (_, i) => (i * 37 + 11) % 7 < 3);
const fmtToken = (raw: bigint | number) => (Number(raw) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 });
const fmtDateTime = (timestamp?: bigint) => {
  if (timestamp === undefined) return "--";
  return new Date(Number(timestamp) * 1000).toLocaleString("zh-CN", { hour12: false });
};
const fmtDuration = (seconds: bigint) => {
  const total = Math.max(0, Number(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes} 分 ${remainder} 秒`;
};
const toDateTimeLocalValue = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

const subscribeClock = (callback: () => void) => {
  const timer = setInterval(callback, 1000);
  return () => clearInterval(timer);
};
const getClockSnapshot = () => Math.floor(Date.now() / 1000);
const getServerClockSnapshot = () => 0;

const STEPS = [
  { step: 1, title: "发起游戏", desc: "创建专属战局房间" },
  { step: 2, title: "游戏列表", desc: "浏览大厅实时对局" },
  { step: 3, title: "加入游戏", desc: "押注保证金与阵营" },
  { step: 4, title: "等待游戏", desc: "组队等待满员起开" },
  { step: 5, title: "开始游戏", desc: "10×10 翻箱实时竞逐" },
  { step: 6, title: "结算游戏", desc: "按阵营分红瓜分金库" },
];

export default function Home() {
  const { connection } = useConnection();
  const wallet = useWallet();

  // Navigation & View state
  const [viewTab, setViewTab] = useState<"lobby" | "arena">("lobby");
  const [selectedGameId, setSelectedGameId] = useState<string>("0");
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [showBuyModal, setShowBuyModal] = useState<boolean>(false);

  // Data states
  const [games, setGames] = useState<GameState[]>([]);
  const gamesRef = useRef<GameState[]>([]);
  const [game, setGame] = useState<GameState | null>(null);
  const [player, setPlayer] = useState<PlayerState | null>(null);
  const [balances, setBalances] = useState<{ sol: number; game: bigint }>({ sol: 0, game: 0n });
  const [busy, setBusy] = useState<boolean>(false);
  const [loadingGames, setLoadingGames] = useState<boolean>(false);
  const [erEndpoint, setErEndpoint] = useState<string | null>(null);
  const [playerErEndpoint, setPlayerErEndpoint] = useState<string | null>(null);
  const [useEr, setUseEr] = useState<boolean>(false);

  // Optimistic board states
  const [optimisticBoxes, setOptimisticBoxes] = useState<boolean[] | null>(null);

  // Forms
  const [buyAmountInput, setBuyAmountInput] = useState<string>("200");
  const [selectedCredits, setSelectedCredits] = useState<number>(100);
  const [customCredits, setCustomCredits] = useState<string>("");
  const [listFilter, setListFilter] = useState<"all" | "recruiting" | "active" | "finalized">("all");
  const [searchIdInput, setSearchIdInput] = useState<string>("");
  const [gameStartInput, setGameStartInput] = useState<string>(() => toDateTimeLocalValue(new Date(Date.now() + 5 * 60_000)));

  const nowSec = useSyncExternalStore(subscribeClock, getClockSnapshot, getServerClockSnapshot);

  // Notification state
  const [notice, setNotice] = useState<{ type: "info" | "success" | "error"; text: string; tx?: string }>({
    type: "info",
    text: "欢迎来到 Flip Vault！请连接 Devnet 钱包开始体验。",
  });

  let currentId = 0n;
  try {
    currentId = BigInt(selectedGameId || "0");
  } catch {
    currentId = 0n;
  }

  // Derive highest game ID to suggest next ID
  let maxGameId = 0n;
  for (const g of games) {
    if (g.id > maxGameId) maxGameId = g.id;
  }
  const suggestedGameId = (maxGameId + 1n).toString();

  useEffect(() => {
    gamesRef.current = games;
    if (games.length > 0) localStorage.setItem("flip-vault-known-games", JSON.stringify(games.map((item) => item.id.toString())));
  }, [games]);

  // Poll lobby & balances
  useEffect(() => {
    let active = true;
    const fetchLobbyData = async () => {
      try {
        const storedIds = JSON.parse(localStorage.getItem("flip-vault-known-games") ?? "[]") as string[];
        const knownIds = [...gamesRef.current.map((item) => item.id), ...storedIds.map((id) => BigInt(id))];
        const all = await fetchAllGames(connection, knownIds);
        if (active) setGames(all);
      } catch (err) {
        console.error("Failed to load lobby games", err);
      }
      if (wallet.publicKey) {
        try {
          const b = await fetchBalances(connection, wallet.publicKey);
          if (active) setBalances(b);
        } catch (err) {
          console.error("Failed to load balances", err);
        }
      }
    };
    fetchLobbyData();
    const timer = setInterval(fetchLobbyData, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [connection, wallet.publicKey]);

  // Poll current game & player
  useEffect(() => {
    let active = true;
    const fetchCurrentData = async () => {
      try {
        const g = await fetchGame(connection, currentId);
        if (!active) return;
        setGame(g);
        if (g) {
          setOptimisticBoxes(null);
          try {
            const endpoint = await resolveErEndpoint(pda.game(currentId));
            if (active) setErEndpoint(endpoint);
          } catch {
            if (active) setErEndpoint(null);
          }
        }
      } catch (err) {
        console.error("Failed to fetch game", err);
      }
      if (wallet.publicKey) {
        try {
          const p = await fetchPlayer(connection, currentId, wallet.publicKey);
          if (active) setPlayer(p);
          const playerEndpoint = await resolveErEndpoint(pda.player(pda.game(currentId), wallet.publicKey));
          if (active) setPlayerErEndpoint(playerEndpoint);
        } catch {
          if (active) {
            setPlayer(null);
            setPlayerErEndpoint(null);
          }
        }
      } else {
        if (active) setPlayer(null);
      }
    };
    fetchCurrentData();
    const timer = setInterval(fetchCurrentData, 2500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [connection, currentId, wallet.publicKey]);

  const refreshAll = useCallback(async () => {
    setLoadingGames(true);
    try {
      const all = await fetchAllGames(connection, gamesRef.current.map((item) => item.id));
      setGames(all);
      const g = await fetchGame(connection, currentId);
      setGame(g);
      if (wallet.publicKey) {
        const [p, b] = await Promise.all([
          fetchPlayer(connection, currentId, wallet.publicKey),
          fetchBalances(connection, wallet.publicKey),
        ]);
        setPlayer(p);
        setBalances(b);
      }
    } finally {
      setLoadingGames(false);
    }
  }, [connection, currentId, wallet.publicKey]);

  // Transaction runner
  const send = async (
    label: string,
    instructions: TransactionInstruction | TransactionInstruction[],
    targetEr = false
  ) => {
    if (!wallet.publicKey || !wallet.sendTransaction) {
      setNotice({ type: "error", text: "请先在右上角连接 Solana Devnet 钱包。" });
      return;
    }
    setBusy(true);
    setNotice({ type: "info", text: `正在提交【${label}】事务，请在钱包中确认...` });
    try {
      const endpoint = targetEr && erEndpoint ? erEndpoint : null;
      const targetConn = endpoint ? new Connection(endpoint, "confirmed") : connection;
      const ixs = Array.isArray(instructions) ? instructions : [instructions];
      const tx = new Transaction().add(...ixs);
      const sig = await wallet.sendTransaction(tx, targetConn, {
        preflightCommitment: "confirmed",
        skipPreflight: !!endpoint,
      });
      await targetConn.confirmTransaction(sig, "confirmed");
      setNotice({
        type: "success",
        text: `【${label}】执行成功！${endpoint ? "（通过 MagicBlock ER 毫秒通道）" : "（Solana Devnet）"}`,
        tx: sig,
      });
      await refreshAll();
    } catch (error) {
      console.error(error);
      const msg = error instanceof Error ? error.message : "交易提交失败";
      setNotice({ type: "error", text: `【${label}】失败：${msg}` });
      setOptimisticBoxes(null);
    } finally {
      setBusy(false);
    }
  };

  // Determine current active step (1..6)
  const currentStep = useMemo(() => {
    if (showCreateModal) return 1;
    if (viewTab === "lobby") return 2;
    if (!game) return 2;
    if (game.status === 0) {
      return player ? 4 : 3;
    }
    if (game.status === 1) return 5;
    if (game.status === 2) return 6;
    return 2;
  }, [showCreateModal, viewTab, game, player]);

  // Filtered games in lobby
  const filteredGames = useMemo(() => {
    return games.filter((g) => {
      if (searchIdInput.trim()) {
        if (!g.id.toString().includes(searchIdInput.trim())) return false;
      }
      if (listFilter === "recruiting") return g.status === 0;
      if (listFilter === "active") return g.status === 1;
      if (listFilter === "finalized") return g.status === 2;
      return true;
    });
  }, [games, listFilter, searchIdInput]);

  // Compute countdowns using nowSec state
  const playTimeRemaining =
    game && game.status === 1 && nowSec > 0 ? Math.max(0, Number(game.endAt) - nowSec) : null;

  const joinTimeRemaining =
    game && game.status === 0 && game.startAt && nowSec > 0
      ? Math.max(0, Number(game.startAt) - nowSec)
      : null;
  const joinIsOpen = Boolean(game && game.status === 0 && game.startAt && nowSec > 0 && nowSec < Number(game.startAt));

  // Box grid data
  const currentBoxes = optimisticBoxes ?? game?.boxes ?? initialBoxes;
  const redCount = game?.redBoxes ?? currentBoxes.filter(Boolean).length;
  const greenCount = game?.greenBoxes ?? currentBoxes.filter((x) => !x).length;
  const redPercent = Math.round((redCount / 100) * 100);
  const greenPercent = 100 - redPercent;

  // Handle Box Click
  const handleBoxClick = (index: number) => {
    if (!wallet.publicKey || busy || !game || game.status !== 1) return;
    // Optimistic toggle
    const nextBoxes = [...currentBoxes];
    nextBoxes[index] = !nextBoxes[index];
    setOptimisticBoxes(nextBoxes);

    // Send instruction
    send(`翻转 #${index + 1} 号箱`, flipIx(wallet.publicKey, currentId, index), useEr);
  };

  // Handle Step Click
  const handleStepClick = (stepNum: number) => {
    if (stepNum === 1) {
      setShowCreateModal(true);
    } else if (stepNum === 2) {
      setViewTab("lobby");
      setShowCreateModal(false);
    } else {
      setViewTab("arena");
      setShowCreateModal(false);
    }
  };

  // Credits calculation
  const creditsToBuy = customCredits ? parseInt(customCredits, 10) || 0 : selectedCredits;
  const totalGameTokensNeeded = 30 + creditsToBuy;

  return (
    <div className="main-container">
      {/* Topbar */}
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">FV</div>
          <div>
            <strong>FLIP VAULT</strong>
            <small>SOLANA DEVNET × MAGICBLOCK ER</small>
          </div>
        </div>

        <div className="top-actions">
          {wallet.publicKey && (
            <div className="wallet-badge">
              <div className="token-item">
                <Coins size={15} color="#f59e0b" />
                <span>SOL:</span>
                <strong>{(balances.sol / 1e9).toFixed(3)}</strong>
              </div>
              <div className="token-item">
                <Sparkles size={15} color="#22c55e" />
                <span>GAME:</span>
                <strong>{fmtToken(balances.game)}</strong>
              </div>
              <button
                className="btn-secondary"
                style={{ padding: "4px 10px", fontSize: "11px", height: "auto" }}
                onClick={() => setShowBuyModal(true)}
              >
                + 充值代币
              </button>
            </div>
          )}
          <WalletMultiButton />
        </div>
      </header>

      {/* 6-Step Visual Stepper Bar */}
      <nav className="stepper-container" aria-label="游戏操作流程">
        <div className="stepper-header">
          <span>全流程游戏向导 (6 大阶段)</span>
          <span>当前阶段：第 {currentStep} 步 - {STEPS[currentStep - 1].title}</span>
        </div>
        <div className="stepper-bar">
          {STEPS.map((s) => {
            const isActive = currentStep === s.step;
            const isPassed = currentStep > s.step;
            return (
              <button
                key={s.step}
                type="button"
                className={`step-node ${isActive ? "active" : ""} ${isPassed ? "passed" : ""}`}
                onClick={() => handleStepClick(s.step)}
              >
                <div className="step-num">{s.step}</div>
                <div className="step-text">
                  <span className="step-title">{s.title}</span>
                  <span className="step-desc">{s.desc}</span>
                </div>
              </button>
            );
          })}
        </div>
      </nav>

      {/* View Tabs */}
      <div className="view-nav">
        <button
          className={`nav-tab-btn ${viewTab === "lobby" ? "active" : ""}`}
          onClick={() => setViewTab("lobby")}
        >
          <Layers size={16} />
          游戏大厅 (游戏列表 & 发起)
        </button>
        <button
          className={`nav-tab-btn ${viewTab === "arena" ? "active" : ""}`}
          onClick={() => setViewTab("arena")}
        >
          <Swords size={16} />
          当前战局中心 {game ? `(#${currentId})` : ""}
        </button>
        <button
          className="btn-primary"
          style={{ marginLeft: "auto", padding: "8px 16px", fontSize: "13px" }}
          onClick={() => setShowCreateModal(true)}
        >
          <PlusCircle size={15} />
          发起新游戏 (Step 1)
        </button>
      </div>

      {/* Notification Banner */}
      {notice && (
        <div className={`status-banner ${notice.type}`} role="status">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {notice.type === "success" ? (
              <CheckCircle2 size={18} />
            ) : notice.type === "error" ? (
              <AlertCircle size={18} />
            ) : (
              <Zap size={18} />
            )}
            <span>{notice.text}</span>
          </div>
          {notice.tx && (
            <a
              href={`https://solscan.io/tx/${notice.tx}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
              style={{
                color: "inherit",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                textDecoration: "underline",
                fontSize: "12px",
              }}
            >
              Solscan 浏览器 <ExternalLink size={12} />
            </a>
          )}
        </div>
      )}

      {/* VIEW: LOBBY & GAME LIST (Step 2) */}
      {viewTab === "lobby" && (
        <section style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* Hero Banner */}
          <div className="hero-box">
            <div>
              <p style={{ margin: 0, fontSize: "11px", letterSpacing: "0.2em", color: "#86efac", fontWeight: 700 }}>
                10×10 ONCHAIN ARENA · POWERED BY MAGICBLOCK
              </p>
              <h1>
                翻转红绿阵营。<span>瓜分金库大奖。</span>
              </h1>
              <p>
                100 个神秘箱子、红绿两方势均力敌。质押 30 GAME 入场，每次翻转持续累积奖池，终局胜利阵营平分全场金库！
              </p>
            </div>
            <div className="rate-badge">
              <Coins size={24} />
              <div>
                <span style={{ fontSize: "12px", display: "block" }}>测试兑换储备金率</span>
                <strong>1 GAME = 0.001 Devnet SOL</strong>
              </div>
            </div>
          </div>

          {/* Lobby List Section */}
          <div className="panel-card">
            <div className="lobby-filters">
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 800 }}>游戏房间列表 (Step 2)</h2>
                <button
                  className="btn-secondary"
                  style={{ padding: "6px 12px", fontSize: "12px" }}
                  onClick={refreshAll}
                  disabled={loadingGames}
                >
                  <RefreshCw size={13} className={loadingGames ? "animate-spin" : ""} />
                  刷新
                </button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <div className="filter-pills">
                  <button
                    className={`filter-pill ${listFilter === "all" ? "active" : ""}`}
                    onClick={() => setListFilter("all")}
                  >
                    全部 ({games.length})
                  </button>
                  <button
                    className={`filter-pill ${listFilter === "recruiting" ? "active" : ""}`}
                    onClick={() => setListFilter("recruiting")}
                  >
                    ⏳ 报名招募中 ({games.filter((g) => g.status === 0).length})
                  </button>
                  <button
                    className={`filter-pill ${listFilter === "active" ? "active" : ""}`}
                    onClick={() => setListFilter("active")}
                  >
                    ⚔️ 激烈交战中 ({games.filter((g) => g.status === 1).length})
                  </button>
                  <button
                    className={`filter-pill ${listFilter === "finalized" ? "active" : ""}`}
                    onClick={() => setListFilter("finalized")}
                  >
                    🏆 已分胜负 ({games.filter((g) => g.status === 2).length})
                  </button>
                </div>

                <input
                  type="text"
                  placeholder="搜索游戏 ID..."
                  value={searchIdInput}
                  onChange={(e) => setSearchIdInput(e.target.value)}
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid var(--line)",
                    borderRadius: "10px",
                    padding: "6px 12px",
                    color: "#fff",
                    fontSize: "13px",
                    width: "130px",
                  }}
                />
              </div>
            </div>

            {/* Game Cards */}
            {filteredGames.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "48px 20px",
                  color: "var(--muted)",
                  background: "rgba(255,255,255,0.02)",
                  borderRadius: "16px",
                }}
              >
                <Layers size={40} style={{ margin: "0 auto 12px", opacity: 0.4 }} />
                <p style={{ margin: "0 0 16px" }}>当前分类下暂无游戏房间</p>
                <button className="btn-primary" onClick={() => setShowCreateModal(true)}>
                  <PlusCircle size={15} /> 立即发起第一局游戏 (Step 1)
                </button>
              </div>
            ) : (
              <div className="game-card-grid">
                {filteredGames.map((g) => {
                  const isSelected = g.id.toString() === selectedGameId;
                  const redPct = Math.round((g.redBoxes / 100) * 100);
                  const isFinished = g.status === 2;
                  const isPlaying = g.status === 1;
                  const isRecruiting = g.status === 0;

                  return (
                    <div
                      key={g.id.toString()}
                      className={`game-card ${isSelected ? "selected" : ""}`}
                    >
                      <div className="game-card-header">
                        <span className="game-card-id">
                          <Swords size={18} color="#38bdf8" /> #{g.id.toString()} 房间
                        </span>
                        {isRecruiting && <span className="status-tag recruiting">⏳ 报名招募中</span>}
                        {isPlaying && <span className="status-tag active">⚔️ 激烈交火中</span>}
                        {isFinished && (
                          <span className="status-tag finalized">
                            🏆 {g.winner === 1 ? "红方获胜" : g.winner === 2 ? "绿方获胜" : "平局和解"}
                          </span>
                        )}
                      </div>

                      {/* Mini tug bar */}
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "4px" }}>
                          <span style={{ color: "#f87171" }}>🔴 红方 {g.redBoxes} 箱</span>
                          <span style={{ color: "#4ade80" }}>🟢 绿方 {g.greenBoxes} 箱</span>
                        </div>
                        <div style={{ height: "6px", borderRadius: "9999px", background: "rgba(255,255,255,0.1)", overflow: "hidden", display: "flex" }}>
                          <div style={{ width: `${redPct}%`, background: "#ef4444" }} />
                          <div style={{ width: `${100 - redPct}%`, background: "#22c55e" }} />
                        </div>
                      </div>

                      {/* Card Details */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "12px" }}>
                        <div>
                          <span style={{ color: "var(--muted)" }}>参战人数：</span>
                          <strong>{g.playerCount} / 100</strong>
                        </div>
                        <div>
                          <span style={{ color: "var(--muted)" }}>奖池总额：</span>
                          <strong style={{ color: "var(--gold)" }}>{fmtToken(g.pool)} GAME</strong>
                        </div>
                        <div>
                          <span style={{ color: "var(--muted)" }}>累计翻转：</span>
                          <strong>{g.flips.toString()} 次</strong>
                        </div>
                        <div>
                          <span style={{ color: "var(--muted)" }}>红/绿玩家：</span>
                          <strong>{g.redPlayers} / {g.greenPlayers}</strong>
                        </div>
                      </div>

                      {/* Card Action */}
                      <button
                        className="btn-primary"
                        style={{ marginTop: "auto", width: "100%" }}
                        onClick={() => {
                          setSelectedGameId(g.id.toString());
                          setViewTab("arena");
                        }}
                      >
                        {isRecruiting ? "进入等待室 / 立即加入 (Step 3 & 4)" : isPlaying ? "前往战场翻箱对抗 (Step 5)" : "查看战报与结算 (Step 6)"}
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {/* VIEW: ARENA WORKSPACE (Steps 3, 4, 5, 6) */}
      {viewTab === "arena" && (
        <section className="game-workspace">
          {/* LEFT: 10x10 ARENA & STATS */}
          <div className="arena-card">
            {/* Header & Quick Selector */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
              <div>
                <span style={{ fontSize: "11px", letterSpacing: "0.15em", color: "#86efac", fontWeight: 700 }}>
                  BATTLE ARENA
                </span>
                <h2 style={{ margin: 0, fontSize: "24px", fontWeight: 800 }}>
                  战场 #{currentId.toString()}
                </h2>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "12px", color: "var(--muted)" }}>切换房间:</span>
                <input
                  type="text"
                  value={selectedGameId}
                  onChange={(e) => setSelectedGameId(e.target.value.replace(/\D/g, ""))}
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid var(--line)",
                    borderRadius: "8px",
                    padding: "6px 10px",
                    color: "#fff",
                    width: "70px",
                    textAlign: "center",
                  }}
                />
                <button className="btn-secondary" style={{ padding: "6px 12px" }} onClick={refreshAll}>
                  读取
                </button>
              </div>
            </div>

            {/* Scoreboard / Stats Grid */}
            <div className="stats-grid">
              <div className="stat-card">
                <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                  <Users size={14} /> 参战人数
                </span>
                <strong>{game?.playerCount ?? 0} <small style={{ fontSize: "12px", color: "var(--muted)" }}>/ 100</small></strong>
              </div>
              <div className="stat-card">
                <span>实时总奖池</span>
                <strong style={{ color: "var(--gold)" }}>{fmtToken(game?.pool ?? 0n)} <small style={{ fontSize: "12px" }}>GAME</small></strong>
              </div>
              <div className="stat-card">
                <span>全场翻转次数</span>
                <strong>{game?.flips.toString() ?? "0"}</strong>
              </div>
              <div className="stat-card">
                <span>战局阶段</span>
                <strong style={{ fontSize: "15px" }}>
                  {game?.status === 0 ? "⏳ 报名招募中" : game?.status === 1 ? "⚔️ 激烈交战中" : game?.status === 2 ? "🏆 已分胜负" : "未初始化"}
                </strong>
              </div>
            </div>

            {game && (
              <div className="game-time-grid" aria-label="游戏时间详情">
                <div>
                  <span>预计开始时间</span>
                  <strong>{fmtDateTime(game.startAt)}</strong>
                </div>
                <div>
                  <span>预计结束时间</span>
                  <strong>{fmtDateTime(game.endAt)}</strong>
                </div>
                <div>
                  <span>预计消耗时间</span>
                  <strong>{game.createdAt === undefined ? "--" : fmtDuration(game.endAt - game.createdAt)}</strong>
                </div>
              </div>
            )}

            {/* Tug-of-war Bar */}
            <div className="battle-tug-bar">
              <div className="tug-labels">
                <span className="tug-red">🔴 红方占领：{redCount} 箱 ({redPercent}%)</span>
                <span style={{ fontSize: "11px", color: "var(--muted)" }}>
                  {redCount > greenCount ? "🔥 红方领先" : greenCount > redCount ? "🌿 绿方领先" : "🤝 双方平手"}
                </span>
                <span className="tug-green">🟢 绿方占领：{greenCount} 箱 ({greenPercent}%)</span>
              </div>
              <div className="tug-progress-track">
                <div className="tug-red-fill" style={{ width: `${redPercent}%` }} />
                <div className="tug-green-fill" style={{ width: `${greenPercent}%` }} />
              </div>
            </div>

            {/* 10x10 Interactive Board */}
            <div className="board-wrap">
              <div className="board-10x10" role="grid" aria-label="10乘10翻箱竞技场">
                {currentBoxes.map((isRed, index) => (
                  <button
                    key={index}
                    type="button"
                    disabled={busy || !wallet.publicKey || !game || game.status !== 1}
                    className={`box-cell ${isRed ? "red-box" : "green-box"}`}
                    onClick={() => handleBoxClick(index)}
                    title={`第 ${index + 1} 个箱子 (${isRed ? "红色" : "绿色"}) - 点击翻转为己方阵营`}
                  >
                    <span>{index + 1}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* ER / L1 Status indicator */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "12px", color: "var(--muted)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <Zap size={14} color={erEndpoint ? "#22c55e" : "#94a3b8"} />
                <span>
                  {erEndpoint ? (
                    <span style={{ color: "#86efac" }}>MagicBlock ER 极速通道就绪 (亚秒级免 gas 翻转)</span>
                  ) : (
                    <span>Solana Devnet 基础网络</span>
                  )}
                </span>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={useEr}
                  disabled={!erEndpoint || (player !== null && playerErEndpoint !== erEndpoint)}
                  onChange={(e) => setUseEr(e.target.checked)}
                />
                启用 ER 极速通道
              </label>
            </div>
          </div>

          {/* RIGHT: CONTEXTUAL ACTIONS BASED ON STEPS (3, 4, 5, 6) */}
          <div className="panel-card">
            {/* If game doesn't exist */}
            {!game && (
              <div style={{ textAlign: "center", padding: "30px 10px", display: "flex", flexDirection: "column", gap: "14px" }}>
                <AlertCircle size={36} color="#f59e0b" style={{ margin: "0 auto" }} />
                <h3>尚未找到 #{currentId.toString()} 游戏房间</h3>
                <p style={{ color: "var(--muted)", fontSize: "13px" }}>
                  该编号暂未在链上部署，你可以立即发起该编号游戏，或者返回游戏大厅查看现有房间。
                </p>
                <button
                  className="btn-primary"
                  disabled={busy || !wallet.publicKey}
                  onClick={() => setShowCreateModal(true)}
                >
                  <PlusCircle size={15} /> 立即创建 #{currentId.toString()} 房间 (Step 1)
                </button>
                <button className="btn-secondary" onClick={() => setViewTab("lobby")}>
                  返回游戏大厅 (Step 2)
                </button>
              </div>
            )}

            {/* STEP 3 & 4: RECRUITING & WAITING (Status 0) */}
            {game && game.status === 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
                <div>
                  <span style={{ fontSize: "11px", letterSpacing: "0.15em", color: "#f59e0b", fontWeight: 700 }}>
                    JOIN & WAITING ROOM
                  </span>
                  <h3 style={{ margin: "4px 0", fontSize: "22px", fontWeight: 800 }}>
                    战局筹备集结 (Step 3 & 4)
                  </h3>
                </div>

                {/* Countdown to join deadline */}
                <div className="player-countdown-badge">
                  <Clock size={18} />
                  <div>
                    <span style={{ display: "block", fontSize: "11px" }}>报名截止倒计时</span>
                    <strong>{joinTimeRemaining !== null ? `${joinTimeRemaining} 秒` : "已截止，等待开局"}</strong>
                  </div>
                </div>

                {/* Player Requirement Progress */}
                <div style={{ background: "rgba(255,255,255,0.03)", padding: "14px", borderRadius: "14px", border: "1px solid var(--line)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", marginBottom: "6px" }}>
                    <span>玩家集结进度</span>
                    <strong>{game.playerCount} / 1 人 (开局门槛)</strong>
                  </div>
                  <div style={{ height: "10px", borderRadius: "9999px", background: "rgba(255,255,255,0.1)", overflow: "hidden" }}>
                    <div
                      style={{
                        height: "100%",
                        width: `${Math.min(100, game.playerCount * 100)}%`,
                        background: game.playerCount >= 1 ? "#22c55e" : "#f59e0b",
                        transition: "width 0.3s ease",
                      }}
                    />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--muted)", marginTop: "6px" }}>
                    <span>🔴 红方战队：{game.redPlayers} 人</span>
                    <span>🟢 绿方战队：{game.greenPlayers} 人</span>
                  </div>
                </div>

                {/* SUB-SECTION: STEP 3 (If user hasn't joined) */}
                {!player ? (
                  <div style={{ background: "rgba(34, 197, 94, 0.05)", border: "1px solid rgba(34, 197, 94, 0.2)", borderRadius: "16px", padding: "18px", display: "flex", flexDirection: "column", gap: "12px" }}>
                    <h4 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#86efac" }}>
                      👉 步骤 3：支付并加入战局 (Join Game)
                    </h4>
                    <p style={{ margin: 0, fontSize: "12px", color: "var(--muted-light)", lineHeight: "1.5" }}>
                      固定保证金 30 GAME 入池。请选择预存翻箱点击额度（每次翻箱扣 1 GAME，未消耗额度终局 100% 原路返还）。
                    </p>

                    {!joinIsOpen && (
                      <div role="alert" style={{ fontSize: "12px", color: "#fca5a5", display: "flex", alignItems: "center", gap: "6px" }}>
                        <AlertCircle size={14} aria-hidden="true" />
                        本局已到开始时间，不能再报名。请返回大厅选择招募中的游戏。
                      </div>
                    )}

                    {/* Credit chips */}
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      {[50, 100, 200].map((amt) => (
                        <button
                          key={amt}
                          type="button"
                          className={`filter-pill ${selectedCredits === amt && !customCredits ? "active" : ""}`}
                          onClick={() => {
                            setSelectedCredits(amt);
                            setCustomCredits("");
                          }}
                        >
                          +{amt} 次翻箱
                        </button>
                      ))}
                    </div>

                    <div style={{ fontSize: "13px", padding: "10px", background: "rgba(0,0,0,0.2)", borderRadius: "10px", display: "flex", justifyContent: "space-between" }}>
                      <span>合计需支付 GAME:</span>
                      <strong style={{ color: "var(--gold)" }}>{totalGameTokensNeeded} GAME</strong>
                    </div>

                    {balances.game < BigInt(totalGameTokensNeeded * 1_000_000) && (
                      <div style={{ fontSize: "12px", color: "#fca5a5", display: "flex", alignItems: "center", gap: "6px" }}>
                        <AlertCircle size={14} />
                        GAME 代币余额不足 (当前 {fmtToken(balances.game)})，请先充值！
                      </div>
                    )}

                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "8px" }}>
                      <button
                        className="btn-primary"
                        disabled={busy || !wallet.publicKey || !joinIsOpen || balances.game < BigInt(totalGameTokensNeeded * 1_000_000)}
                        onClick={() =>
                          wallet.publicKey &&
                          send(`加入 #${currentId} 游戏`, joinIx(wallet.publicKey, currentId, BigInt(creditsToBuy)))
                        }
                      >
                        <Shield size={16} /> {joinIsOpen ? "支付并加入游戏" : "报名已截止"}
                      </button>
                      <button className="btn-gold" onClick={() => setShowBuyModal(true)}>
                        充值 GAME
                      </button>
                    </div>
                  </div>
                ) : (
                  /* SUB-SECTION: STEP 4 (User has joined -> Waiting room) */
                  <div style={{ background: "rgba(56, 189, 248, 0.06)", border: "1px solid rgba(56, 189, 248, 0.25)", borderRadius: "16px", padding: "18px", display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <h4 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#7dd3fc" }}>
                        ✅ 步骤 4：已加入集结大厅 (Waiting)
                      </h4>
                      <span className="status-tag active">已就绪</span>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "12px", background: "rgba(0,0,0,0.2)", padding: "12px", borderRadius: "10px" }}>
                      <div>
                        <span style={{ color: "var(--muted)" }}>分配阵营：</span>
                        <strong style={{ color: player.team === 0 ? "#f87171" : "#4ade80" }}>
                          {player.team === 0 ? "🔴 红方战队" : "🟢 绿方战队"}
                        </strong>
                      </div>
                      <div>
                        <span style={{ color: "var(--muted)" }}>加入顺位：</span>
                        <strong>第 {player.joinIndex + 1} 位</strong>
                      </div>
                      <div>
                        <span style={{ color: "var(--muted)" }}>质押保证金：</span>
                        <strong>{fmtToken(player.contributed)} GAME</strong>
                      </div>
                      <div>
                        <span style={{ color: "var(--muted)" }}>可用翻箱额度：</span>
                        <strong style={{ color: "var(--gold)" }}>{fmtToken(player.unusedCredits)} 次</strong>
                      </div>
                    </div>

                    <p style={{ margin: 0, fontSize: "12px", color: "var(--muted)" }}>
                      报名期间 Game 与 Player 保留在 Devnet；开局后再委托到 MagicBlock ER，确保其他玩家可以正常加入。
                    </p>
                  </div>
                )}

                {/* STEP 5 LAUNCHER: Start Game Button */}
                <div style={{ marginTop: "auto", borderTop: "1px solid var(--line)", paddingTop: "14px" }}>
                  <div style={{ marginBottom: "10px", fontSize: "12px", color: "var(--muted)" }}>
                    {game.playerCount < 1 ? (
                      <span>至少需要 1 名玩家加入后才能开局</span>
                    ) : joinIsOpen ? (
                      <span>已满足人数；报名倒计时结束后即可单人或多人开局。</span>
                    ) : (
                      <span style={{ color: "#86efac" }}>
                        已达到开局条件；无人加入也可在报名截止后单人开局，奖池最终全额结算回本人
                      </span>
                    )}
                  </div>
                  <button
                    className="btn-primary"
                    style={{ width: "100%", height: "48px", fontSize: "16px" }}
                    disabled={busy || !wallet.publicKey || game.playerCount < 1 || joinIsOpen}
                    onClick={() => wallet.publicKey && send("开始游戏", simpleGameIx(5, wallet.publicKey, currentId))}
                  >
                    <Swords size={18} /> 开启 5 分钟翻箱大战 (Step 5)
                  </button>
                </div>
              </div>
            )}

            {/* STEP 5: ACTIVE BATTLE (Status 1) */}
            {game && game.status === 1 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
                <div>
                  <span style={{ fontSize: "11px", letterSpacing: "0.15em", color: "#22c55e", fontWeight: 700 }}>
                    REAL-TIME BATTLE
                  </span>
                  <h3 style={{ margin: "4px 0", fontSize: "22px", fontWeight: 800 }}>
                    实时对战翻箱中 (Step 5)
                  </h3>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  {player && (
                    <button className="btn-secondary" disabled={busy || !wallet.publicKey || !!playerErEndpoint} onClick={() => wallet.publicKey && send("委托我的玩家状态到 ER", delegateIx(wallet.publicKey, currentId, 1))}>
                      <Zap size={14} /> 委托我的 Player
                    </button>
                  )}
                  {wallet.publicKey && game.creator?.equals(wallet.publicKey) && (
                    <button className="btn-secondary" disabled={busy || !!erEndpoint} onClick={() => wallet.publicKey && send("委托游戏状态到 ER", delegateIx(wallet.publicKey, currentId, 0))}>
                      <Zap size={14} /> 委托 Game 到 ER
                    </button>
                  )}
                </div>

                {/* Match Timer Countdown */}
                <div
                  style={{
                    background: "linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(245, 158, 11, 0.15))",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    padding: "16px",
                    borderRadius: "14px",
                    display: "flex",
                    alignItems: "center",
                    gap: "14px",
                  }}
                >
                  <Timer size={28} color="#ef4444" className="animate-pulse" />
                  <div>
                    <span style={{ fontSize: "12px", color: "var(--muted-light)" }}>对战剩余时间</span>
                    <h4 style={{ margin: "2px 0 0", fontSize: "26px", fontWeight: 900, color: "#fff" }}>
                      {playTimeRemaining !== null
                        ? `${Math.floor(playTimeRemaining / 60)
                            .toString()
                            .padStart(2, "0")}:${(playTimeRemaining % 60).toString().padStart(2, "0")}`
                        : "对战已超时，请结算"}
                    </h4>
                  </div>
                </div>

                {/* Player Battle Console */}
                {player ? (
                  <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--line)", padding: "16px", borderRadius: "14px", display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "13px", fontWeight: 700 }}>我的阵营身份</span>
                      <span
                        className="status-tag"
                        style={{
                          background: player.team === 0 ? "rgba(239, 68, 68, 0.2)" : "rgba(34, 197, 94, 0.2)",
                          color: player.team === 0 ? "#f87171" : "#4ade80",
                        }}
                      >
                        {player.team === 0 ? "🔴 红方先锋" : "🟢 绿方先锋"}
                      </span>
                    </div>

                    <p style={{ margin: 0, fontSize: "12px", color: "var(--muted-light)", lineHeight: "1.5" }}>
                      {player.team === 0
                        ? "🎯 你的使命：点击网格中的【绿色箱子】将其翻转为红色，抢占阵地！"
                        : "🎯 你的使命：点击网格中的【红色箱子】将其翻转为绿色，抢占阵地！"}
                    </p>

                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", borderTop: "1px solid var(--line)", paddingTop: "8px" }}>
                      <span style={{ color: "var(--muted)" }}>剩余翻箱点击额度:</span>
                      <strong style={{ color: "var(--gold)" }}>{fmtToken(player.unusedCredits)} 次</strong>
                    </div>
                  </div>
                ) : (
                  <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--line)", padding: "14px", borderRadius: "14px", color: "var(--muted)", fontSize: "13px" }}>
                    👀 你目前处于观战模式，本局已进入交火期不可中途加入。
                  </div>
                )}

                {/* STEP 6 TRIGGER: Finalize Button */}
                <div style={{ marginTop: "auto", borderTop: "1px solid var(--line)", paddingTop: "14px" }}>
                  <div style={{ marginBottom: "10px", fontSize: "12px", color: "var(--muted)" }}>
                    {playTimeRemaining && playTimeRemaining > 0 ? (
                      <span>⏰ 比赛进行中，倒计时归零后可触发终局结算。</span>
                    ) : (
                      <span style={{ color: "#f87171", fontWeight: 700 }}>🔔 5 分钟对战时间已截止！请立即触发结算公布获胜方！</span>
                    )}
                  </div>
                  <button
                    className="btn-gold"
                    style={{ width: "100%", height: "48px", fontSize: "16px" }}
                    disabled={busy || !wallet.publicKey || (playTimeRemaining !== null && playTimeRemaining > 0)}
                    onClick={() => wallet.publicKey && send("结算游戏", simpleGameIx(7, wallet.publicKey, currentId), useEr)}
                  >
                    <Trophy size={18} /> 终盘结算本局比赛 (Step 6)
                  </button>
                </div>
              </div>
            )}

            {/* STEP 6: SETTLEMENT & CLAIM (Status 2) */}
            {game && game.status === 2 && (
              <div className="settlement-card">
                <div className="winner-banner">
                  <Trophy size={48} color="#f59e0b" style={{ margin: "0 auto" }} />
                  <h2>
                    {game.playerCount === 1
                      ? "单人挑战完成，奖池全额结算！"
                      : game.winner === 1
                      ? "🔴 红方战队荣获大捷！"
                      : game.winner === 2
                      ? "🟢 绿方战队荣获大捷！"
                      : "🤝 50:50 势均力敌，平局和解！"}
                  </h2>
                  <span style={{ fontSize: "13px", color: "var(--muted-light)" }}>
                    最终占领：🔴 红方 {game.redBoxes} 箱 vs 🟢 绿方 {game.greenBoxes} 箱
                  </span>
                </div>

                {/* Payout Breakdown */}
                <table className="payout-table">
                  <tbody>
                    <tr>
                      <td style={{ color: "var(--muted)" }}>全场累积总奖池</td>
                      <td style={{ color: "var(--gold)" }}>{fmtToken(game.pool)} GAME</td>
                    </tr>
                    <tr>
                      <td style={{ color: "var(--muted)" }}>{game.playerCount === 1 ? "结算玩家数" : "获胜方人数"}</td>
                      <td>{game.playerCount === 1 ? 1 : game.winner === 1 ? game.redPlayers : game.winner === 2 ? game.greenPlayers : game.playerCount} 人</td>
                    </tr>
                    <tr>
                      <td style={{ color: "var(--muted)" }}>全场翻转次数</td>
                      <td>{game.flips.toString()} 次</td>
                    </tr>
                  </tbody>
                </table>

                {/* Player Claim / Status */}
                {player ? (
                  <div style={{ background: "rgba(0,0,0,0.3)", borderRadius: "14px", padding: "16px", display: "flex", flexDirection: "column", gap: "10px", textAlign: "left" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "13px", fontWeight: 700 }}>我的战绩与结算</span>
                      <span
                        className="status-tag"
                        style={{
                          background:
                            game.playerCount === 1 || (game.winner === 1 && player.team === 0) || (game.winner === 2 && player.team === 1)
                              ? "rgba(34, 197, 94, 0.2)"
                              : game.winner === 3
                              ? "rgba(245, 158, 11, 0.2)"
                              : "rgba(239, 68, 68, 0.2)",
                        }}
                      >
                        {game.playerCount === 1
                          ? "单人全额结算"
                          : (game.winner === 1 && player.team === 0) || (game.winner === 2 && player.team === 1)
                          ? "🏅 胜利者"
                          : game.winner === 3
                          ? "🤝 平局退款"
                          : "🛡️ 未获胜"}
                      </span>
                    </div>

                    <div style={{ fontSize: "12px", color: "var(--muted-light)", display: "grid", gap: "4px" }}>
                      <div>阵营归属：{player.team === 0 ? "🔴 红方" : "🟢 绿方"}</div>
                      <div>未消耗翻箱额度原路返还：+{fmtToken(player.unusedCredits)} GAME</div>
                    </div>

                    {player.claimed ? (
                      <div style={{ padding: "10px", background: "rgba(34, 197, 94, 0.15)", borderRadius: "10px", color: "#86efac", fontSize: "13px", textAlign: "center" }}>
                        ✅ 已成功领取全部奖金与退款！
                      </div>
                    ) : (
                      <button
                        className="btn-gold"
                        style={{ width: "100%", marginTop: "4px" }}
                        disabled={busy || !wallet.publicKey}
                        onClick={() => wallet.publicKey && send("领取奖励与退款", claimIx(wallet.publicKey, currentId))}
                      >
                        <Sparkles size={16} /> 领取我的奖金与退款 (Claim)
                      </button>
                    )}

                    {/* Undelegate if delegated */}
                    <button
                      className="btn-secondary"
                      style={{ fontSize: "12px", padding: "8px 12px" }}
                      disabled={busy || !wallet.publicKey}
                      onClick={() => wallet.publicKey && send(
                        "解除游戏与玩家委托回写主链",
                        [undelegateIx(wallet.publicKey, pda.player(pda.game(currentId), wallet.publicKey)), undelegateIx(wallet.publicKey, pda.game(currentId))],
                        true
                      )}
                    >
                      解除 MagicBlock 委托并回写主链
                    </button>
                  </div>
                ) : (
                  <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                    你未参加本局比赛，不可领取奖金。
                  </div>
                )}

                {/* Next actions */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "10px" }}>
                  <button className="btn-primary" onClick={() => setShowCreateModal(true)}>
                    <PlusCircle size={14} /> 发起新游戏 (Step 1)
                  </button>
                  <button className="btn-secondary" onClick={() => setViewTab("lobby")}>
                    返回大厅 (Step 2)
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* MODAL: CREATE GAME (Step 1) */}
      {showCreateModal && (
        <div className="modal-backdrop" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: "20px", fontWeight: 800 }}>发起新游戏对决 (Step 1)</h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                style={{ background: "transparent", border: 0, color: "var(--muted)", fontSize: "20px" }}
              >
                ✕
              </button>
            </div>

            <p style={{ margin: 0, fontSize: "13px", color: "var(--muted-light)", lineHeight: "1.5" }}>
              在 Solana Devnet 上初始化一个崭新的 10×10 翻箱竞技房间。系统将自动为你生成 Game PDA 与代币奖池金库。
            </p>

            <div className="auto-game-id" aria-live="polite">
              <span>系统自动生成游戏编号</span>
              <strong>#{suggestedGameId}</strong>
            </div>

            <label htmlFor="game-start-at" style={{ display: "grid", gap: "6px", fontSize: "13px", color: "var(--muted-light)" }}>
              游戏开始时间
              <input
                id="game-start-at"
                type="datetime-local"
                required
                min={toDateTimeLocalValue(new Date((nowSec + 60) * 1000))}
                value={gameStartInput}
                onChange={(event) => setGameStartInput(event.target.value)}
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--line)", borderRadius: "10px", padding: "11px 12px", color: "#fff", colorScheme: "dark" }}
              />
              <span style={{ fontSize: "12px", color: "var(--muted)" }}>开始前均可加入；到点后 1 人即可开局，对战持续 5 分钟，单人奖池全额返还。</span>
            </label>

            <div style={{ background: "rgba(0,0,0,0.25)", padding: "12px", borderRadius: "12px", fontSize: "12px", display: "grid", gap: "4px" }}>
              <div>📦 棋盘规模：100 个红绿双色宝箱</div>
              <div>⏳ 报名招募截止：由你设置的游戏开始时间</div>
              <div>⚔️ 竞技对抗时间：300 秒 (5 分钟)</div>
              <div>👥 开局要求：2 ～ 100 人</div>
              <div>💰 保证金：30 GAME / 人</div>
            </div>

            <button
              className="btn-primary"
              style={{ width: "100%", height: "46px" }}
              disabled={busy || loadingGames || !wallet.publicKey || !gameStartInput || new Date(gameStartInput).getTime() <= nowSec * 1000}
              onClick={async () => {
                if (!wallet.publicKey) return;
                const startAt = Math.floor(new Date(gameStartInput).getTime() / 1000);
                if (!Number.isSafeInteger(startAt) || startAt <= Math.floor(Date.now() / 1000)) {
                  setNotice({ type: "error", text: "游戏开始时间必须晚于当前时间。" });
                  return;
                }
                const latestGames = await fetchAllGames(connection, gamesRef.current.map((item) => item.id));
                const firstCandidate = latestGames.reduce((max, item) => item.id > max ? item.id : max, 0n) + 1n;
                const idNum = await findAvailableGameId(connection, firstCandidate);
                await send(`发起 #${idNum} 游戏`, createGameIxs(wallet.publicKey, idNum, BigInt(startAt)));
                setSelectedGameId(idNum.toString());
                setShowCreateModal(false);
                setViewTab("arena");
              }}
            >
              <PlusCircle size={16} /> 直接新建游戏
            </button>
          </div>
        </div>
      )}

      {/* MODAL: BUY GAME TOKENS */}
      {showBuyModal && (
        <div className="modal-backdrop" onClick={() => setShowBuyModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: "20px", fontWeight: 800 }}>兑换测试 GAME 代币</h3>
              <button
                type="button"
                onClick={() => setShowBuyModal(false)}
                style={{ background: "transparent", border: 0, color: "var(--muted)", fontSize: "20px" }}
              >
                ✕
              </button>
            </div>

            <p style={{ margin: 0, fontSize: "13px", color: "var(--muted-light)" }}>
              固定储备金库兑换率：<strong>1 GAME = 0.001 Devnet SOL</strong>。
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label htmlFor="buy-amt" style={{ fontSize: "12px", color: "var(--muted)" }}>
                兑换数量 (整枚 GAME)：
              </label>
              <input
                id="buy-amt"
                type="number"
                value={buyAmountInput}
                onChange={(e) => setBuyAmountInput(e.target.value)}
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid var(--line)",
                  borderRadius: "10px",
                  padding: "10px 14px",
                  color: "#fff",
                  fontSize: "16px",
                  fontWeight: 700,
                }}
              />
            </div>

            <div style={{ display: "flex", gap: "8px" }}>
              {[100, 200, 500, 1000].map((amt) => (
                <button
                  key={amt}
                  type="button"
                  className="filter-pill"
                  onClick={() => setBuyAmountInput(amt.toString())}
                >
                  {amt} GAME
                </button>
              ))}
            </div>

            <div style={{ fontSize: "13px", padding: "10px", background: "rgba(0,0,0,0.2)", borderRadius: "10px", display: "flex", justifyContent: "space-between" }}>
              <span>需支付 Devnet SOL:</span>
              <strong style={{ color: "var(--gold)" }}>
                {((parseInt(buyAmountInput, 10) || 0) * 0.001).toFixed(3)} SOL
              </strong>
            </div>

            <button
              className="btn-gold"
              style={{ width: "100%", height: "46px" }}
              disabled={busy || !wallet.publicKey || !parseInt(buyAmountInput, 10)}
              onClick={async () => {
                if (!wallet.publicKey) return;
                const amt = BigInt(parseInt(buyAmountInput, 10) || 0);
                await send(`购买 ${amt} GAME`, buyIxs(wallet.publicKey, amt));
                setShowBuyModal(false);
              }}
            >
              <Coins size={16} /> 确认兑换代币
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer style={{ textAlign: "center", borderTop: "1px solid var(--line)", paddingTop: "20px", color: "var(--muted)", fontSize: "12px" }}>
        Flip Vault · Solana Devnet Arena · Program ID:{" "}
        <a
          href={`https://solscan.io/account/${PROGRAM_ID.toBase58()}?cluster=devnet`}
          target="_blank"
          rel="noreferrer"
          style={{ color: "#38bdf8", textDecoration: "underline" }}
        >
          <code>{PROGRAM_ID.toBase58()}</code>
        </a>{" "}
        · 仅限 Devnet 测试环境
      </footer>
    </div>
  );
}
