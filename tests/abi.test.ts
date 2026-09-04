import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  PROGRAM_ID,
  pda,
  buyIx,
  redeemIx,
  createGameIx,
  joinIx,
  simpleGameIx,
  flipIx,
  claimIx,
  delegateIx,
  undelegateIx,
} from "../app/src/lib/program";

const dummyWallet = Keypair.generate().publicKey;
const gameId = 7n;

// 1. Deterministic PDA derivations
const config = pda.config();
const treasury = pda.treasury();
const game = pda.game(gameId);
const player = pda.player(game, dummyWallet);

assert.equal(config.toBase58(), PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID)[0].toBase58());
assert.equal(treasury.toBase58(), PublicKey.findProgramAddressSync([Buffer.from("treasury")], PROGRAM_ID)[0].toBase58());
assert.equal(game.toBase58(), PublicKey.findProgramAddressSync([Buffer.from("game"), (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(gameId); return b; })()], PROGRAM_ID)[0].toBase58());
assert.equal(player.toBase58(), PublicKey.findProgramAddressSync([Buffer.from("player"), game.toBuffer(), dummyWallet.toBuffer()], PROGRAM_ID)[0].toBase58());

// 2. Buy instruction encoding
const buy = buyIx(dummyWallet, 100n);
assert.equal(buy.data[0], 1);
assert.equal(buy.data.length, 9);
assert.equal(buy.data.readBigUInt64LE(1), 100n);
assert.equal(buy.keys.length, 7);

// 3. Redeem instruction encoding
const redeem = redeemIx(dummyWallet, 50n);
assert.equal(redeem.data[0], 2);
assert.equal(redeem.data.length, 9);
assert.equal(redeem.data.readBigUInt64LE(1), 50n);
assert.equal(redeem.keys.length, 6);

// 4. CreateGame instruction encoding
const createGame = createGameIx(dummyWallet, gameId);
assert.equal(createGame.data[0], 3);
assert.equal(createGame.data.length, 9);
assert.equal(createGame.data.readBigUInt64LE(1), gameId);
assert.equal(createGame.keys.length, 6);

// 5. Join instruction encoding
const join = joinIx(dummyWallet, gameId, 100n);
assert.equal(join.data[0], 4);
assert.equal(join.data.length, 17);
assert.equal(join.data.readBigUInt64LE(1), gameId);
assert.equal(join.data.readBigUInt64LE(9), 100n);
assert.equal(join.keys.length, 7);

// 6. Start instruction encoding
const start = simpleGameIx(5, dummyWallet, gameId);
assert.equal(start.data[0], 5);
assert.equal(start.data.length, 1);
assert.equal(start.keys.length, 2);

// 7. Flip instruction encoding
const flip = flipIx(dummyWallet, gameId, 42);
assert.equal(flip.data[0], 6);
assert.equal(flip.data.length, 2);
assert.equal(flip.data[1], 42);
assert.equal(flip.keys.length, 3);

// 8. Finalize instruction encoding
const finalize = simpleGameIx(7, dummyWallet, gameId);
assert.equal(finalize.data[0], 7);
assert.equal(finalize.data.length, 1);
assert.equal(finalize.keys.length, 2);

// 9. Claim instruction encoding
const claim = claimIx(dummyWallet, gameId);
assert.equal(claim.data[0], 8);
assert.equal(claim.data.length, 1);
assert.equal(claim.keys.length, 6);

// 10. Delegate instruction encoding (game kind=0 and player kind=1)
const delegateGame = delegateIx(dummyWallet, gameId, 0);
assert.equal(delegateGame.data[0], 9);
assert.equal(delegateGame.data[1], 0);
assert.equal(delegateGame.data.readBigUInt64LE(2), gameId);

const delegatePlayer = delegateIx(dummyWallet, gameId, 1);
assert.equal(delegatePlayer.data[0], 9);
assert.equal(delegatePlayer.data[1], 1);
assert.equal(delegatePlayer.data.readBigUInt64LE(2), gameId);

// 11. Undelegate instruction encoding
const undelegate = undelegateIx(dummyWallet, game);
assert.equal(undelegate.data[0], 10);
assert.equal(undelegate.data.length, 1);
assert.equal(undelegate.keys.length, 4);

console.log("All ABI encodings, discriminators, account layouts, and deterministic PDAs verified successfully!");


