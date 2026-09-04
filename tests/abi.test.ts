import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  PROGRAM_ID,
  DELEGATION_PROGRAM,
  SOLANA_RPC,
  pda,
  buyIx,
  buyIxs,
  redeemIx,
  createGameIx,
  joinIx,
  simpleGameIx,
  flipIx,
  claimIx,
  delegateIx,
  undelegateIx,
  u64,
  i64,
  fetchGame,
  fetchGameSnapshot,
  findAvailableGameId,
  resolveErEndpoint,
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

const buyInstructions = buyIxs(dummyWallet, 100n);
assert.equal(buyInstructions.length, 2);
assert.equal(buyInstructions[1].data[0], 1);
assert.equal(buyInstructions[1].keys[4].pubkey.toBase58(), buyInstructions[0].keys[1].pubkey.toBase58());

// 3. Redeem instruction encoding
const redeem = redeemIx(dummyWallet, 50n);
assert.equal(redeem.data[0], 2);
assert.equal(redeem.data.length, 9);
assert.equal(redeem.data.readBigUInt64LE(1), 50n);
assert.equal(redeem.keys.length, 6);

// 4. CreateGame instruction encoding
const startAt = 1_800_000_000n;
const createGame = createGameIx(dummyWallet, gameId, startAt);
assert.equal(createGame.data[0], 3);
assert.equal(createGame.data.length, 17);
assert.equal(createGame.data.readBigUInt64LE(1), gameId);
assert.equal(createGame.data.readBigInt64LE(9), startAt);
assert.equal(createGame.keys.length, 6);
assert.equal(createGame.keys[1].isWritable, true);

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

// 12. u64 serialization and Buffer 64-bit BigInt compatibility
const u64Buf = u64(123456789012345n);
assert.equal(u64Buf.length, 8);
const view = new DataView(u64Buf.buffer, u64Buf.byteOffset, 8);
assert.equal(view.getBigUint64(0, true), 123456789012345n);
assert.equal(u64Buf.readBigUInt64LE(0), 123456789012345n);
assert.equal(i64(-123n).readBigInt64LE(0), -123n);

// 13. Game ID allocation must not reuse an existing (including delegated) PDA.
const occupiedIds = new Set(["1", "2"]);
const allocationConnection = {
  getAccountInfo: async (address: PublicKey) => {
    for (const id of occupiedIds) {
      if (address.equals(pda.game(BigInt(id)))) return { owner: PROGRAM_ID };
    }
    return null;
  },
} as unknown as import("@solana/web3.js").Connection;
void (async () => {
  assert.equal(await findAvailableGameId(allocationConnection, 1n), 3n);
  assert.equal(await findAvailableGameId(allocationConnection, 3n), 3n);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

const testBuf = Buffer.alloc(8);
testBuf.writeBigUInt64LE(987654321098765n);
assert.equal(testBuf.readBigUInt64LE(0), 987654321098765n);

// 13. fetchGame account parsing verification
const mockAccountData = Buffer.alloc(224);
mockAccountData[0] = 2; // tag Game
const mockView = new DataView(mockAccountData.buffer, mockAccountData.byteOffset, 224);
mockView.setBigUint64(1, 42n, true); // id
mockAccountData[105] = 1; // status Playing
mockView.setBigInt64(134, 1800000000n, true); // endAt
mockView.setBigInt64(126, 1799999700n, true); // startAt
mockView.setUint16(142, 10, true); // playerCount
mockView.setUint16(144, 4, true); // redPlayers
mockView.setUint16(146, 6, true); // greenPlayers
mockAccountData[148] = 45; // redBoxes
mockAccountData[149] = 55; // greenBoxes
mockView.setBigUint64(150, 5000000000n, true); // pool
mockView.setBigUint64(158, 88n, true); // flips
mockAccountData[167] = 2; // winner

const mockConnection = {
  getAccountInfo: async () => ({
    owner: PROGRAM_ID,
    data: mockAccountData,
    executable: false,
    lamports: 1000000,
  }),
} as any;

async function run() {
  assert.equal(SOLANA_RPC, process.env.NEXT_PUBLIC_SOLANA_RPC ?? "https://api.devnet.solana.com");
  const parsedGame = await fetchGame(mockConnection, 42n);
  assert.notEqual(parsedGame, null);
  assert.equal(parsedGame?.id, 42n);
  assert.equal(parsedGame?.status, 1);
  assert.equal(parsedGame?.startAt, 1799999700n);
  assert.equal(parsedGame?.endAt, 1800000000n);
  assert.equal(parsedGame?.playerCount, 10);
  assert.equal(parsedGame?.redPlayers, 4);
  assert.equal(parsedGame?.greenPlayers, 6);
  assert.equal(parsedGame?.redBoxes, 45);
  assert.equal(parsedGame?.greenBoxes, 55);
  assert.equal(parsedGame?.pool, 5000000000n);
  assert.equal(parsedGame?.flips, 88n);
  assert.equal(parsedGame?.winner, 2);
  assert.equal(parsedGame?.delegated, false);

  // 14. Missing base-layer accounts must not fan out into router requests.
  const originalFetch = globalThis.fetch;
  let routerCalls = 0;
  globalThis.fetch = async () => {
    routerCalls += 1;
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { isDelegated: true, fqdn: "https://devnet-as.magicblock.app/" },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const missingConnection = { getAccountInfo: async () => null } as unknown as import("@solana/web3.js").Connection;
    assert.equal(await fetchGame(missingConnection, 999_999n), null);
    assert.equal(routerCalls, 0);

    // Pure on-chain reads stop at Solana RPC even when an account is delegated.
    const baseOnlyConnection = {
      getAccountInfo: async () => ({ owner: DELEGATION_PROGRAM, data: Buffer.alloc(0) }),
    } as unknown as import("@solana/web3.js").Connection;
    const baseOnlySnapshot = await fetchGameSnapshot(baseOnlyConnection, 42n, null, false);
    assert.equal(baseOnlySnapshot.state, null);
    assert.equal(baseOnlySnapshot.erEndpoint, null);
    assert.equal(routerCalls, 0);

    // Concurrent and repeated status lookups share one request and the short TTL cache.
    const delegatedAccount = Keypair.generate().publicKey;
    const endpoints = await Promise.all([
      resolveErEndpoint(delegatedAccount),
      resolveErEndpoint(delegatedAccount),
      resolveErEndpoint(delegatedAccount),
    ]);
    assert.deepEqual(endpoints, Array(3).fill("https://devnet-as.magicblock.app/"));
    assert.equal(routerCalls, 1);
    assert.equal(await resolveErEndpoint(delegatedAccount), "https://devnet-as.magicblock.app/");
    assert.equal(routerCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("All ABI encodings, discriminators, account layouts, and deterministic PDAs verified successfully!");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
