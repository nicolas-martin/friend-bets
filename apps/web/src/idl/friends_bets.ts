import idlJson from './friends_bets.json';

// Export the IDL directly - Anchor 0.30.1 supports the new format
export const FRIENDS_BETS_IDL = idlJson;

// For backward compatibility
export { idlJson as friendsBetsIdl };
export default FRIENDS_BETS_IDL;