"use client";
import { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";
import { BASE_RPC } from "@/lib/program";
export function Providers({ children }: { children: React.ReactNode }) { const wallets = useMemo(() => [], []); return <ConnectionProvider endpoint={BASE_RPC}><WalletProvider wallets={wallets} autoConnect><WalletModalProvider>{children}</WalletModalProvider></WalletProvider></ConnectionProvider>; }
