import { NextRequest, NextResponse } from "next/server";
import { createWalletClient, http } from "viem";
import { monadTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import {
  CONTRACT_ADDRESS,
  CONTRACT_ABI,
  isValidAddress,
} from "@/app/lib/blockchain";
import {
  validateOrigin,
  createAuthenticatedResponse,
} from "@/app/lib/auth";
import { rateLimit } from "@/app/lib/rate-limiter";
import { getSigningService } from "@/app/lib/signMessage";
import { getCryptoValidationService, ValidationRequest } from "@/app/lib/cryptoValidation";
import "dotenv/config";

// Enhanced security with comprehensive abuse protection
let currentUrlIndex = 0;

// In-memory abuse tracking (production'da Redis/Database kullanın)
const scoreTracking = new Map<string, { totalScore: number; requests: number; firstRequest: number }>();
const hourlyLimits = new Map<string, { score: number; transactions: number; timestamp: number }>();

// Cleanup old tracking data every 10 minutes
setInterval(() => {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  
  for (const [key, data] of hourlyLimits.entries()) {
    if (now - data.timestamp > oneHour) {
      hourlyLimits.delete(key);
    }
  }
  
  for (const [key, data] of scoreTracking.entries()) {
    if (now - data.firstRequest > oneHour) {
      scoreTracking.delete(key);
    }
  }
}, 10 * 60 * 1000);

// Simple CSRF token format validation for single-request flow
function isValidCSRFFormat(token: string): boolean {
  // Basic format check: sessionId-timestamp-nonce-client
  const parts = token.split('-');
  
  if (parts.length !== 4) {
    return false;
  }
  
  const [sessionId, timestampStr, nonce, suffix] = parts;
  
  // Check parts are not empty and suffix is 'client'
  if (!sessionId || !timestampStr || !nonce || suffix !== 'client') {
    return false;
  }
  
  // Check timestamp is valid number
  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) {
    return false;
  }
  
  // Check timestamp is not too old (5 minutes)
  const now = Date.now();
  const age = now - timestamp;
  if (age > 5 * 60 * 1000) {
    return false;
  }
  
  return true;
}

// Nonce-based request deduplication with improved tracking
const processedRequests = new Map<string, { timestamp: number; result: Record<string, unknown> }>();
const REQUEST_DEDUP_WINDOW = 5 * 60 * 1000; // 5 minutes

// Clean up old processed requests
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of processedRequests.entries()) {
    if (now - data.timestamp > REQUEST_DEDUP_WINDOW) {
      processedRequests.delete(key);
    }
  }
}, 2 * 60 * 1000); // Clean every 2 minutes

export async function POST(request: NextRequest) {
  try {
    //* SECURITY LAYER 1: Origin validation
    if (!validateOrigin(request)) {
      return createAuthenticatedResponse(
        { error: "Forbidden: Invalid origin" },
        403
      );
    }

    //* SECURITY LAYER 2: Enhanced rate limiting with multiple tiers
    const clientIp =
      request.headers.get("x-forwarded-for") ||
      request.headers.get("x-real-ip") ||
      "unknown";
    
    // Tier 1: General rate limiting (per IP)
    const generalRateLimit = rateLimit(clientIp, {
      maxRequests: 4, // Only 4 requests per minute per IP
      windowMs: 60000,
    });

    if (!generalRateLimit.allowed) {
      return createAuthenticatedResponse(
        {
          error: "Rate limit exceeded: Too many requests from this IP",
          resetTime: generalRateLimit.resetTime,
        },
        429
      );
    }

    // Parse request body first for additional rate limiting
    const requestBody = await request.json();
    const { playerAddress, scoreAmount, transactionAmount, validationKeys } = requestBody;

    // Tier 2: Per-player rate limiting
    const playerRateLimit = rateLimit(`player:${playerAddress}`, {
      maxRequests: 8, // 8 requests per player per minute
      windowMs: 60000,
    });

    if (!playerRateLimit.allowed) {
      return createAuthenticatedResponse(
        {
          error: "Rate limit exceeded: Too many requests for this player",
          resetTime: playerRateLimit.resetTime,
        },
        429
      );
    }

    // Tier 3: Hourly score/transaction limits per player (prevent farming)
    const hourlyKey = `${playerAddress}:${Math.floor(Date.now() / (60 * 60 * 1000))}`;
    const hourlyData = hourlyLimits.get(hourlyKey) || { score: 0, transactions: 0, timestamp: Date.now() };

    const MAX_SCORE_PER_HOUR = 30000; // Max 30000 points per hour per player
    const MAX_TRANSACTIONS_PER_HOUR = 120; // Max 120 transactions per hour per player
    
    if (hourlyData.score + scoreAmount > MAX_SCORE_PER_HOUR) {
      return createAuthenticatedResponse(
        {
          error: `Hourly score limit exceeded: Maximum ${MAX_SCORE_PER_HOUR} points per hour`,
          currentHourScore: hourlyData.score,
          requestedAmount: scoreAmount,
          remaining: MAX_SCORE_PER_HOUR - hourlyData.score,
        },
        429
      );
    }
    
    if (hourlyData.transactions + transactionAmount > MAX_TRANSACTIONS_PER_HOUR) {
      return createAuthenticatedResponse(
        {
          error: `Hourly transaction limit exceeded: Maximum ${MAX_TRANSACTIONS_PER_HOUR} transactions per hour`,
          currentHourTransactions: hourlyData.transactions,
          requestedAmount: transactionAmount,
        },
        429
      );
    }

    // Tier 4: Behavioral analysis (detect suspicious patterns)
    const behaviorKey = playerAddress;
    const behaviorData = scoreTracking.get(behaviorKey) || { totalScore: 0, requests: 0, firstRequest: Date.now() };
    
    // Check for rapid fire requests (less than 5 seconds between requests)
    const timeSinceLastRequest = Date.now() - (behaviorData.firstRequest + (behaviorData.requests * 1000));
    if (behaviorData.requests > 0 && timeSinceLastRequest < 5000) {
      return createAuthenticatedResponse(
        {
          error: "Request too frequent: Minimum 5 seconds between score submissions",
          waitTime: 5000 - timeSinceLastRequest,
        },
        429
      );
    }
    
    // Check for unrealistic score patterns (too much score too quickly)
    const sessionDuration = Date.now() - behaviorData.firstRequest;
    const avgScorePerMinute = sessionDuration > 0 ? (behaviorData.totalScore * 60000) / sessionDuration : 0;
    const MAX_SCORE_PER_MINUTE_AVG = 3000; // Max 3000 points per minute average
    
    if (avgScorePerMinute > MAX_SCORE_PER_MINUTE_AVG && behaviorData.requests > 5) {
      return createAuthenticatedResponse(
        {
          error: `Suspicious scoring pattern detected: Average ${avgScorePerMinute.toFixed(2)} points/minute exceeds limit of ${MAX_SCORE_PER_MINUTE_AVG}`,
          sessionDuration: Math.round(sessionDuration / 1000),
          avgScorePerMinute: Math.round(avgScorePerMinute),
        },
        429
      );
    }

    //* SECURITY LAYER 3: 3-Key Cryptographic Validation (ULTRA SECURE)
    const cryptoService = getCryptoValidationService();
    
    // Validation keys kontrolü
    if (!validationKeys || !validationKeys.temporalKey || !validationKeys.payloadKey || !validationKeys.identityKey) {
      return createAuthenticatedResponse(
        { 
          error: "Missing validation keys: temporalKey, payloadKey, and identityKey required",
          required: ["temporalKey", "payloadKey", "identityKey"]
        },
        400
      );
    }

    const validationRequest: ValidationRequest = {
      playerAddress,
      scoreAmount,
      transactionAmount,
      validationKeys,
      timestamp: Date.now()
    };

    const cryptoValidation = cryptoService.validateKeys(validationKeys, validationRequest);
    
    if (!cryptoValidation.valid) {
      return createAuthenticatedResponse(
        {
          error: "Cryptographic validation failed",
          details: cryptoValidation.errors,
          securityLevel: cryptoValidation.securityLevel,
          message: "Request rejected due to invalid or reused validation keys"
        },
        401
      );
    }

    //* SECURITY LAYER 4: CSRF token validation (simplified - will be removed soon)
    const csrfToken = request.headers.get('x-csrf-token');
    
    // Simple CSRF validation for single-request flow
    if (!csrfToken || !isValidCSRFFormat(csrfToken)) {
      return createAuthenticatedResponse(
        { error: "Unauthorized: Invalid CSRF token format" },
        401
      );
    }
    
    //* SECURITY LAYER 5: Required fields validation
    if (
      !playerAddress ||
      scoreAmount === undefined ||
      transactionAmount === undefined
    ) {
      return createAuthenticatedResponse(
        {
          error: "Missing required fields: playerAddress, scoreAmount, transactionAmount",
        },
        400
      );
    }

    //* SECURITY LAYER 6: Address format validation
    if (!isValidAddress(playerAddress)) {
      return createAuthenticatedResponse(
        { error: "Invalid player address format" },
        400
      );
    }

    //* SECURITY LAYER 6: Enhanced amount validation with game logic
    if (scoreAmount < 0 || transactionAmount < 0) {
      return createAuthenticatedResponse(
        { error: "Score and transaction amounts must be non-negative" },
        400
      );
    }

    // Realistic game limits
    const MAX_SCORE_PER_REQUEST = 1000; // Much more restrictive - max 1000 per request
    const MAX_TRANSACTIONS_PER_REQUEST = 3; // Max 3 transactions per request
    const MIN_SCORE_PER_REQUEST = 1;
    const MAX_SCORE_PER_TRANSACTION = 1000; // Max 1000 points per transaction

    if (scoreAmount > MAX_SCORE_PER_REQUEST) {
      return createAuthenticatedResponse(
        {
          error: `Score too high: Maximum ${MAX_SCORE_PER_REQUEST} points per request`,
          requestedAmount: scoreAmount,
        },
        400
      );
    }
    
    if (transactionAmount > MAX_TRANSACTIONS_PER_REQUEST) {
      return createAuthenticatedResponse(
        {
          error: `Too many transactions: Maximum ${MAX_TRANSACTIONS_PER_REQUEST} transactions per request`,
          requestedAmount: transactionAmount,
        },
        400
      );
    }

    if (scoreAmount < MIN_SCORE_PER_REQUEST && scoreAmount !== 0) {
      return createAuthenticatedResponse(
        { error: `Score amount too small. Minimum: ${MIN_SCORE_PER_REQUEST}` },
        400
      );
    }

    // Validate score-to-transaction ratio (game logic)
    if (transactionAmount > 0) {
      const scorePerTransaction = scoreAmount / transactionAmount;
      if (scorePerTransaction > MAX_SCORE_PER_TRANSACTION) {
        return createAuthenticatedResponse(
          {
            error: `Score per transaction too high: ${scorePerTransaction.toFixed(2)} > ${MAX_SCORE_PER_TRANSACTION}`,
            scorePerTransaction: Math.round(scorePerTransaction),
            maxAllowed: MAX_SCORE_PER_TRANSACTION,
          },
          400
        );
      }
      
      // Additional game logic: minimum score per transaction (prevent spam)
      const MIN_SCORE_PER_TRANSACTION = 5;
      if (scorePerTransaction < MIN_SCORE_PER_TRANSACTION) {
        return createAuthenticatedResponse(
          {
            error: `Score per transaction too low: ${scorePerTransaction.toFixed(2)} < ${MIN_SCORE_PER_TRANSACTION}`,
            scorePerTransaction: Math.round(scorePerTransaction),
            minRequired: MIN_SCORE_PER_TRANSACTION,
          },
          400
        );
      }
    }

    //* SECURITY LAYER 8: Server-side signing (internal)
    const signingService = getSigningService();
    const signedData = await signingService.signScoreSubmission(
      playerAddress,
      scoreAmount,
      transactionAmount
    );

    //* SECURITY LAYER 9: Nonce-based deduplication
    const dedupKey = `${playerAddress}-${signedData.nonce}`;
    if (processedRequests.has(dedupKey)) {
      const existingResult = processedRequests.get(dedupKey);
      return createAuthenticatedResponse({
        ...existingResult!.result,
        duplicate: true,
        message: "Request already processed"
      });
    }

    // Mark request as processing
    processedRequests.set(dedupKey, { 
      timestamp: Date.now(), 
      result: { processing: true } 
    });

    //* BLOCKCHAIN TRANSACTION EXECUTION
    const privateKey = process.env.WALLET_PRIVATE_KEY;
    if (!privateKey) {
      console.error("WALLET_PRIVATE_KEY environment variable not set");
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }

    const account = privateKeyToAccount(privateKey as `0x${string}`);

    // Enhanced RPC URL rotation
    const ALCHEMY_RPC_URLS = [
      process.env.ALCHEMY_RPC_URL,
      process.env.ALCHEMY_RPC_URL_2,
      process.env.ALCHEMY_RPC_URL_3,
      process.env.ALCHEMY_RPC_URL_4,
      process.env.ALCHEMY_RPC_URL_5,
    ].filter(Boolean);

    const selectedUrl = ALCHEMY_RPC_URLS[currentUrlIndex % ALCHEMY_RPC_URLS.length];
    currentUrlIndex = (currentUrlIndex + 1) % ALCHEMY_RPC_URLS.length;

    const walletClient = createWalletClient({
      account,
      chain: monadTestnet,
      transport: http(selectedUrl),
    });

    // Execute blockchain transaction
    const hash = await walletClient.writeContract({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: "updatePlayerData",
      args: [
        {
          player: playerAddress as `0x${string}`,
          score: BigInt(scoreAmount),
          transactions: BigInt(transactionAmount),
        }
      ],
    });

    // Update tracking data AFTER successful blockchain transaction
    hourlyLimits.set(hourlyKey, {
      score: hourlyData.score + scoreAmount,
      transactions: hourlyData.transactions + transactionAmount,
      timestamp: hourlyData.timestamp,
    });
    
    scoreTracking.set(behaviorKey, {
      totalScore: behaviorData.totalScore + scoreAmount,
      requests: behaviorData.requests + 1,
      firstRequest: behaviorData.firstRequest,
    });

    // Store successful result
    const successResult = {
      success: true,
      transactionHash: hash,
      message: "Player data updated successfully",
      securityVerified: true,
      cryptoValidationLevel: cryptoValidation.securityLevel,
      nonce: signedData.nonce,
      timestamp: Date.now(),
      antiAbuse: {
        hourlyScore: hourlyData.score + scoreAmount,
        hourlyTransactions: hourlyData.transactions + transactionAmount,
        sessionRequests: behaviorData.requests + 1,
      }
    };

    processedRequests.set(dedupKey, {
      timestamp: Date.now(),
      result: successResult
    });

    return createAuthenticatedResponse(successResult);

  } catch (error) {
    console.error("Error updating player data:", error);

    // Enhanced error handling
    if (error instanceof Error) {
      if (error.message.includes("insufficient funds")) {
        return createAuthenticatedResponse(
          { error: "Insufficient funds to complete transaction" },
          400
        );
      }
      if (error.message.includes("execution reverted")) {
        return createAuthenticatedResponse(
          {
            error: "Contract execution failed - check if wallet has GAME_ROLE permission",
          },
          400
        );
      }
      if (error.message.includes("AccessControlUnauthorizedAccount")) {
        return createAuthenticatedResponse(
          { error: "Unauthorized: Wallet does not have GAME_ROLE permission" },
          403
        );
      }
      if (error.message.includes("nonce")) {
        return createAuthenticatedResponse(
          { error: "Transaction nonce error - please retry" },
          400
        );
      }
    }

    return createAuthenticatedResponse(
      { error: "Failed to update player data" },
      500
    );
  }
}

export async function OPTIONS() {
  return createAuthenticatedResponse({}, 200);
}
