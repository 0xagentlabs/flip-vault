import { AccountMeta, Connection, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";

export const PROGRAM_ID = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID ?? "ADTfCpeekasxSNZNgSPgqfyRzxJ7BA4dtaBcoj8JQe8i");
export const GAME_MINT = new PublicKey(process.env.NEXT_PUBLIC_GAME_MINT ?? "Ay4P9UVG3X6TQ55JD5e5EWun8hAcUCc8SGn39EG79jdD");
export const BASE_RPC = process.env.NEXT_PUBLIC_BASE_RPC ?? "https://rpc.magicblock.app/devnet";
export const ROUTER_RPC = process.env.NEXT_PUBLIC_ROUTER_RPC ?? "https://devnet-router.magicblock.app";
export const DELEGATION_PROGRAM = new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");
export const VALIDATOR = new PublicKey("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57");
export const MAGIC_CONTEXT = new PublicKey("MagicContext1111111111111111111111111111111");
export const MAGIC_PROGRAM = new PublicKey("Magic11111111111111111111111111111111111111");
const u64 = (value: bigint) => { const out = Buffer.alloc(8); out.writeBigUInt64LE(value); return out; };
export const pda = {
  config: () => PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID)[0],
  treasury: () => PublicKey.findProgramAddressSync([Buffer.from("treasury")], PROGRAM_ID)[0],
  game: (id: bigint) => PublicKey.findProgramAddressSync([Buffer.from("game"), u64(id)], PROGRAM_ID)[0],
  player: (game: PublicKey, wallet: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("player"), game.toBuffer(), wallet.toBuffer()], PROGRAM_ID)[0],
};
const ix = (tag: number, keys: AccountMeta[], payload = Buffer.alloc(0)) => new TransactionInstruction({ programId: PROGRAM_ID, keys, data: Buffer.concat([Buffer.from([tag]), payload]) });
export function buyIx(wallet: PublicKey, amount: bigint) { return ix(1, [
  { pubkey: wallet, isSigner: true, isWritable: true }, { pubkey: pda.config(), isSigner: false, isWritable: false },
  { pubkey: pda.treasury(), isSigner: false, isWritable: true }, { pubkey: GAME_MINT, isSigner: false, isWritable: true },
  { pubkey: getAssociatedTokenAddressSync(GAME_MINT, wallet), isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
], u64(amount)); }
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
export type GameState = { id: bigint; status: number; playerCount: number; redPlayers: number; greenPlayers: number; redBoxes: number; greenBoxes: number; pool: bigint; flips: bigint; endAt: bigint; winner: number; boxes: boolean[] };
export async function fetchGame(connection: Connection, id: bigint): Promise<GameState | null> {
  const info = await connection.getAccountInfo(pda.game(id));
  if (!info || !info.owner.equals(PROGRAM_ID) || info.data.length !== 224 || info.data[0] !== 2) return null;
  const d = info.data; const boxes = Array.from({ length: 100 }, (_, i) => (d[169 + Math.floor(i / 8)] & (1 << (i % 8))) !== 0);
  return { id: d.readBigUInt64LE(1), status: d[105], endAt: d.readBigInt64LE(134), playerCount: d.readUInt16LE(142), redPlayers: d.readUInt16LE(144), greenPlayers: d.readUInt16LE(146), redBoxes: d[148], greenBoxes: d[149], pool: d.readBigUInt64LE(150), flips: d.readBigUInt64LE(158), winner: d[167], boxes };
}
export async function resolveErEndpoint(game: PublicKey): Promise<string | null> {
  const response = await fetch(ROUTER_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getDelegationStatus", params: [game.toBase58()] }) });
  const json = await response.json(); return json?.result?.fqdn ?? null;
}
