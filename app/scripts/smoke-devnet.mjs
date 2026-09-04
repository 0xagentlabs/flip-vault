import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Connection, Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import {
  BASE_RPC, PROGRAM_ID, buyIxs, claimIx, createGameIxs, delegateIx,
  findAvailableGameId, flipIx, joinIx, pda, resolveErEndpoint, simpleGameIx, undelegateIx,
} from "../src/lib/program.ts";

const keypairPath = process.env.SOLANA_KEYPAIR ?? path.join(os.homedir(), ".config", "solana", "id.json");
const creator = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8"))));
const player2 = Keypair.generate();
const base = new Connection(BASE_RPC, "confirmed");

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function chainTime(connection) {
  const slot = await connection.getSlot("confirmed");
  const value = await connection.getBlockTime(slot);
  if (value === null) throw new Error("chain time unavailable");
  return BigInt(value);
}
async function send(connection, instructions, signers, label) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const tx = new Transaction().add(...(Array.isArray(instructions) ? instructions : [instructions]));
    tx.feePayer = signers[0].publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
    tx.sign(...signers);
    const simulation = connection === base
      ? (await connection._rpcRequest("simulateTransaction", [tx.serialize().toString("base64"), { encoding: "base64", replaceRecentBlockhash: true, sigVerify: false, commitment: "confirmed" }])).result?.value
      : (await connection.simulateTransaction(tx)).value;
    if (!simulation) throw new Error(`${label}: simulation RPC returned no result`);
    if (simulation.err === "BlockhashNotFound" && attempt < 2) {
      await pause(1_000);
      continue;
    }
    if (simulation.err) throw new Error(`${label} simulation: ${JSON.stringify(simulation.err)}\n${simulation.logs?.join("\n")}`);
    const signature = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(signature, "confirmed");
    console.log(`${label}: ${signature}`);
    return signature;
  }
  throw new Error(`${label}: exhausted retries`);
}

async function waitForEndpoint(account) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const endpoint = await resolveErEndpoint(account);
    if (endpoint) return endpoint;
    await pause(2_000);
  }
  throw new Error(`delegation endpoint timeout: ${account.toBase58()}`);
}

async function waitForBaseOwner(account) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const info = await base.getAccountInfo(account);
    if (info?.owner.equals(PROGRAM_ID)) return;
    await pause(2_000);
  }
  throw new Error(`undelegation timeout: ${account.toBase58()}`);
}

const gameId = await findAvailableGameId(base, BigInt(Math.floor(Date.now() / 1000)));
const game = pda.game(gameId);
const player1Pda = pda.player(game, creator.publicKey);
const player2Pda = pda.player(game, player2.publicKey);
const startAt = (await chainTime(base)) + 20n;

await send(base, SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: player2.publicKey, lamports: 100_000_000 }), [creator], "fund-player-2");
await send(base, buyIxs(creator.publicKey, 40n), [creator], "buy-player-1");
await send(base, buyIxs(player2.publicKey, 40n), [player2], "buy-player-2");
await send(base, createGameIxs(creator.publicKey, gameId, startAt), [creator], "create-game");
await send(base, joinIx(creator.publicKey, gameId, 2n), [creator], "join-player-1");
await send(base, joinIx(player2.publicKey, gameId, 2n), [player2], "join-player-2");

while ((await chainTime(base)) < startAt) await pause(1_000);
await send(base, simpleGameIx(5, creator.publicKey, gameId), [creator], "start-game");
await send(base, delegateIx(creator.publicKey, gameId, 1), [creator], "delegate-player-1");
await send(base, delegateIx(player2.publicKey, gameId, 1), [player2], "delegate-player-2");
await send(base, delegateIx(creator.publicKey, gameId, 0), [creator], "delegate-game");

const [gameEndpoint, player1Endpoint, player2Endpoint] = await Promise.all([
  waitForEndpoint(game), waitForEndpoint(player1Pda), waitForEndpoint(player2Pda),
]);
if (gameEndpoint !== player1Endpoint || gameEndpoint !== player2Endpoint) throw new Error("delegated accounts landed on different ER endpoints");
const er = new Connection(gameEndpoint, "confirmed");
await send(er, flipIx(creator.publicKey, gameId, 0), [creator], "flip-player-1");
await send(er, flipIx(player2.publicKey, gameId, 1), [player2], "flip-player-2");

const gameData = (await er.getAccountInfo(game))?.data;
if (!gameData) throw new Error("game missing from ER");
const endAt = new DataView(gameData.buffer, gameData.byteOffset, gameData.byteLength).getBigInt64(134, true);
while ((await chainTime(er)) <= endAt) await pause(1_000);
await send(er, simpleGameIx(7, creator.publicKey, gameId), [creator], "finalize-game");
await send(er, undelegateIx(creator.publicKey, player1Pda), [creator], "undelegate-player-1");
await send(er, undelegateIx(player2.publicKey, player2Pda), [player2], "undelegate-player-2");
await send(er, undelegateIx(creator.publicKey, game), [creator], "undelegate-game");
await Promise.all([waitForBaseOwner(game), waitForBaseOwner(player1Pda), waitForBaseOwner(player2Pda)]);
await send(base, claimIx(creator.publicKey, gameId), [creator], "claim-player-1");
await send(base, claimIx(player2.publicKey, gameId), [player2], "claim-player-2");

console.log(JSON.stringify({ gameId: gameId.toString(), game: game.toBase58(), er: gameEndpoint, players: [creator.publicKey.toBase58(), player2.publicKey.toBase58()] }, null, 2));
