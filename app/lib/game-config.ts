// Game configuration
export const GAME_CONFIG = {
  // Your registered game address
  GAME_ADDRESS: '0x568B31E03C5E61715fEd21199Fd44603A04e1443',
  
  // Game settings
  SCORE_SUBMISSION: {
    // Submit score every X points
    SCORE_THRESHOLD: 5000,
    
    // Track transactions (actions that cost points/tokens)
    TRANSACTION_THRESHOLD: 1,
  },
  
  // Game metadata
  METADATA: {
    name: 'Example Game',
    url: 'https://mission7-example-game.vercel.app/',
    image: 'https://picsum.photos/536/354'
  }
} as const;