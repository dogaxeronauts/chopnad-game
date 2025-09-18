import { NextRequest } from 'next/server';
import crypto from 'crypto';

// Remove the problematic client-side API secret
const SERVER_API_SECRET = process.env.API_SECRET;
const CSRF_SECRET = process.env.CSRF_SECRET || crypto.randomBytes(32).toString('hex');

if (!SERVER_API_SECRET) {
  throw new Error('API_SECRET environment variable is required');
}

export function generateApiKey(): string {
  return crypto.randomBytes(32).toString('hex');
}

// Generate a session-based token that includes player address and timestamp
export function generateSessionToken(playerAddress: string, timestamp: number): string {
  const data = `${playerAddress}-${timestamp}-${SERVER_API_SECRET}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

// Add session token storage
const usedSessionTokens = new Set<string>();

// Clean up old tokens periodically (run every 10 minutes)
setInterval(() => {
  // Clear all tokens older than 30 minutes
  // Since we can't track timestamps in a Set, we'll clear all tokens periodically
  // This is acceptable since tokens are only valid for 5 minutes anyway
  usedSessionTokens.clear();
}, 10 * 60 * 1000);

// Validate session token with player address verification and one-time use
export function validateSessionToken(token: string, playerAddress: string, timestampWindow: number = 300000): boolean {
  // Check if token has already been used - FIRST CHECK
  if (usedSessionTokens.has(token)) {
    console.log('Token already used:', token);
    return false;
  }
  
  // Mark token as used IMMEDIATELY to prevent race conditions
  usedSessionTokens.add(token);
  console.log('Token added to used set:', token);
  
  const now = Date.now();
  
  // Check tokens within the timestamp window (default 5 minutes)
  for (let i = 0; i < timestampWindow; i += 30000) { // Check every 30 seconds
    const timestamp = now - i;
    const expectedToken = generateSessionToken(playerAddress, Math.floor(timestamp / 30000) * 30000);
    if (token === expectedToken) {
      console.log('Token validated and confirmed as used:', token);
      console.log('Used tokens count:', usedSessionTokens.size);
      return true;
    }
  }
  
  // If token is invalid, remove it from used tokens
  usedSessionTokens.delete(token);
  console.log('Invalid token, removed from used set:', token);
  return false;
}

// Legacy API key validation for internal server use only
export function validateApiKey(request: NextRequest): boolean {
  const apiKey = request.headers.get('x-api-key');
  
  if (!apiKey) {
    return false;
  }

  // Only accept server-side API key
  return apiKey === SERVER_API_SECRET;
}

export function validateOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const userAgent = request.headers.get('user-agent');
  
  const allowedOrigins = [
    'http://localhost:3000',
    'https://localhost:3000',
    'https://chopupnad.vercel.app',
    'https://www.chopupnad.fun/',
    'https://chopupnad.fun/',
    process.env.NEXT_PUBLIC_APP_URL
  ].filter(Boolean);

  // Stricter origin validation
  if (!origin || !allowedOrigins.includes(origin)) {
    // Also check referer as fallback, but be more strict
    if (!referer || !allowedOrigins.some(allowed => referer.startsWith(allowed + '/'))) {
      return false;
    }
  }

  // Additional check: reject requests that look like automated tools
  if (!userAgent || userAgent.includes('curl') || userAgent.includes('wget') || userAgent.includes('Postman')) {
    return false;
  }

  return true;
}

// Stateless CSRF token management (restart-safe)
const CSRF_TOKEN_LIFETIME = 5 * 60 * 1000; // 5 minutes

// Generate stateless CSRF token using HMAC (no storage needed)
export function generateCSRFToken(sessionId?: string): { token: string; sessionId: string } {
  const actualSessionId = sessionId || crypto.randomBytes(16).toString('hex');
  const timestamp = Date.now();
  const nonce = crypto.randomBytes(16).toString('hex');
  
  // Create token payload
  const payload = `${actualSessionId}-${timestamp}-${nonce}`;
  
  // Sign with HMAC to create stateless token
  const signature = crypto.createHmac('sha256', CSRF_SECRET).update(payload).digest('hex');
  const token = `${payload}-${signature}`;
  
  console.log(`Generated stateless CSRF token: ${token.substring(0, 8)}...`);
  return { token, sessionId: actualSessionId };
}

// Validate stateless CSRF token (no storage needed)
export function validateCSRFToken(token: string, markAsUsed: boolean = true): boolean {
  if (!token) {
    console.log('CSRF validation failed: No token provided');
    return false;
  }

  try {
    // Parse token parts
    const parts = token.split('-');
    if (parts.length !== 4) {
      console.log(`CSRF validation failed: Invalid token format ${token.substring(0, 8)}...`);
      return false;
    }

    const [sessionId, timestampStr, nonce, signature] = parts;
    const timestamp = parseInt(timestampStr, 10);
    
    if (isNaN(timestamp)) {
      console.log(`CSRF validation failed: Invalid timestamp ${token.substring(0, 8)}...`);
      return false;
    }

    // Check if token has expired
    const now = Date.now();
    if (now - timestamp > CSRF_TOKEN_LIFETIME) {
      console.log(`CSRF validation failed: Token expired ${token.substring(0, 8)}...`);
      return false;
    }

    // Verify HMAC signature
    const payload = `${sessionId}-${timestamp}-${nonce}`;
    const expectedSignature = crypto.createHmac('sha256', CSRF_SECRET).update(payload).digest('hex');
    
    if (signature !== expectedSignature) {
      console.log(`CSRF validation failed: Invalid signature ${token.substring(0, 8)}...`);
      return false;
    }

    console.log(`CSRF token validated successfully: ${token.substring(0, 8)}...`);
    return true;
    
  } catch (error) {
    console.log(`CSRF validation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return false;
  }
}

// Get CSRF token status for debugging
export function getCSRFTokenStatus(): { message: string } {
  return {
    message: 'Using stateless CSRF tokens - no storage needed'
  };
}

export function createAuthenticatedResponse(data: Record<string, unknown>, status = 200) {
  const response = {
    ...data,
    timestamp: Date.now(),
    serverSignature: crypto.createHmac('sha256', SERVER_API_SECRET).update(JSON.stringify(data)).digest('hex').substring(0, 16)
  };

  return Response.json(response, {
    status,
    headers: {
      'Access-Control-Allow-Origin': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-api-key, x-csrf-token, x-session-id',
      'Access-Control-Allow-Credentials': 'true',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
    }
  });
}