import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";

const PROGRAM_ID = new PublicKey("ADTfCpeekasxSNZNgSPgqfyRzxJ7BA4dtaBcoj8JQe8i");
const MINT = new PublicKey(process.argv[2]);
const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const walletPath = process.env.SOLANA_KEYPAIR ?? path.join(os.homedir(), ".config", "solana", "id.json");
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf8"))));
const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
const [treasury] = PublicKey.findProgramAddressSync([Buffer.from("treasury")], PROGRAM_ID);
const id = Buffer.alloc(8); id.writeBigUInt64LE(0n);
const [game] = PublicKey.findProgramAddressSync([Buffer.from("game"), id], PROGRAM_ID);
const vault = getAssociatedTokenAddressSync(MINT, game, true);
const initialize = new TransactionInstruction({ programId: PROGRAM_ID, keys: [
  { pubkey: payer.publicKey, isSigner: true, isWritable: true }, { pubkey: config, isSigner: false, isWritable: true },
  { pubkey: treasury, isSigner: false, isWritable: true }, { pubkey: MINT, isSigner: false, isWritable: false },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
], data: Buffer.from([0]) });
const initTx = new Transaction().add(initialize); initTx.feePayer = payer.publicKey; initTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
const simulation = await connection.simulateTransaction(initTx, [payer]);
if (simulation.value.err) throw new Error(`Initialize simulation failed: ${JSON.stringify(simulation.value.err)}\n${simulation.value.logs?.join("\n")}`);
const initializeSignature = await sendAndConfirmTransaction(connection, initTx, [payer]);
const createGame = new TransactionInstruction({ programId: PROGRAM_ID, keys: [
  { pubkey: payer.publicKey, isSigner: true, isWritable: true }, { pubkey: config, isSigner: false, isWritable: false },
  { pubkey: game, isSigner: false, isWritable: true }, { pubkey: MINT, isSigner: false, isWritable: false },
  { pubkey: vault, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
], data: Buffer.concat([Buffer.from([3]), id]) });
const gameTx = new Transaction().add(createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, vault, game, MINT), createGame);
gameTx.feePayer = payer.publicKey; gameTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
const gameSimulation = await connection.simulateTransaction(gameTx, [payer]);
if (gameSimulation.value.err) throw new Error(`Create game simulation failed: ${JSON.stringify(gameSimulation.value.err)}\n${gameSimulation.value.logs?.join("\n")}`);
const gameSignature = await sendAndConfirmTransaction(connection, gameTx, [payer]);
console.log(JSON.stringify({ initializeSignature, gameSignature, mint: MINT.toBase58(), config: config.toBase58(), treasury: treasury.toBase58(), game: game.toBase58(), vault: vault.toBase58() }, null, 2));
