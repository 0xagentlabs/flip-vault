#![no_std]
#![allow(unexpected_cfgs)]

use core::mem::MaybeUninit;
use ephemeral_rollups_pinocchio::{
    consts::EXTERNAL_UNDELEGATE_DISCRIMINATOR,
    instruction::{DelegateAccountCpiBuilder, undelegate},
    intent_bundle::MagicIntentBundleBuilder,
    types::DelegateConfig,
};
use pinocchio::{
    Address, MAX_TX_ACCOUNTS, ProgramResult, SUCCESS,
    account::AccountView,
    cpi::{Seed, Signer},
    entrypoint::deserialize,
    error::ProgramError,
    no_allocator, nostd_panic_handler,
    sysvars::{Sysvar, clock::Clock, rent::Rent},
};
use pinocchio_system::instructions::{CreateAccount, Transfer as LamportTransfer};
use pinocchio_token::instructions::{Burn, MintTo, Transfer};

pub const ID: Address = Address::from_str_const("ADTfCpeekasxSNZNgSPgqfyRzxJ7BA4dtaBcoj8JQe8i");

const CONFIG_SEED: &[u8] = b"config";
const TREASURY_SEED: &[u8] = b"treasury";
const GAME_SEED: &[u8] = b"game";
const PLAYER_SEED: &[u8] = b"player";
const CONFIG_SIZE: usize = 96;
const GAME_SIZE: usize = 224;
const PLAYER_SIZE: usize = 96;
const TOKEN_SCALE: u64 = 1_000_000;
const TOKEN_PRICE_LAMPORTS: u64 = 1_000_000;
const GUARANTEE: u64 = 30 * TOKEN_SCALE;
const FLIP_COST: u64 = TOKEN_SCALE;
const MIN_PLAYERS: u16 = 1;
const MAX_PLAYERS: u16 = 100;
const PLAY_SECONDS: i64 = 300;
const INTENT_BUNDLE_SIZE: usize = 512;
const DELEGATION_RENT_BUFFER: u64 = 10_000_000;

const E_INVALID_DATA: u32 = 6000;
const E_INVALID_ACCOUNT: u32 = 6001;
const E_INVALID_OWNER: u32 = 6002;
const E_ALREADY_INITIALIZED: u32 = 6003;
const E_BAD_STATUS: u32 = 6004;
const E_JOIN_CLOSED: u32 = 6005;
const E_PLAYER_LIMIT: u32 = 6006;
const E_INSUFFICIENT_PLAYERS: u32 = 6007;
const E_GAME_NOT_ACTIVE: u32 = 6008;
const E_GAME_NOT_ENDED: u32 = 6009;
const E_OUT_OF_CREDITS: u32 = 6010;
const E_ALREADY_CLAIMED: u32 = 6011;
const E_NOT_WINNER: u32 = 6012;
const E_MATH: u32 = 6013;
const E_RESERVE: u32 = 6014;

fn err(code: u32) -> ProgramError {
    ProgramError::Custom(code)
}
fn checked_add(a: u64, b: u64) -> Result<u64, ProgramError> {
    a.checked_add(b).ok_or(err(E_MATH))
}
fn checked_mul(a: u64, b: u64) -> Result<u64, ProgramError> {
    a.checked_mul(b).ok_or(err(E_MATH))
}
fn team_for_index(index: u16, seed: u8) -> u8 {
    ((index as u8).wrapping_add(seed & 1)) & 1
}
fn winner_for_boxes(red: u8, green: u8) -> u8 {
    if red > green {
        1
    } else if green > red {
        2
    } else {
        3
    }
}
fn reward_for(
    winner: u8,
    team: u8,
    contributed: u64,
    pool: u64,
    winners: u64,
    players: u16,
) -> Result<u64, ProgramError> {
    // A solo game has no opponent, so the only player receives the complete
    // contributed pool regardless of the board's final colour majority.
    if players == 1 {
        return Ok(pool);
    }
    if winner == 3 {
        return Ok(contributed);
    }
    if (winner == 1 && team == 0) || (winner == 2 && team == 1) {
        if winners == 0 {
            return Err(err(E_MATH));
        }
        return Ok(pool / winners);
    }
    Ok(0)
}
fn read_u64(data: &[u8], at: usize) -> Result<u64, ProgramError> {
    let value = data.get(at..at + 8).ok_or(err(E_INVALID_DATA))?;
    Ok(u64::from_le_bytes(
        value.try_into().map_err(|_| err(E_INVALID_DATA))?,
    ))
}
fn read_i64(data: &[u8], at: usize) -> Result<i64, ProgramError> {
    let value = data.get(at..at + 8).ok_or(err(E_INVALID_DATA))?;
    Ok(i64::from_le_bytes(
        value.try_into().map_err(|_| err(E_INVALID_DATA))?,
    ))
}
fn read_u16(data: &[u8], at: usize) -> Result<u16, ProgramError> {
    let value = data.get(at..at + 2).ok_or(err(E_INVALID_DATA))?;
    Ok(u16::from_le_bytes(
        value.try_into().map_err(|_| err(E_INVALID_DATA))?,
    ))
}
fn write_u64(data: &mut [u8], at: usize, value: u64) -> ProgramResult {
    data.get_mut(at..at + 8)
        .ok_or(err(E_INVALID_DATA))?
        .copy_from_slice(&value.to_le_bytes());
    Ok(())
}
fn write_i64(data: &mut [u8], at: usize, value: i64) -> ProgramResult {
    data.get_mut(at..at + 8)
        .ok_or(err(E_INVALID_DATA))?
        .copy_from_slice(&value.to_le_bytes());
    Ok(())
}
fn write_u16(data: &mut [u8], at: usize, value: u16) -> ProgramResult {
    data.get_mut(at..at + 2)
        .ok_or(err(E_INVALID_DATA))?
        .copy_from_slice(&value.to_le_bytes());
    Ok(())
}
fn require_signer(account: &AccountView) -> ProgramResult {
    if !account.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    Ok(())
}
fn require_writable(account: &AccountView) -> ProgramResult {
    if !account.is_writable() {
        return Err(err(E_INVALID_ACCOUNT));
    }
    Ok(())
}
fn require_program_owned(account: &AccountView, program_id: &Address) -> ProgramResult {
    if unsafe { account.owner() } != program_id {
        return Err(err(E_INVALID_OWNER));
    }
    Ok(())
}
fn require_token_account(
    account: &AccountView,
    mint: &Address,
    authority: &Address,
) -> ProgramResult {
    if unsafe { account.owner() } != &pinocchio_token::ID {
        return Err(err(E_INVALID_OWNER));
    }
    let data = account.try_borrow()?;
    if data.len() < 165 || &data[0..32] != mint.as_ref() || &data[32..64] != authority.as_ref() {
        return Err(err(E_INVALID_ACCOUNT));
    }
    Ok(())
}
fn create_pda<'a>(
    payer: &'a AccountView,
    pda: &'a AccountView,
    system: &AccountView,
    program_id: &Address,
    size: usize,
    seeds: &[Seed<'a>],
) -> ProgramResult {
    require_signer(payer)?;
    require_writable(payer)?;
    require_writable(pda)?;
    if system.address() != &pinocchio_system::ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    if pda.lamports() != 0 {
        return Err(err(E_ALREADY_INITIALIZED));
    }
    let rent = Rent::get()?.try_minimum_balance(size)?;
    let lamports = if size == GAME_SIZE || size == PLAYER_SIZE {
        checked_add(rent, DELEGATION_RENT_BUFFER)?
    } else {
        rent
    };
    CreateAccount {
        from: payer,
        to: pda,
        lamports,
        space: size as u64,
        owner: program_id,
    }
    .invoke_signed(&[Signer::from(seeds)])
}

fn initialize(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    let [admin, config, treasury, mint, system] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    require_signer(admin)?;
    let (config_key, config_bump) = Address::find_program_address(&[CONFIG_SEED], program_id);
    let (treasury_key, treasury_bump) = Address::find_program_address(&[TREASURY_SEED], program_id);
    if config.address() != &config_key || treasury.address() != &treasury_key {
        return Err(ProgramError::InvalidSeeds);
    }
    let config_bump_bytes = [config_bump];
    create_pda(
        admin,
        config,
        system,
        program_id,
        CONFIG_SIZE,
        &[Seed::from(CONFIG_SEED), Seed::from(&config_bump_bytes)],
    )?;
    let treasury_bump_bytes = [treasury_bump];
    create_pda(
        admin,
        treasury,
        system,
        program_id,
        0,
        &[Seed::from(TREASURY_SEED), Seed::from(&treasury_bump_bytes)],
    )?;
    let mut data = config.try_borrow_mut()?;
    data[0] = 1;
    data[1..33].copy_from_slice(admin.address().as_ref());
    data[33..65].copy_from_slice(mint.address().as_ref());
    write_u64(&mut data, 65, 0)?;
    write_u64(&mut data, 73, TOKEN_PRICE_LAMPORTS)?;
    data[81] = config_bump;
    data[82] = treasury_bump;
    data[83] = 6;
    Ok(())
}

fn buy(program_id: &Address, accounts: &mut [AccountView], amount: u64) -> ProgramResult {
    let [
        buyer,
        config,
        treasury,
        mint,
        buyer_token,
        system,
        token_program,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    require_signer(buyer)?;
    if amount == 0 {
        return Err(err(E_INVALID_DATA));
    }
    require_program_owned(config, program_id)?;
    if token_program.address() != &pinocchio_token::ID || system.address() != &pinocchio_system::ID
    {
        return Err(ProgramError::IncorrectProgramId);
    }
    let data = config.try_borrow()?;
    if data[0] != 1 || &data[33..65] != mint.address().as_ref() {
        return Err(err(E_INVALID_ACCOUNT));
    }
    require_token_account(buyer_token, mint.address(), buyer.address())?;
    let lamports = checked_mul(amount, read_u64(&data, 73)?)?;
    LamportTransfer {
        from: buyer,
        to: treasury,
        lamports,
    }
    .invoke()?;
    let bump = [data[81]];
    MintTo {
        mint,
        account: buyer_token,
        mint_authority: config,
        amount: checked_mul(amount, TOKEN_SCALE)?,
    }
    .invoke_signed(&[Signer::from(&[Seed::from(CONFIG_SEED), Seed::from(&bump)])])
}

fn redeem(program_id: &Address, accounts: &mut [AccountView], amount: u64) -> ProgramResult {
    let [user, config, treasury, mint, user_token, token_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    require_signer(user)?;
    if amount == 0 {
        return Err(err(E_INVALID_DATA));
    }
    require_writable(user)?;
    require_writable(treasury)?;
    require_program_owned(config, program_id)?;
    require_program_owned(treasury, program_id)?;
    if token_program.address() != &pinocchio_token::ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    let data = config.try_borrow()?;
    if &data[33..65] != mint.address().as_ref() {
        return Err(err(E_INVALID_ACCOUNT));
    }
    require_token_account(user_token, mint.address(), user.address())?;
    let lamports = checked_mul(amount, read_u64(&data, 73)?)?;
    let rent_floor = Rent::get()?.try_minimum_balance(0)?;
    if treasury.lamports() < checked_add(lamports, rent_floor)? {
        return Err(err(E_RESERVE));
    }
    Burn {
        account: user_token,
        mint,
        authority: user,
        amount: checked_mul(amount, TOKEN_SCALE)?,
    }
    .invoke()?;
    treasury.set_lamports(
        treasury
            .lamports()
            .checked_sub(lamports)
            .ok_or(err(E_MATH))?,
    );
    user.set_lamports(user.lamports().checked_add(lamports).ok_or(err(E_MATH))?);
    Ok(())
}

fn create_game(
    program_id: &Address,
    accounts: &mut [AccountView],
    game_id: u64,
    start_at: i64,
) -> ProgramResult {
    let [creator, config, game, mint, vault, system] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    require_signer(creator)?;
    require_program_owned(config, program_id)?;
    let id = game_id.to_le_bytes();
    let (game_key, bump) = Address::find_program_address(&[GAME_SEED, &id], program_id);
    if game.address() != &game_key {
        return Err(ProgramError::InvalidSeeds);
    }
    require_writable(config)?;
    let config_data = config.try_borrow()?;
    if &config_data[33..65] != mint.address().as_ref() {
        return Err(err(E_INVALID_ACCOUNT));
    }
    drop(config_data);
    require_token_account(vault, mint.address(), &game_key)?;
    let bump_bytes = [bump];
    create_pda(
        creator,
        game,
        system,
        program_id,
        GAME_SIZE,
        &[
            Seed::from(GAME_SEED),
            Seed::from(&id),
            Seed::from(&bump_bytes),
        ],
    )?;
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    if start_at <= now {
        return Err(err(E_INVALID_DATA));
    }
    let seed = ((clock.slot ^ game_id) & 0xff) as u8;
    let mut data = game.try_borrow_mut()?;
    data[0] = 2;
    write_u64(&mut data, 1, game_id)?;
    data[9..41].copy_from_slice(creator.address().as_ref());
    data[41..73].copy_from_slice(mint.address().as_ref());
    data[73..105].copy_from_slice(vault.address().as_ref());
    data[105] = 0;
    write_i64(&mut data, 106, now)?;
    write_i64(&mut data, 126, start_at)?;
    write_i64(
        &mut data,
        134,
        start_at.checked_add(PLAY_SECONDS).ok_or(err(E_MATH))?,
    )?;
    data[166] = seed;
    data[168] = bump;
    let mut red = 0u8;
    for i in 0..100usize {
        let bit = seed
            .wrapping_mul(73)
            .wrapping_add((i as u8).wrapping_mul(41))
            .rotate_left((i % 7) as u32)
            & 1;
        if bit == 1 {
            data[169 + i / 8] |= 1 << (i % 8);
            red += 1;
        }
    }
    data[148] = red;
    data[149] = 100 - red;
    drop(data);
    let mut config_data = config.try_borrow_mut()?;
    let next_game = game_id.checked_add(1).ok_or(err(E_MATH))?;
    if next_game > read_u64(&config_data, 65)? {
        write_u64(&mut config_data, 65, next_game)?;
    }
    Ok(())
}

fn join(program_id: &Address, accounts: &mut [AccountView], click_credits: u64) -> ProgramResult {
    let [user, game, player, user_token, vault, system, token_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    require_signer(user)?;
    require_program_owned(game, program_id)?;
    let now = Clock::get()?.unix_timestamp;
    let game_key = *game.address();
    let mut g = game.try_borrow_mut()?;
    if g[105] != 0 || now >= read_i64(&g, 126)? {
        return Err(err(E_JOIN_CLOSED));
    }
    let count = read_u16(&g, 142)?;
    if count >= MAX_PLAYERS {
        return Err(err(E_PLAYER_LIMIT));
    }
    if &g[73..105] != vault.address().as_ref() {
        return Err(err(E_INVALID_ACCOUNT));
    }
    let mint = Address::new_from_array(g[41..73].try_into().map_err(|_| err(E_INVALID_DATA))?);
    require_token_account(user_token, &mint, user.address())?;
    require_token_account(vault, &mint, &game_key)?;
    let (player_key, bump) = Address::find_program_address(
        &[PLAYER_SEED, game_key.as_ref(), user.address().as_ref()],
        program_id,
    );
    if player.address() != &player_key {
        return Err(ProgramError::InvalidSeeds);
    }
    let bump_bytes = [bump];
    create_pda(
        user,
        player,
        system,
        program_id,
        PLAYER_SIZE,
        &[
            Seed::from(PLAYER_SEED),
            Seed::from(game_key.as_ref()),
            Seed::from(user.address().as_ref()),
            Seed::from(&bump_bytes),
        ],
    )?;
    let credit_units = checked_mul(click_credits, TOKEN_SCALE)?;
    let total = checked_add(GUARANTEE, credit_units)?;
    if token_program.address() != &pinocchio_token::ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    Transfer {
        from: user_token,
        to: vault,
        authority: user,
        amount: total,
    }
    .invoke()?;
    let team = team_for_index(count, g[166]);
    write_u16(&mut g, 142, count + 1)?;
    let team_offset = if team == 0 { 144 } else { 146 };
    let team_count = read_u16(&g, team_offset)?;
    write_u16(&mut g, team_offset, team_count + 1)?;
    let pool = read_u64(&g, 150)?;
    write_u64(&mut g, 150, checked_add(pool, GUARANTEE)?)?;
    drop(g);
    let mut p = player.try_borrow_mut()?;
    p[0] = 3;
    p[1..33].copy_from_slice(game_key.as_ref());
    p[33..65].copy_from_slice(user.address().as_ref());
    write_u16(&mut p, 65, count)?;
    p[67] = team;
    write_u64(&mut p, 68, GUARANTEE)?;
    write_u64(&mut p, 76, credit_units)?;
    p[85] = bump;
    Ok(())
}

fn start(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    let [caller, game] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    require_signer(caller)?;
    require_program_owned(game, program_id)?;
    let now = Clock::get()?.unix_timestamp;
    let mut g = game.try_borrow_mut()?;
    if g[105] != 0 {
        return Err(err(E_BAD_STATUS));
    }
    let players = read_u16(&g, 142)?;
    if players < MIN_PLAYERS {
        return Err(err(E_INSUFFICIENT_PLAYERS));
    }
    if now < read_i64(&g, 126)? && players < MAX_PLAYERS {
        return Err(err(E_JOIN_CLOSED));
    }
    g[105] = 1;
    if players == MAX_PLAYERS {
        write_i64(&mut g, 134, now + PLAY_SECONDS)?;
    }
    Ok(())
}

fn flip(program_id: &Address, accounts: &mut [AccountView], index: u8) -> ProgramResult {
    let [user, game, player] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    require_signer(user)?;
    require_program_owned(game, program_id)?;
    require_program_owned(player, program_id)?;
    if index >= 100 {
        return Err(err(E_INVALID_DATA));
    }
    let now = Clock::get()?.unix_timestamp;
    let game_address = *game.address();
    let mut g = game.try_borrow_mut()?;
    if g[105] != 1 || now > read_i64(&g, 134)? {
        return Err(err(E_GAME_NOT_ACTIVE));
    }
    let mut p = player.try_borrow_mut()?;
    if &p[1..33] != game_address.as_ref() || &p[33..65] != user.address().as_ref() {
        return Err(err(E_INVALID_ACCOUNT));
    }
    let credits = read_u64(&p, 76)?;
    if credits < FLIP_COST {
        return Err(err(E_OUT_OF_CREDITS));
    }
    write_u64(&mut p, 76, credits - FLIP_COST)?;
    let contributed = read_u64(&p, 68)?;
    write_u64(&mut p, 68, checked_add(contributed, FLIP_COST)?)?;
    let pool = read_u64(&g, 150)?;
    write_u64(&mut g, 150, checked_add(pool, FLIP_COST)?)?;
    let flips = read_u64(&g, 158)?;
    write_u64(&mut g, 158, checked_add(flips, 1)?)?;
    let byte = 169 + index as usize / 8;
    let mask = 1u8 << (index % 8);
    if g[byte] & mask != 0 {
        g[byte] &= !mask;
        g[148] -= 1;
        g[149] += 1;
    } else {
        g[byte] |= mask;
        g[148] += 1;
        g[149] -= 1;
    }
    Ok(())
}

fn finalize(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    let [caller, game] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    require_signer(caller)?;
    require_program_owned(game, program_id)?;
    let now = Clock::get()?.unix_timestamp;
    let mut g = game.try_borrow_mut()?;
    if g[105] != 1 {
        return Err(err(E_BAD_STATUS));
    }
    if now < read_i64(&g, 134)? {
        return Err(err(E_GAME_NOT_ENDED));
    }
    g[105] = 2;
    g[167] = winner_for_boxes(g[148], g[149]);
    Ok(())
}

fn claim(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    let [user, game, player, vault, user_token, token_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    require_signer(user)?;
    require_program_owned(game, program_id)?;
    require_program_owned(player, program_id)?;
    if token_program.address() != &pinocchio_token::ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    let g = game.try_borrow()?;
    let mut p = player.try_borrow_mut()?;
    if g[105] != 2 {
        return Err(err(E_BAD_STATUS));
    }
    if p[84] != 0 {
        return Err(err(E_ALREADY_CLAIMED));
    }
    if &p[1..33] != game.address().as_ref()
        || &p[33..65] != user.address().as_ref()
        || &g[73..105] != vault.address().as_ref()
    {
        return Err(err(E_INVALID_ACCOUNT));
    }
    let mint = Address::new_from_array(g[41..73].try_into().map_err(|_| err(E_INVALID_DATA))?);
    require_token_account(vault, &mint, game.address())?;
    require_token_account(user_token, &mint, user.address())?;
    let contributed = read_u64(&p, 68)?;
    let unused = read_u64(&p, 76)?;
    let winner = g[167];
    let team = p[67];
    let winners = if winner == 1 {
        read_u16(&g, 144)?
    } else {
        read_u16(&g, 146)?
    } as u64;
    let reward = reward_for(
        winner,
        team,
        contributed,
        read_u64(&g, 150)?,
        winners,
        read_u16(&g, 142)?,
    )?;
    let amount = checked_add(reward, unused)?;
    if reward == 0 && unused == 0 {
        return Err(err(E_NOT_WINNER));
    }
    let id = read_u64(&g, 1)?.to_le_bytes();
    let bump = [g[168]];
    Transfer {
        from: vault,
        to: user_token,
        authority: game,
        amount,
    }
    .invoke_signed(&[Signer::from(&[
        Seed::from(GAME_SEED),
        Seed::from(&id),
        Seed::from(&bump),
    ])])?;
    p[84] = 1;
    write_u64(&mut p, 76, 0)?;
    Ok(())
}

fn delegate(
    program_id: &Address,
    accounts: &mut [AccountView],
    kind: u8,
    game_id: u64,
) -> ProgramResult {
    let [
        payer,
        target,
        owner_program,
        buffer,
        record,
        metadata,
        system,
        _delegation_program,
        validator,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    require_signer(payer)?;
    if owner_program.address() != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    let id = game_id.to_le_bytes();
    let game = Address::find_program_address(&[GAME_SEED, &id], program_id).0;
    if kind == 0 {
        let (expected, bump) = Address::find_program_address(&[GAME_SEED, &id], program_id);
        if target.address() != &expected {
            return Err(ProgramError::InvalidSeeds);
        }
        require_program_owned(target, program_id)?;
        let data = target.try_borrow()?;
        if data.len() != GAME_SIZE
            || data[0] != 2
            || data[105] != 1
            || &data[9..41] != payer.address().as_ref()
        {
            return Err(err(E_BAD_STATUS));
        }
        drop(data);
        DelegateAccountCpiBuilder::new(
            payer,
            target,
            owner_program,
            buffer,
            record,
            metadata,
            system,
        )
        .config(DelegateConfig {
            commit_frequency_ms: 5_000,
            validator: Some(*validator.address()),
        })
        .seeds(&[GAME_SEED, &id])
        .bump(bump)
        .invoke()
    } else {
        let (expected, bump) = Address::find_program_address(
            &[PLAYER_SEED, game.as_ref(), payer.address().as_ref()],
            program_id,
        );
        if target.address() != &expected {
            return Err(ProgramError::InvalidSeeds);
        }
        DelegateAccountCpiBuilder::new(
            payer,
            target,
            owner_program,
            buffer,
            record,
            metadata,
            system,
        )
        .config(DelegateConfig {
            commit_frequency_ms: 5_000,
            validator: Some(*validator.address()),
        })
        .seeds(&[PLAYER_SEED, game.as_ref(), payer.address().as_ref()])
        .bump(bump)
        .invoke()
    }
}

fn commit_and_undelegate(accounts: &mut [AccountView]) -> ProgramResult {
    let [payer, target, magic_context, magic_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    require_signer(payer)?;
    let mut data = [0u8; INTENT_BUNDLE_SIZE];
    MagicIntentBundleBuilder::new(*payer, *magic_context, *magic_program)
        .commit_and_undelegate(core::slice::from_ref(target))
        .build_and_invoke(&mut data)
}
fn callback_undelegate(
    program_id: &Address,
    accounts: &mut [AccountView],
    data: &[u8],
) -> ProgramResult {
    let [delegated, buffer, payer, _system, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    undelegate(delegated, program_id, buffer, payer, data)
}

#[derive(Clone, Copy)]
enum Ix {
    Initialize,
    Buy,
    Redeem,
    CreateGame,
    Join,
    Start,
    Flip,
    Finalize,
    Claim,
    Delegate,
    CommitUndelegate,
}
impl TryFrom<u8> for Ix {
    type Error = ProgramError;
    fn try_from(v: u8) -> Result<Self, Self::Error> {
        Ok(match v {
            0 => Self::Initialize,
            1 => Self::Buy,
            2 => Self::Redeem,
            3 => Self::CreateGame,
            4 => Self::Join,
            5 => Self::Start,
            6 => Self::Flip,
            7 => Self::Finalize,
            8 => Self::Claim,
            9 => Self::Delegate,
            10 => Self::CommitUndelegate,
            _ => return Err(err(E_INVALID_DATA)),
        })
    }
}
pub fn process_instruction(
    program_id: &Address,
    accounts: &mut [AccountView],
    data: &[u8],
) -> ProgramResult {
    if program_id != &ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    if data.starts_with(&EXTERNAL_UNDELEGATE_DISCRIMINATOR) {
        return callback_undelegate(
            program_id,
            accounts,
            &data[EXTERNAL_UNDELEGATE_DISCRIMINATOR.len()..],
        );
    }
    let (&tag, payload) = data.split_first().ok_or(err(E_INVALID_DATA))?;
    match Ix::try_from(tag)? {
        Ix::Initialize => initialize(program_id, accounts),
        Ix::Buy => buy(program_id, accounts, read_u64(payload, 0)?),
        Ix::Redeem => redeem(program_id, accounts, read_u64(payload, 0)?),
        Ix::CreateGame => create_game(
            program_id,
            accounts,
            read_u64(payload, 0)?,
            read_i64(payload, 8)?,
        ),
        Ix::Join => join(program_id, accounts, read_u64(payload, 8)?),
        Ix::Start => start(program_id, accounts),
        Ix::Flip => flip(
            program_id,
            accounts,
            *payload.first().ok_or(err(E_INVALID_DATA))?,
        ),
        Ix::Finalize => finalize(program_id, accounts),
        Ix::Claim => claim(program_id, accounts),
        Ix::Delegate => delegate(
            program_id,
            accounts,
            *payload.first().ok_or(err(E_INVALID_DATA))?,
            read_u64(payload, 1)?,
        ),
        Ix::CommitUndelegate => commit_and_undelegate(accounts),
    }
}

no_allocator!();
nostd_panic_handler!();
#[allow(clippy::missing_safety_doc)]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn entrypoint(input: *mut u8) -> u64 {
    const UNINIT: MaybeUninit<AccountView> = MaybeUninit::uninit();
    let mut accounts = [UNINIT; MAX_TX_ACCOUNTS];
    let (program_id, count, data) = unsafe { deserialize::<MAX_TX_ACCOUNTS>(input, &mut accounts) };
    match process_instruction(
        program_id,
        unsafe { core::slice::from_raw_parts_mut(accounts.as_mut_ptr() as _, count) },
        data,
    ) {
        Ok(()) => SUCCESS,
        Err(e) => e.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn constants_are_consistent() {
        assert_eq!(GUARANTEE, 30_000_000);
        assert_eq!(FLIP_COST, 1_000_000);
        assert_eq!(MIN_PLAYERS, 1);
        assert_eq!(MAX_PLAYERS, 100);
    }
    #[test]
    fn checked_math_rejects_overflow() {
        assert!(checked_add(u64::MAX, 1).is_err());
        assert!(checked_mul(u64::MAX, 2).is_err());
    }
    #[test]
    fn tags_reject_unknown() {
        assert!(Ix::try_from(255).is_err());
    }
    #[test]
    fn fixed_price() {
        assert_eq!(TOKEN_PRICE_LAMPORTS, 1_000_000);
    }
    #[test]
    fn teams_are_balanced_for_even_and_odd_counts() {
        for count in [10u16, 11, 100] {
            let red = (0..count).filter(|i| team_for_index(*i, 77) == 0).count();
            let green = count as usize - red;
            assert!(red.abs_diff(green) <= 1);
        }
    }
    #[test]
    fn tie_refunds_actual_contribution() {
        assert_eq!(reward_for(3, 0, 123, 999, 0, 2).unwrap(), 123);
    }
    #[test]
    fn winning_team_splits_pool_and_loser_gets_zero() {
        assert_eq!(reward_for(1, 0, 100, 1001, 10, 20).unwrap(), 100);
        assert_eq!(reward_for(1, 1, 100, 1001, 10, 20).unwrap(), 0);
    }
    #[test]
    fn solo_player_receives_the_entire_pool_regardless_of_board_winner() {
        assert_eq!(reward_for(1, 1, 125, 125, 1, 1).unwrap(), 125);
        assert_eq!(reward_for(2, 0, 125, 125, 0, 1).unwrap(), 125);
        assert_eq!(reward_for(3, 0, 125, 125, 0, 1).unwrap(), 125);
    }
    #[test]
    fn winner_uses_box_majority() {
        assert_eq!(winner_for_boxes(51, 49), 1);
        assert_eq!(winner_for_boxes(50, 50), 3);
    }
}
