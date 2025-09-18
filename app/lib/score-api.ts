// Enhanced client-side API helpers with single-request security
import { generateClientValidationKeys, ValidationKeys } from './cryptoValidation';

interface ScoreSubmissionResponse {
  success: boolean;
  transactionHash?: string;
  message?: string;
  error?: string;
  securityVerified?: boolean;
  cryptoValidationLevel?: 'HIGH' | 'MEDIUM' | 'LOW' | 'FAILED';
  nonce?: string;
  timestamp?: number;
  duplicate?: boolean;
}

interface QueuedTransaction {
  id: string;
  playerAddress: string;
  scoreAmount: number;
  transactionAmount: number;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: number;
  onSuccess?: (result: ScoreSubmissionResponse) => void;
  onFailure?: (error: string) => void;
  onRetry?: (attempt: number) => void;
}

interface PlayerDataResponse {
  success: boolean;
  playerAddress: string;
  totalScore: string;
  totalTransactions: string;
  error?: string;
}

interface PlayerDataPerGameResponse {
  success: boolean;
  playerAddress: string;
  gameAddress: string;
  score: string;
  transactions: string;
  error?: string;
}

// Single-request secure score submission with 3-key cryptographic validation
export async function submitPlayerScore(
  playerAddress: string,
  scoreAmount: number,
  transactionAmount: number = 1
): Promise<ScoreSubmissionResponse> {
  try {
    // Generate 3-key cryptographic validation
    console.log('Generating cryptographic validation keys...');
    const validationKeys: ValidationKeys = generateClientValidationKeys(
      playerAddress,
      scoreAmount,
      transactionAmount
    );
    
    console.log('Validation keys generated:', {
      temporalKey: validationKeys.temporalKey,
      payloadKey: validationKeys.payloadKey,
      identityKey: validationKeys.identityKey
    });
    // Generate CSRF token client-side (stateless) - Will be deprecated soon
    const csrfToken = generateClientCSRFToken();
    
    // Single request with all data including 3-key validation - server will handle signing internally
    const response = await fetch('/api/update-player-data', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify({
        playerAddress,
        scoreAmount,
        transactionAmount,
        validationKeys: validationKeys
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error submitting score:', error);
    return {
      success: false,
      error: `Failed to submit score: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

// Generate client-side CSRF token (compatible with server validation)
function generateClientCSRFToken(): string {
  // Browser-compatible random string generation
  const generateRandomString = (length: number): string => {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  const sessionId = generateRandomString(16);
  const timestamp = Date.now();
  const nonce = generateRandomString(16);
  
  const token = `${sessionId}-${timestamp}-${nonce}-client`;
  console.log('Generated CSRF token:', token.substring(0, 8) + '...');
  console.log('Token parts:', { sessionId, timestamp, nonce, suffix: 'client' });
  
  return token;
}

// Get player's total data across all games
export async function getPlayerTotalData(playerAddress: string): Promise<PlayerDataResponse | null> {
  try {
    const response = await fetch(`/api/get-player-data?address=${encodeURIComponent(playerAddress)}`);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error getting player data:', error);
    return null;
  }
}

// Get player's data for a specific game
export async function getPlayerGameData(
  playerAddress: string,
  gameAddress: string
): Promise<PlayerDataPerGameResponse | null> {
  try {
    const response = await fetch(
      `/api/get-player-data-per-game?playerAddress=${encodeURIComponent(playerAddress)}&gameAddress=${encodeURIComponent(gameAddress)}`
    );
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error getting player game data:', error);
    return null;
  }
}

// Enhanced score submission manager with new security model
export class ScoreSubmissionManager {
  private playerAddress: string;
  private pendingScore: number = 0;
  private pendingTransactions: number = 0;
  private submitTimeout: NodeJS.Timeout | null = null;
  private readonly submitDelay = 3000; // 3 seconds delay for better batching
  private isSubmitting: boolean = false;

  constructor(playerAddress: string) {
    this.playerAddress = playerAddress;
  }

  // Add score points (will be batched and submitted after delay)
  addScore(points: number) {
    if (points <= 0) return;
    this.pendingScore += points;
    this.scheduleSubmission();
  }

  // Add transaction count (will be batched and submitted after delay)
  addTransaction(count: number = 1) {
    if (count <= 0) return;
    this.pendingTransactions += count;
    this.scheduleSubmission();
  }

  // Submit immediately (bypasses batching)
  async submitImmediately(): Promise<ScoreSubmissionResponse> {
    if (this.isSubmitting) {
      return { success: false, error: 'Submission already in progress' };
    }

    if (this.submitTimeout) {
      clearTimeout(this.submitTimeout);
      this.submitTimeout = null;
    }

    const score = this.pendingScore;
    const transactions = this.pendingTransactions;

    // Reset pending amounts
    this.pendingScore = 0;
    this.pendingTransactions = 0;

    if (score === 0 && transactions === 0) {
      return { success: true, message: 'No pending data to submit' };
    }

    this.isSubmitting = true;
    try {
      const result = await submitPlayerScore(this.playerAddress, score, transactions);
      return result;
    } finally {
      this.isSubmitting = false;
    }
  }

  // Schedule a delayed submission (batches multiple updates)
  private scheduleSubmission() {
    if (this.submitTimeout || this.isSubmitting) {
      if (this.submitTimeout) {
        clearTimeout(this.submitTimeout);
      }
    }

    this.submitTimeout = setTimeout(async () => {
      if (this.pendingScore > 0 || this.pendingTransactions > 0) {
        const result = await this.submitImmediately();
        if (!result.success) {
          console.error('Failed to submit score:', result.error);
        } else {
          console.log('Score submitted successfully:', {
            transactionHash: result.transactionHash,
            securityVerified: result.securityVerified,
            duplicate: result.duplicate
          });
        }
      }
    }, this.submitDelay);
  }

  // Get current pending amounts
  getPendingData() {
    return {
      score: this.pendingScore,
      transactions: this.pendingTransactions,
      isSubmitting: this.isSubmitting,
    };
  }

  // Clean up timeouts
  destroy() {
    if (this.submitTimeout) {
      clearTimeout(this.submitTimeout);
      this.submitTimeout = null;
    }
    this.isSubmitting = false;
  }
}

// Transaction queue with retry mechanism
export class TransactionQueue {
  private queue: QueuedTransaction[] = [];
  private processingTimer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private batchingTimer: NodeJS.Timeout | null = null;
  private pendingBatch: QueuedTransaction[] = [];
  private readonly batchDelay = 2000; // 2 seconds to batch transactions
  private readonly maxBatchSize = 5; // Max transactions per batch
  
  constructor() {
    this.startProcessing();
  }

  // Add transaction to queue with retry logic and batching
  enqueue(
    playerAddress: string,
    scoreAmount: number,
    transactionAmount: number = 1,
    callbacks?: {
      onSuccess?: (result: ScoreSubmissionResponse) => void;
      onFailure?: (error: string) => void;
      onRetry?: (attempt: number) => void;
    }
  ): string {
    const id = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const transaction: QueuedTransaction = {
      id,
      playerAddress,
      scoreAmount,
      transactionAmount,
      attempts: 0,
      maxAttempts: 5, // Increased for priority conflicts
      nextRetryAt: Date.now(),
      onSuccess: callbacks?.onSuccess,
      onFailure: callbacks?.onFailure,
      onRetry: callbacks?.onRetry,
    };

    // Add to pending batch first
    this.addToBatch(transaction);
    return id;
  }

  // Add transaction to batch for optimization
  private addToBatch(transaction: QueuedTransaction) {
    this.pendingBatch.push(transaction);
    
    // If batch is full, process immediately
    if (this.pendingBatch.length >= this.maxBatchSize) {
      this.flushBatch();
    } else {
      // Schedule batch flush
      this.scheduleBatchFlush();
    }
  }

  // Schedule batch to be processed
  private scheduleBatchFlush() {
    if (this.batchingTimer) {
      clearTimeout(this.batchingTimer);
    }
    
    this.batchingTimer = setTimeout(() => {
      this.flushBatch();
    }, this.batchDelay);
  }

  // Move batched transactions to main queue
  private flushBatch() {
    if (this.batchingTimer) {
      clearTimeout(this.batchingTimer);
      this.batchingTimer = null;
    }
    
    if (this.pendingBatch.length === 0) return;
    
    // For same player, combine into single transaction to reduce nonce conflicts
    const batchByPlayer = new Map<string, QueuedTransaction[]>();
    
    this.pendingBatch.forEach(tx => {
      if (!batchByPlayer.has(tx.playerAddress)) {
        batchByPlayer.set(tx.playerAddress, []);
      }
      batchByPlayer.get(tx.playerAddress)!.push(tx);
    });
    
    // Create combined transactions per player
    batchByPlayer.forEach((transactions, playerAddress) => {
      if (transactions.length === 1) {
        // Single transaction, add as is
        this.queue.push(transactions[0]);
      } else {
        // Multiple transactions for same player - combine them
        const combinedTransaction = this.combineTransactions(transactions);
        this.queue.push(combinedTransaction);
      }
    });
    
    this.pendingBatch = [];
  }

  // Combine multiple transactions into one to reduce blockchain congestion
  private combineTransactions(transactions: QueuedTransaction[]): QueuedTransaction {
    const totalScore = transactions.reduce((sum, tx) => sum + tx.scoreAmount, 0);
    const totalTransactions = transactions.reduce((sum, tx) => sum + tx.transactionAmount, 0);
    const allCallbacks = transactions.map(tx => ({
      onSuccess: tx.onSuccess,
      onFailure: tx.onFailure,
      onRetry: tx.onRetry,
      scoreAmount: tx.scoreAmount,
    }));
    
    return {
      id: `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      playerAddress: transactions[0].playerAddress,
      scoreAmount: totalScore,
      transactionAmount: totalTransactions,
      attempts: 0,
      maxAttempts: 5,
      nextRetryAt: Date.now(),
      onSuccess: (result) => {
        // Call all success callbacks
        allCallbacks.forEach(cb => {
          if (cb.onSuccess) {
            cb.onSuccess(result);
          }
        });
      },
      onFailure: (error) => {
        // Call all failure callbacks
        allCallbacks.forEach(cb => {
          if (cb.onFailure) {
            cb.onFailure(error);
          }
        });
      },
      onRetry: (attempt) => {
        // Call all retry callbacks
        allCallbacks.forEach(cb => {
          if (cb.onRetry) {
            cb.onRetry(attempt);
          }
        });
      },
    };
  }

  // Start processing queue
  private startProcessing() {
    if (this.processingTimer) return;
    
    this.processingTimer = setInterval(() => {
      this.processQueue();
    }, 1000); // Check every second
  }

  // Process transactions in queue
  private async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;
    
    this.isProcessing = true;
    const now = Date.now();
    
    // Find transactions ready for processing
    const readyTransactions = this.queue.filter(tx => tx.nextRetryAt <= now);
    
    for (const transaction of readyTransactions) {
      try {
        transaction.attempts++;
        
        // Call retry callback
        if (transaction.onRetry && transaction.attempts > 1) {
          transaction.onRetry(transaction.attempts);
        }

        const result = await submitPlayerScore(
          transaction.playerAddress,
          transaction.scoreAmount,
          transaction.transactionAmount
        );

        if (result.success) {
          // Success - remove from queue
          this.removeTransaction(transaction.id);
          
          // Log testnet explorer link
          if (result.transactionHash) {
            console.log(`Transaction confirmed: https://testnet.monadscan.com/tx/${result.transactionHash}`);
          }
          
          if (transaction.onSuccess) {
            transaction.onSuccess(result);
          }
        } else {
          // Failed - check if we should retry
          const isPriorityError = result.error?.includes('Another transaction has higher priority') || 
                                  result.error?.includes('higher priority');
          
          if (transaction.attempts >= transaction.maxAttempts) {
            // Max attempts reached - remove from queue
            this.removeTransaction(transaction.id);
            if (transaction.onFailure) {
              transaction.onFailure(result.error || 'Max retry attempts reached');
            }
          } else {
            // Schedule retry with different backoff for priority errors
            let backoffDelay;
            if (isPriorityError) {
              // For priority conflicts, use longer delays with more randomness
              backoffDelay = Math.min(
                3000 + Math.random() * 5000 + (1000 * transaction.attempts), 
                60000
              ); // 3-8s + attempt penalty, cap at 60s
            } else {
              // Regular exponential backoff for other errors
              backoffDelay = Math.min(1000 * Math.pow(2, transaction.attempts - 1), 30000);
            }
            
            transaction.nextRetryAt = now + backoffDelay;
          }
        }
      } catch (error) {
        // Unexpected error - handle same as failure
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const isPriorityError = errorMessage.includes('Another transaction has higher priority') || 
                                errorMessage.includes('higher priority');
        
        if (transaction.attempts >= transaction.maxAttempts) {
          this.removeTransaction(transaction.id);
          if (transaction.onFailure) {
            transaction.onFailure(errorMessage);
          }
        } else {
          let backoffDelay;
          if (isPriorityError) {
            // For priority conflicts, use longer delays with more randomness
            backoffDelay = Math.min(
              3000 + Math.random() * 5000 + (1000 * transaction.attempts), 
              60000
            ); // 3-8s + attempt penalty, cap at 60s
          } else {
            // Regular exponential backoff for other errors
            backoffDelay = Math.min(1000 * Math.pow(2, transaction.attempts - 1), 30000);
          }
          
          transaction.nextRetryAt = now + backoffDelay;
        }
      }
    }
    
    this.isProcessing = false;
  }

  // Remove transaction from queue
  private removeTransaction(id: string) {
    this.queue = this.queue.filter(tx => tx.id !== id);
  }

  // Get queue status
  getQueueStatus() {
    return {
      pending: this.queue.length,
      transactions: this.queue.map(tx => ({
        id: tx.id,
        attempts: tx.attempts,
        maxAttempts: tx.maxAttempts,
        scoreAmount: tx.scoreAmount,
        nextRetryAt: tx.nextRetryAt,
      })),
    };
  }

  // Clean up
  destroy() {
    if (this.processingTimer) {
      clearInterval(this.processingTimer);
      this.processingTimer = null;
    }
    if (this.batchingTimer) {
      clearTimeout(this.batchingTimer);
      this.batchingTimer = null;
    }
    // Flush any pending batch before destroying
    this.flushBatch();
    this.queue = [];
    this.pendingBatch = [];
  }
}