'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Asset Alias Resolution Map
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Crypto assets are often referred to by multiple names across different
 * platforms and user inputs. This module provides a single source of truth
 * for normalizing asset identifiers to their canonical ticker symbols.
 *
 * Business Context:
 *   - Users may type "bitcoin" or "Bitcoin" instead of "BTC"
 *   - Some exchanges use "XBT" (ISO 4217 proposed code) instead of "BTC"
 *   - Case-insensitive matching is required per the assignment spec
 *
 * Adding a new alias:
 *   Simply add a new key-value pair below. The key must be lowercase.
 *   The matching engine will automatically pick it up — no other changes needed.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const ASSET_ALIASES = Object.freeze({
  // ── Bitcoin variants ─────────────────────────────────────────────────────
  bitcoin: 'BTC',
  xbt: 'BTC',       // ISO 4217 proposed code used by some exchanges (e.g., Kraken)
  btc: 'BTC',

  // ── Ethereum variants ────────────────────────────────────────────────────
  ethereum: 'ETH',
  ether: 'ETH',
  eth: 'ETH',

  // ── Solana ───────────────────────────────────────────────────────────────
  solana: 'SOL',
  sol: 'SOL',

  // ── Tether (USDT) ───────────────────────────────────────────────────────
  tether: 'USDT',
  usdt: 'USDT',

  // ── Polygon (MATIC) ─────────────────────────────────────────────────────
  polygon: 'MATIC',
  matic: 'MATIC',

  // ── Chainlink ────────────────────────────────────────────────────────────
  chainlink: 'LINK',
  link: 'LINK',
});

/**
 * Resolves a raw asset string to its canonical ticker symbol.
 *
 * Resolution strategy:
 *   1. Trim whitespace and lowercase the input
 *   2. Look up in the alias map
 *   3. If no alias found, return the uppercased input as-is
 *      (unknown assets are still stored consistently)
 *
 * @param {string} rawAsset - The asset identifier from the CSV (e.g., "bitcoin", "BTC", "xbt")
 * @returns {string} Canonical uppercase ticker symbol (e.g., "BTC")
 *
 * @example
 *   canonicalAsset('bitcoin')  // → 'BTC'
 *   canonicalAsset('XBT')      // → 'BTC'
 *   canonicalAsset('DOGE')     // → 'DOGE' (unknown, uppercased as-is)
 *   canonicalAsset('')         // → ''
 */
function canonicalAsset(rawAsset) {
  if (!rawAsset || typeof rawAsset !== 'string') {
    return '';
  }

  const normalizedKey = rawAsset.trim().toLowerCase();
  return ASSET_ALIASES[normalizedKey] || rawAsset.trim().toUpperCase();
}

module.exports = { ASSET_ALIASES, canonicalAsset };
