# Flip Vault 二进制 ABI

所有整数均为小端序。指令数据首字节为 `u8 tag`；本项目不使用或声称提供 Anchor IDL。

## PDA

| 账户 | Seeds |
|---|---|
| Config | `["config"]` |
| SOL Treasury | `["treasury"]` |
| Game | `["game", game_id:u64]` |
| Player | `["player", game_pubkey, wallet_pubkey]` |

## 指令

| Tag | 指令 | 参数 | 账户顺序 |
|---:|---|---|---|
| 0 | Initialize | 无 | admin `[sw]`, config `[w]`, treasury `[w]`, mint, system |
| 1 | Buy | `amount:u64`（整枚 GAME） | buyer `[sw]`, config, treasury `[w]`, mint `[w]`, buyer ATA `[w]`, system, token |
| 2 | Redeem | `amount:u64` | user `[sw]`, config, treasury `[w]`, mint `[w]`, user ATA `[w]`, token |
| 3 | CreateGame | `game_id:u64, start_at:i64`（Unix 秒，必须晚于链上当前时间） | creator `[sw]`, config `[w]`, game `[w]`, mint, game vault ATA, system |
| 4 | Join | `game_id:u64, click_credits:u64` | user `[sw]`, game `[w]`, player `[w]`, user ATA `[w]`, vault `[w]`, system, token |
| 5 | Start | 无 | caller `[s]`, game `[w]` |
| 6 | Flip | `box_index:u8`（0..99） | player wallet `[s]`, game `[w]`, player `[w]` |
| 7 | Finalize | 无 | caller `[s]`, game `[w]` |
| 8 | Claim | 无 | user `[s]`, game, player `[w]`, vault `[w]`, user ATA `[w]`, token |
| 9 | Delegate | `kind:u8, game_id:u64`；0=game，1=caller player | payer `[sw]`, target `[w]`, owner program, buffer `[w]`, delegation record `[w]`, delegation metadata `[w]`, system, delegation program, validator |
| 10 | CommitAndUndelegate | 无 | payer `[s]`, target `[w]`, Magic Context `[w]`, Magic Program |
| `[196,28,41,206,48,37,51,167]` | Undelegate callback | MagicBlock 编码的 seed payload | delegated `[w]`, buffer `[s]`, payer `[w]`, system, ... |

`s` 表示 signer，`w` 表示 writable。客户端支持两种互斥执行模式：

- **纯链上模式（默认）**：不执行 Tag 9/10，Tag 0～8 全部发送到 Solana Devnet；读取与交易只使用 Solana RPC，不调用 MagicBlock Router/ER；Game 与 Player 始终由本程序持有。
- **MagicBlock ER 模式**：Base Layer 执行 0～5、8、9；委托完成后，6、7、10 发往 Router 返回的 ER `fqdn`。Game 与当前 Player 必须解析到同一 `fqdn` 才能翻箱或结算；Tag 10 回写完成后再在 Base Layer 执行 Tag 8。
- 客户端快照包含 `delegated` 标记：从本程序持有的 Devnet 账户读取时为 `false`，经 Router 定位并从 ER clone 校验读取时为 `true`；大厅据此明确展示执行层状态。

执行模式是客户端路由策略，不写入链上状态，也不改变 Tag 0～10 的二进制布局。已委托的账户不能直接切回纯链上操作，必须先在 ER 执行 CommitAndUndelegate 并等待 Base Layer 恢复本程序 owner。

`Start` 至少需要 1 名已加入玩家，且须到达 `start_at`（或房间提前满 100 人）。当 `player_count == 1` 时，`Claim` 忽略红绿胜负，将完整奖池加未使用点击额度结算给唯一玩家；多人局继续按获胜阵营平分奖池，平局退还各自实际贡献。

委托后的 Game/Player 在 Base Layer 由 Delegation Program 持有。读取方必须先调用 Router `getDelegationStatus`，仅当 `isDelegated=true` 且 `fqdn` 有效时从该 ER endpoint 读取，并继续校验 ER 账户 owner 为本 Program、数据长度和 discriminator。

创建游戏时，客户端不得仅按 `getProgramAccounts(Program ID)` 的可见结果分配编号，因为已委托 Game 会从该结果中消失。客户端须从候选编号开始，在 Base Layer 逐个调用 `getAccountInfo(Game PDA)`，仅使用账户不存在的首个编号；账户存在但 owner 为 Delegation Program 同样视为已占用。
程序会把 Config 的 `next_game` 更新为已创建最大编号加一；大厅按该高水位逐个查询 PDA，并通过 Router 读取已委托账户，因此不依赖单个浏览器的本地缓存。

报名、加入和开局均在 Base Layer 完成。开局前不得委托 Game/Player；进入游戏状态后才委托二者，翻箱和结算发送到 Router 返回的同一 ER `fqdn`。
Game 委托还要求 payer 等于创建者，且链上状态为游戏中；因此客户端无法在报名期提前锁住 Game 并阻断后续玩家加入。

## 状态

### Config（96 bytes）

`disc:u8=1 | admin:32 | mint:32 | next_game:u64 | price_lamports:u64 | config_bump:u8 | treasury_bump:u8 | decimals:u8 | reserved`

### Game（224 bytes）

| Offset | 字段 |
|---:|---|
| 0 | discriminator `2` |
| 1 | game_id `u64` |
| 9 | creator `Pubkey` |
| 41 | mint `Pubkey` |
| 73 | vault `Pubkey` |
| 105 | status：0 报名、1 游戏、2 已结算 |
| 106 | created_at `i64` |
| 126 | start_at `i64`（同时是报名截止时间） |
| 134 | end_at `i64` |
| 142/144/146 | 玩家总数/红方/绿方 `u16` |
| 148/149 | 红箱/绿箱 `u8` |
| 150/158 | 奖池 token units / 翻转次数 `u64` |
| 166/167/168 | seed / winner / bump `u8` |
| 169..182 | 100-bit 箱子位图，1=红、0=绿 |

### Player（96 bytes）

`disc:u8=3 | game:32 | wallet:32 | join_index:u16 | team:u8(0红/1绿) | contributed:u64 | unused_click_credits:u64 | claimed:u8 | bump:u8 | reserved`

## 错误码

`6000` malformed data；`6001` invalid account；`6002` invalid owner；`6003` duplicate init；`6004` bad status；`6005` join closed；`6006` player limit；`6007` insufficient players；`6008` inactive game；`6009` not ended；`6010` no click credits；`6011` already claimed；`6012` no claimable balance；`6013` arithmetic overflow；`6014` insufficient SOL reserve。
