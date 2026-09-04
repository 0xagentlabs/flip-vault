import { AccountMeta, Connection, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";

interface PolyfillableBufferProto {
  writeBigUInt64LE?(value: bigint | number, offset?: number): number;
  readBigUInt64LE?(offset?: number): bigint;
  writeBigInt64LE?(value: bigint | number, offset?: number): number;
  readBigInt64LE?(offset?: number): bigint;
  readUInt16LE?(offset?: number): number;
}

if (typeof Buffer !== "undefined" && Buffer.prototype) {
  const proto = Buffer.prototype as unknown as PolyfillableBufferProto;
  if (typeof proto.writeBigUInt64LE !== "function") {
    proto.writeBigUInt64LE = function (this: Buffer, value: bigint | number, offset = 0): number {
      new DataView(this.buffer, this.byteOffset + offset, 8).setBigUint64(0, BigInt(value), true);
      return offset + 8;
    };
  }
  if (typeof proto.readBigUInt64LE !== "function") {
    proto.readBigUInt64LE = function (this: Buffer, offset = 0): bigint {
      return new DataView(this.buffer, this.byteOffset + offset, 8).getBigUint64(0, true);
    };
  }
  if (typeof proto.writeBigInt64LE !== "function") {
    proto.writeBigInt64LE = function (this: Buffer, value: bigint | number, offset = 0): number {
      new DataView(this.buffer, this.byteOffset + offset, 8).setBigInt64(0, BigInt(value), true);
      return offset + 8;
    };
  }
  if (typeof proto.readBigInt64LE !== "function") {
    proto.readBigInt64LE = function (this: Buffer, offset = 0): bigint {
      return new DataView(this.buffer, this.byteOffset + offset, 8).getBigInt64(0, true);
    };
  }
  if (typeof proto.readUInt16LE !== "function") {
    proto.readUInt16LE = function (this: Buffer, offset = 0): number {
      return new DataView(this.buffer, this.byteOffset + offset, 2).getUint16(0, true);
    };
  }
}

export const PROGRAM_ID = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID ?? "ADTfCpeekasxSNZNgSPgqfyRzxJ7BA4dtaBcoj8JQe8i");
export const GAME_MINT = new PublicKey(process.env.NEXT_PUBLIC_GAME_MINT ?? "Ay4P9UVG3X6TQ55JD5e5EWun8hAcUCc8SGn39EG79jdD");
export const BASE_RPC = process.env.NEXT_PUBLIC_BASE_RPC ?? "https://rpc.magicblock.app/devnet";
export const ROUTER_RPC = process.env.NEXT_PUBLIC_ROUTER_RPC ?? "https://devnet-router.magicblock.app";
export const DELEGATION_PROGRAM = new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");
export const VALIDATOR = new PublicKey("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57");
export const MAGIC_CONTEXT = new PublicKey("MagicContext1111111111111111111111111111111");
export const MAGIC_PROGRAM = new PublicKey("Magic11111111111111111111111111111111111111");
export const u64 = (value: bigint | number): Buffer => {
  const out = Buffer.alloc(8);
  new DataView(out.buffer, out.byteOffset, 8).setBigUint64(0, BigInt(value), true);
  return out;
};
export const pda = {
  config: () => PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID)[0],
  treasury: () => PublicKey.findProgramAddressSync([Buffer.from("treasury")], PROGRAM_ID)[0],
  game: (id: bigint) => PublicKey.findProgramAddressSync([Buffer.from("game"), u64(id)], PROGRAM_ID)[0],
  player: (game: PublicKey, wallet: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("player"), game.toBuffer(), wallet.toBuffer()], PROGRAM_ID)[0],
};
const ix = (tag: number, keys: AccountMeta[], payload: Uint8Array = Buffer.alloc(0)) => new TransactionInstruction({ programId: PROGRAM_ID, keys, data: Buffer.concat([Buffer.from([tag]), payload]) });
export function buyIx(wallet: PublicKey, amount: bigint) { return ix(1, [
  { pubkey: wallet, isSigner: true, isWritable: true }, { pubkey: pda.config(), isSigner: false, isWritable: false },
  { pubkey: pda.treasury(), isSigner: false, isWritable: true }, { pubkey: GAME_MINT, isSigner: false, isWritable: true },
  { pubkey: getAssociatedTokenAddressSync(GAME_MINT, wallet), isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
], u64(amount)); }
export function buyIxs(wallet: PublicKey, amount: bigint) {
  const buyerToken = getAssociatedTokenAddressSync(GAME_MINT, wallet);
  return [
    createAssociatedTokenAccountIdempotentInstruction(wallet, buyerToken, wallet, GAME_MINT),
    buyIx(wallet, amount),
  ];
}
export function redeemIx(wallet: PublicKey, amount: bigint) { return ix(2, [
  { pubkey: wallet, isSigner: true, isWritable: true }, { pubkey: pda.config(), isSigner: false, isWritable: false },
  { pubkey: pda.treasury(), isSigner: false, isWritable: true }, { pubkey: GAME_MINT, isSigner: false, isWritable: true },
  { pubkey: getAssociatedTokenAddressSync(GAME_MINT, wallet), isSigner: false, isWritable: true }, { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
], u64(amount)); }
export function createGameIx(wallet: PublicKey, id: bigint) { const game = pda.game(id); return ix(3, [
  { pubkey: wallet, isSigner: true, isWritable: true }, { pubkey: pda.config(), isSigner: false, isWritable: false },
  { pubkey: game, isSigner: false, isWritable: true }, { pubkey: GAME_MINT, isSigner: false, isWritable: false },
  { pubkey: getAssociatedTokenAddressSync(GAME_MINT, game, true), isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
], u64(id)); }
export function createGameIxs(wallet: PublicKey, id: bigint) { const game = pda.game(id); const vault = getAssociatedTokenAddressSync(GAME_MINT, game, true); return [createAssociatedTokenAccountIdempotentInstruction(wallet, vault, game, GAME_MINT), createGameIx(wallet, id)]; }
export function joinIx(wallet: PublicKey, id: bigint, clickCredits: bigint) { const game = pda.game(id); return ix(4, [
  { pubkey: wallet, isSigner: true, isWritable: true }, { pubkey: game, isSigner: false, isWritable: true },
  { pubkey: pda.player(game, wallet), isSigner: false, isWritable: true }, { pubkey: getAssociatedTokenAddressSync(GAME_MINT, wallet), isSigner: false, isWritable: true },
  { pubkey: getAssociatedTokenAddressSync(GAME_MINT, game, true), isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
], Buffer.concat([u64(id), u64(clickCredits)])); }
export function simpleGameIx(tag: 5 | 7, wallet: PublicKey, id: bigint) { return ix(tag, [
  { pubkey: wallet, isSigner: true, isWritable: false }, { pubkey: pda.game(id), isSigner: false, isWritable: true },
]); }
export function flipIx(wallet: PublicKey, id: bigint, index: number) { const game = pda.game(id); return ix(6, [
  { pubkey: wallet, isSigner: true, isWritable: false }, { pubkey: game, isSigner: false, isWritable: true },
  { pubkey: pda.player(game, wallet), isSigner: false, isWritable: true },
], Buffer.from([index])); }
export function claimIx(wallet: PublicKey, id: bigint) { const game = pda.game(id); return ix(8, [
  { pubkey: wallet, isSigner: true, isWritable: false }, { pubkey: game, isSigner: false, isWritable: false },
  { pubkey: pda.player(game, wallet), isSigner: false, isWritable: true }, { pubkey: getAssociatedTokenAddressSync(GAME_MINT, game, true), isSigner: false, isWritable: true },
  { pubkey: getAssociatedTokenAddressSync(GAME_MINT, wallet), isSigner: false, isWritable: true }, { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
]); }
export function delegateIx(wallet: PublicKey, id: bigint, kind: 0 | 1) { const game = pda.game(id); const target = kind === 0 ? game : pda.player(game, wallet); return ix(9, [
  { pubkey: wallet, isSigner: true, isWritable: true }, { pubkey: target, isSigner: false, isWritable: true },
  { pubkey: PROGRAM_ID, isSigner: false, isWritable: false }, { pubkey: PublicKey.findProgramAddressSync([Buffer.from("buffer"), target.toBuffer()], PROGRAM_ID)[0], isSigner: false, isWritable: true },
  { pubkey: PublicKey.findProgramAddressSync([Buffer.from("delegation"), target.toBuffer()], DELEGATION_PROGRAM)[0], isSigner: false, isWritable: true },
  { pubkey: PublicKey.findProgramAddressSync([Buffer.from("delegation-metadata"), target.toBuffer()], DELEGATION_PROGRAM)[0], isSigner: false, isWritable: true },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: DELEGATION_PROGRAM, isSigner: false, isWritable: false }, { pubkey: VALIDATOR, isSigner: false, isWritable: false },
], Buffer.concat([Buffer.from([kind]), u64(id)])); }
export function undelegateIx(wallet: PublicKey, target: PublicKey) { return ix(10, [
  { pubkey: wallet, isSigner: true, isWritable: false }, { pubkey: target, isSigner: false, isWritable: true },
  { pubkey: MAGIC_CONTEXT, isSigner: false, isWritable: true }, { pubkey: MAGIC_PROGRAM, isSigner: false, isWritable: false },
]); }
export type GameState = {
  id: bigint;
  pubkey?: PublicKey;
  creator?: PublicKey;
  status: number;
  createdAt?: bigint;
  joinDeadline?: bigint;
  endAt: bigint;
  playerCount: number;
  redPlayers: number;
  greenPlayers: number;
  redBoxes: number;
  greenBoxes: number;
  pool: bigint;
  flips: bigint;
  seed?: number;
  winner: number;
  bump?: number;
  boxes: boolean[];
};

export type PlayerState = {
  game: PublicKey;
  wallet: PublicKey;
  joinIndex: number;
  team: number;
  contributed: bigint;
  unusedCredits: bigint;
  claimed: boolean;
  bump: number;
};

export async function fetchGame(connection: Connection, id: bigint): Promise<GameState | null> {
  const gamePubkey = pda.game(id);
  const info = await connection.getAccountInfo(gamePubkey);
  if (!info || !info.owner.equals(PROGRAM_ID) || info.data.length !== 224 || info.data[0] !== 2) return null;
  const d = info.data;
  const view = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const boxes = Array.from({ length: 100 }, (_, i) => (d[169 + Math.floor(i / 8)] & (1 << (i % 8))) !== 0);
  return {
    id: view.getBigUint64(1, true),
    pubkey: gamePubkey,
    creator: new PublicKey(d.subarray(9, 41)),
    status: d[105],
    createdAt: view.getBigInt64(106, true),
    joinDeadline: view.getBigInt64(126, true),
    endAt: view.getBigInt64(134, true),
    playerCount: view.getUint16(142, true),
    redPlayers: view.getUint16(144, true),
    greenPlayers: view.getUint16(146, true),
    redBoxes: d[148],
    greenBoxes: d[149],
    pool: view.getBigUint64(150, true),
    flips: view.getBigUint64(158, true),
    seed: d[166],
    winner: d[167],
    bump: d[168],
    boxes,
  };
}

export async function fetchAllGames(connection: Connection): Promise<GameState[]> {
  try {
    const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
      filters: [{ dataSize: 224 }],
    });
    const games: GameState[] = [];
    for (const { pubkey, account } of accounts) {
      if (account.data.length !== 224 || account.data[0] !== 2) continue;
      const d = account.data;
      const view = new DataView(d.buffer, d.byteOffset, d.byteLength);
      const boxes = Array.from({ length: 100 }, (_, i) => (d[169 + Math.floor(i / 8)] & (1 << (i % 8))) !== 0);
      games.push({
        id: view.getBigUint64(1, true),
        pubkey,
        creator: new PublicKey(d.subarray(9, 41)),
        status: d[105],
        createdAt: view.getBigInt64(106, true),
        joinDeadline: view.getBigInt64(126, true),
        endAt: view.getBigInt64(134, true),
        playerCount: view.getUint16(142, true),
        redPlayers: view.getUint16(144, true),
        greenPlayers: view.getUint16(146, true),
        redBoxes: d[148],
        greenBoxes: d[149],
        pool: view.getBigUint64(150, true),
        flips: view.getBigUint64(158, true),
        seed: d[166],
        winner: d[167],
        bump: d[168],
        boxes,
      });
    }
    return games.sort((a, b) => (b.id > a.id ? 1 : b.id < a.id ? -1 : 0));
  } catch (e) {
    console.error("Failed to fetch all games:", e);
    return [];
  }
}

export async function fetchPlayer(connection: Connection, gameId: bigint, wallet: PublicKey): Promise<PlayerState | null> {
  try {
    const playerPubkey = pda.player(pda.game(gameId), wallet);
    const info = await connection.getAccountInfo(playerPubkey);
    if (!info || !info.owner.equals(PROGRAM_ID) || info.data.length !== 96 || info.data[0] !== 3) return null;
    const d = info.data;
    const view = new DataView(d.buffer, d.byteOffset, d.byteLength);
    return {
      game: new PublicKey(d.subarray(1, 33)),
      wallet: new PublicKey(d.subarray(33, 65)),
      joinIndex: view.getUint16(65, true),
      team: d[67],
      contributed: view.getBigUint64(68, true),
      unusedCredits: view.getBigUint64(76, true),
      claimed: d[84] !== 0,
      bump: d[85],
    };
  } catch {
    return null;
  }
}

export async function fetchBalances(connection: Connection, wallet: PublicKey): Promise<{ sol: number; game: bigint }> {
  let sol = 0;
  let game = 0n;
  try {
    sol = await connection.getBalance(wallet);
  } catch {}
  try {
    const ata = getAssociatedTokenAddressSync(GAME_MINT, wallet);
    const bal = await connection.getTokenAccountBalance(ata);
    game = BigInt(bal.value.amount);
  } catch {}
  return { sol, game };
}

export async function resolveErEndpoint(game: PublicKey): Promise<string | null> {
  const response = await fetch(ROUTER_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getDelegationStatus", params: [game.toBase58()] }) });
  const json = await response.json(); return json?.result?.fqdn ?? null;
}
