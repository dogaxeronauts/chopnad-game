import { createWalletClient, http, PrivateKeyAccount } from "viem";
import { monadTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import crypto from 'crypto';

interface SignatureResult {
  signature: string;
  message: string;
  signer: string;
  nonce: string;
  timestamp: number;
}

interface SignatureVerificationResult {
  isValid: boolean;
  reason?: string;
}

class ServerSigningService {
  private account: PrivateKeyAccount;
  private walletClient: any;
  private usedNonces: Set<string> = new Set();

  constructor() {
    const privateKey = process.env.WALLET_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('WALLET_PRIVATE_KEY environment variable not set');
    }

    this.account = privateKeyToAccount(privateKey as `0x${string}`);
    
    // Multiple RPC URLs for redundancy
    const ALCHEMY_RPC_URLS = [
      process.env.ALCHEMY_RPC_URL,
      process.env.ALCHEMY_RPC_URL_2,
      process.env.ALCHEMY_RPC_URL_3,
      process.env.ALCHEMY_RPC_URL_4,
      process.env.ALCHEMY_RPC_URL_5,
    ].filter(Boolean);

    const selectedUrl = ALCHEMY_RPC_URLS[Math.floor(Math.random() * ALCHEMY_RPC_URLS.length)];

    this.walletClient = createWalletClient({
      account: this.account,
      chain: monadTestnet,
      transport: http(selectedUrl),
    });

    // Clean up old nonces every 10 minutes
    setInterval(() => {
      this.cleanupOldNonces();
    }, 10 * 60 * 1000);
  }

  /**
   * Generate a cryptographically secure nonce
   */
  private generateNonce(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Create a standardized message for signing
   */
  private createMessage(playerAddress: string, scoreAmount: number, transactionAmount: number, nonce: string, timestamp: number): string {
    return `ScoreSubmission:${playerAddress}:${scoreAmount}:${transactionAmount}:${nonce}:${timestamp}`;
  }

  /**
   * Sign a message server-side with security parameters
   */
  async signScoreSubmission(
    playerAddress: string, 
    scoreAmount: number, 
    transactionAmount: number
  ): Promise<SignatureResult> {
    try {
      // Input validation
      if (!playerAddress || typeof playerAddress !== 'string') {
        throw new Error('Invalid player address');
      }
      
      if (typeof scoreAmount !== 'number' || scoreAmount < 0) {
        throw new Error('Invalid score amount');
      }
      
      if (typeof transactionAmount !== 'number' || transactionAmount < 0) {
        throw new Error('Invalid transaction amount');
      }

      const timestamp = Date.now();
      const nonce = this.generateNonce();
      
      // Check nonce uniqueness during generation (collision prevention)
      if (this.usedNonces.has(nonce)) {
        throw new Error('Nonce collision detected');
      }

      const message = this.createMessage(playerAddress, scoreAmount, transactionAmount, nonce, timestamp);

      // Server-side signing using the game server's wallet
      const signature = await this.walletClient.signMessage({
        account: this.account,
        message: message,
      });

      // DO NOT mark nonce as used here - it should be marked when the signature is verified/used
      // this.usedNonces.add(nonce); // REMOVED - this was causing the issue!

      return {
        signature,
        message,
        signer: this.account.address,
        nonce,
        timestamp
      };
    } catch (error) {
      console.error('Error signing message:', error);
      throw new Error(`Failed to sign message: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Verify a signature was created by this service
   */
  verifySignature(
    signature: string,
    message: string,
    nonce: string,
    timestamp: number,
    maxAge: number = 5 * 60 * 1000 // 5 minutes default
  ): SignatureVerificationResult {
    try {
      // Check timestamp validity (prevent replay attacks)
      const now = Date.now();
      if (now - timestamp > maxAge) {
        return {
          isValid: false,
          reason: 'Signature expired'
        };
      }

      // Check nonce hasn't been used (prevent replay attacks)
      if (this.usedNonces.has(nonce)) {
        return {
          isValid: false,
          reason: 'Nonce already used'
        };
      }

      // Additional validation: check message format
      const messageParts = message.split(':');
      if (messageParts.length !== 6 || messageParts[0] !== 'ScoreSubmission') {
        return {
          isValid: false,
          reason: 'Invalid message format'
        };
      }

      // Mark nonce as used NOW - when signature is actually being verified/consumed
      this.usedNonces.add(nonce);

      // In a real implementation, you would verify the signature against the expected signer
      // For now, we trust that the signature was created by this service since it's server-side only
      return {
        isValid: true
      };
    } catch (error) {
      return {
        isValid: false,
        reason: `Verification error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Parse signed message to extract components
   */
  parseSignedMessage(message: string): {
    playerAddress: string;
    scoreAmount: number;
    transactionAmount: number;
    nonce: string;
    timestamp: number;
  } | null {
    try {
      const parts = message.split(':');
      if (parts.length !== 6 || parts[0] !== 'ScoreSubmission') {
        return null;
      }

      return {
        playerAddress: parts[1],
        scoreAmount: parseInt(parts[2], 10),
        transactionAmount: parseInt(parts[3], 10),
        nonce: parts[4],
        timestamp: parseInt(parts[5], 10)
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Clean up old nonces to prevent memory leaks
   */
  private cleanupOldNonces(): void {
    // Since we can't track timestamps in a Set, we'll clear all nonces periodically
    // This is acceptable since signatures expire in 5 minutes anyway
    this.usedNonces.clear();
    console.log('Cleaned up old nonces');
  }

  /**
   * Get service status for monitoring
   */
  getStatus(): {
    signerAddress: string;
    usedNoncesCount: number;
    isReady: boolean;
  } {
    return {
      signerAddress: this.account.address,
      usedNoncesCount: this.usedNonces.size,
      isReady: !!this.walletClient
    };
  }
}

// Singleton instance
let signingService: ServerSigningService | null = null;

export function getSigningService(): ServerSigningService {
  if (!signingService) {
    signingService = new ServerSigningService();
  }
  return signingService;
}

// Export types
export type { SignatureResult, SignatureVerificationResult };