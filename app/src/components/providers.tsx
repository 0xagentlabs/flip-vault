"use client";
import { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";
import { SOLANA_RPC } from "@/lib/program";
export function Providers({ children }: { children: React.ReactNode }) { const wallets = useMemo(() => [], []); return <ConnectionProvider endpoint={SOLANA_RPC}><WalletProvider wallets={wallets} autoConnect><WalletModalProvider>{children}</WalletModalProvider></WalletProvider></ConnectionProvider>; }
