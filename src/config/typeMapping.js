'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Transaction Type Equivalence Mapping
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Business Context:
 *   When a user sends crypto from their wallet to an exchange, the user's
 *   records show "TRANSFER_OUT" while the exchange records show "TRANSFER_IN".
 *   These represent the SAME economic event viewed from opposite perspectives.
 *
 *   The reconciliation engine must treat these as equivalent when matching
 *   transactions across the two data sources.
 *
 * Design Decision:
 *   We use a bidirectional equivalence list rather than a directional map.
 *   This means the engine doesn't need to know which side is "user" vs "exchange"
 *   during matching — it simply checks if two types are equivalent regardless
 *   of direction. This makes the matching logic simpler and more robust.
 *
 * Extending:
 *   To add new equivalences (e.g., DEPOSIT ↔ RECEIVE), add a new tuple below.
 *   The matching engine will automatically handle both directions.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * Each tuple [A, B] means type A and type B represent the same economic event.
 * The check is bidirectional — order within the tuple doesn't matter.
 *
 * @type {ReadonlyArray<[string, string]>}
 */
const TYPE_EQUIVALENCES = Object.freeze([
  ['TRANSFER_OUT', 'TRANSFER_IN'],
  // Future equivalences can be added here:
  // ['DEPOSIT', 'RECEIVE'],
  // ['WITHDRAWAL', 'SEND'],
]);

/**
 * Determines whether two transaction types represent the same economic event,
 * accounting for perspective flips between user and exchange records.
 *
 * @param {string} typeA - Transaction type from one source (e.g., "TRANSFER_OUT")
 * @param {string} typeB - Transaction type from the other source (e.g., "TRANSFER_IN")
 * @returns {boolean} True if the types are identical or defined as equivalent
 *
 * @example
 *   typesAreEquivalent('BUY', 'BUY')               // → true (identical)
 *   typesAreEquivalent('TRANSFER_OUT', 'TRANSFER_IN') // → true (perspective flip)
 *   typesAreEquivalent('BUY', 'SELL')               // → false
 *   typesAreEquivalent('transfer_out', 'TRANSFER_IN') // → true (case-insensitive)
 */
function typesAreEquivalent(typeA, typeB) {
  const normalizedA = (typeA || '').toUpperCase().trim();
  const normalizedB = (typeB || '').toUpperCase().trim();

  // Direct match (most common case — short-circuit for performance)
  if (normalizedA === normalizedB) {
    return true;
  }

  // Check equivalence pairs in both directions
  return TYPE_EQUIVALENCES.some(
    ([x, y]) => (normalizedA === x && normalizedB === y) ||
                (normalizedA === y && normalizedB === x),
  );
}

module.exports = { TYPE_EQUIVALENCES, typesAreEquivalent };
