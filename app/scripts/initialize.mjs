import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("CXwaGjunkFBADtqeD7HTXbVxBSaomY9ck6mjTbnYBCMA");
const MINT = new PublicKey(process.argv[2]);
const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const walletPath = process.env.SOLANA_KEYPAIR ?? path.join(os.homedir(), ".config", "solana", "id.json");
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf8"))));
const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
const [treasury] = PublicKey.findProgramAddressSync([Buffer.from("treasury")], PROGRAM_ID);
const initialize = new TransactionInstruction({ programId: PROGRAM_ID, keys: [
  { pubkey: payer.publicKey, isSigner: true, isWritable: true }, { pubkey: config, isSigner: false, isWritable: true },
  { pubkey: treasury, isSigner: false, isWritable: true }, { pubkey: MINT, isSigner: false, isWritable: false },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
], data: Buffer.from([0]) });
const initTx = new Transaction().add(initialize); initTx.feePayer = payer.publicKey; initTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
const simulation = await connection.simulateTransaction(initTx, [payer]);
if (simulation.value.err) throw new Error(`Initialize simulation failed: ${JSON.stringify(simulation.value.err)}\n${simulation.value.logs?.join("\n")}`);
const initializeSignature = await sendAndConfirmTransaction(connection, initTx, [payer]);
console.log(JSON.stringify({ initializeSignature, mint: MINT.toBase58(), config: config.toBase58(), treasury: treasury.toBase58() }, null, 2));
