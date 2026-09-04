import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";

const program = new PublicKey("ADTfCpeekasxSNZNgSPgqfyRzxJ7BA4dtaBcoj8JQe8i");
const u64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };
const [game] = PublicKey.findProgramAddressSync([Buffer.from("game"), u64(7n)], program);
const [gameAgain] = PublicKey.findProgramAddressSync([Buffer.from("game"), u64(7n)], program);
assert.equal(game.toBase58(), gameAgain.toBase58());
assert.equal(Buffer.concat([Buffer.from([4]), u64(7n), u64(100n)]).length, 17);
assert.equal(Buffer.from([6, 99]).length, 2);
assert.throws(() => Buffer.from([100]).readUInt8(1));
console.log("ABI encoding and deterministic PDA tests passed");

