# Flip Vault

Flip Vault 提供两种游戏执行模式：默认的 **Solana Devnet 纯链上模式**用于稳定验证完整流程；可选的 **MagicBlock Ephemeral Rollup 模式**用于低延迟翻箱。模式选择只影响客户端交易路由，不改变合约 ABI。

基于 Solana Devnet 与 MagicBlock Ephemeral Rollup 的 10×10 实时翻箱游戏。Pinocchio 程序负责代币兑换、报名、预存点击额度、阵营、翻箱、结算和领取；Next.js dApp 提供完整交互页面。

- Program ID：`ADTfCpeekasxSNZNgSPgqfyRzxJ7BA4dtaBcoj8JQe8i`
- ABI：`docs/ABI.md`
- 使用说明：`docs/项目使用说明书.md`

```bash
NO_DNA=1 cargo test
NO_DNA=1 cargo build-sbf
cd app && pnpm install && pnpm run build
```

> GAME 与 SOL 的兑换仅运行在 Devnet，所有资产都没有现实价值。
