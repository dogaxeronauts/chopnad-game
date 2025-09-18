import crypto from 'crypto';

// 3-Key Cryptographic Validation System
// Her istek için 3 farklı tek kullanımlık anahtar gerekir
export interface ValidationKeys {
  // Key 1: Temporal Key - Zaman damgası tabanlı anahtar
  temporalKey: string;
  
  // Key 2: Payload Key - İstek içeriğine özgü anahtar  
  payloadKey: string;
  
  // Key 3: Identity Key - Kullanıcı kimliğine özgü anahtar
  identityKey: string;
}

export interface ValidationRequest {
  playerAddress: string;
  scoreAmount: number;
  transactionAmount: number;
  validationKeys: ValidationKeys;
  timestamp: number;
}

// Client sadece bu basit parametreleri gönderir
export interface ClientValidationRequest {
  playerAddress: string;
  scoreAmount: number;
  transactionAmount: number;
  timestamp: number;
  // Client tarafından üretilen basit nonce (güvenlik için değil, sadece uniqueness için)
  clientNonce: string;
}

// Challenge-Response sistemi için
export interface NonceChallenge {
  challenge: string;
  expiresAt: number;
  playerAddress: string;
}

export interface ChallengeResponse {
  success: boolean;
  challenge?: string;
  expiresAt?: number;
  error?: string;
}

// Server-side Secret Keys (Environment Variables'dan gelecek)
class CryptoValidationService {
  private readonly SERVER_TEMPORAL_SECRET: string;
  private readonly SERVER_PAYLOAD_SECRET: string;
  private readonly SERVER_IDENTITY_SECRET: string;
  
  // Kullanılmış anahtarları takip et (production'da Redis kullan)
  private usedTemporalKeys = new Set<string>();
  private usedPayloadKeys = new Set<string>();
  private usedIdentityKeys = new Set<string>();
  private usedNonces = new Set<string>(); // Enhanced nonce tracking

  constructor() {
    // Server secrets - Environment variables'dan yükle
    this.SERVER_TEMPORAL_SECRET = process.env.CRYPTO_TEMPORAL_SECRET || this.generateSecret();
    this.SERVER_PAYLOAD_SECRET = process.env.CRYPTO_PAYLOAD_SECRET || this.generateSecret();
    this.SERVER_IDENTITY_SECRET = process.env.CRYPTO_IDENTITY_SECRET || this.generateSecret();
    
    if (!process.env.CRYPTO_TEMPORAL_SECRET) {
      console.warn('CRYPTO_TEMPORAL_SECRET not set, using generated secret');
    }
    if (!process.env.CRYPTO_PAYLOAD_SECRET) {
      console.warn('CRYPTO_PAYLOAD_SECRET not set, using generated secret');
    }
    if (!process.env.CRYPTO_IDENTITY_SECRET) {
      console.warn('CRYPTO_IDENTITY_SECRET not set, using generated secret');
    }

    // Cleanup eski anahtarları her 30 dakikada bir
    setInterval(() => this.cleanupOldKeys(), 30 * 60 * 1000);
  }

  private generateSecret(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  // Generate challenge for client nonce creation with embedded verification
  generateNonceChallenge(playerAddress: string): ChallengeResponse {
    try {
      // Generate timestamp-based challenge that can be verified later
      const timestamp = Date.now();
      const timestampHex = Math.floor(timestamp / 1000).toString(16).padStart(8, '0'); // 8 chars
      
      // Create verification signature for this player and timestamp
      const challengeData = `${playerAddress}-${timestampHex}`;
      const challengeSignature = crypto
        .createHmac('sha256', this.SERVER_TEMPORAL_SECRET)
        .update(challengeData)
        .digest('hex')
        .substring(0, 8); // 8 character signature
      
      // Combine timestamp + signature = 16 character challenge
      const challenge = timestampHex + challengeSignature;
      const expiresAt = timestamp + (5 * 60 * 1000); // 5 minutes validity
      
      return {
        success: true,
        challenge,
        expiresAt
      };
    } catch (error) {
      return {
        success: false,
        error: 'Failed to generate challenge'
      };
    }
  }

  // Validate client nonce against challenge using embedded verification
  validateNonceWithChallenge(
    clientNonce: string,
    playerAddress: string
  ): { valid: boolean; error?: string } {
    try {
      // Validate nonce format first
      if (!/^[a-f0-9]{32}$/i.test(clientNonce)) {
        return { valid: false, error: 'Invalid nonce format' };
      }
      
      // Extract challenge part (first 16 chars) and suffix (last 16 chars)
      const challengePart = clientNonce.substring(0, 16);
      const nonceSuffix = clientNonce.substring(16);
      
      // Extract timestamp from challenge part (first 8 chars)
      const timestampHex = challengePart.substring(0, 8);
      const receivedSignature = challengePart.substring(8, 16);
      
      // Recreate the expected signature using the same method as generation
      const challengeData = `${playerAddress}-${timestampHex}`;
      const expectedSignature = crypto
        .createHmac('sha256', this.SERVER_TEMPORAL_SECRET)
        .update(challengeData)
        .digest('hex')
        .substring(0, 8); // Use first 8 characters as verification
      
      // Verify signature matches
      if (receivedSignature !== expectedSignature) {
        return { valid: false, error: 'Invalid challenge signature' };
      }
      
      // Check challenge timestamp (convert hex timestamp back to ms)
      const challengeTimestamp = parseInt(timestampHex, 16) * 1000; // Convert back to ms
      const now = Date.now();
      const challengeAge = now - challengeTimestamp;
      
      // Challenge should be no older than 5 minutes
      if (challengeAge > 5 * 60 * 1000) {
        return { valid: false, error: 'Challenge expired' };
      }
      
      // Challenge should not be from future (clock skew tolerance: 1 minute)
      if (challengeAge < -60 * 1000) {
        return { valid: false, error: 'Challenge timestamp invalid' };
      }
      
      // Check nonce suffix has sufficient entropy
      if (nonceSuffix.length !== 16) {
        return { valid: false, error: 'Invalid nonce suffix length' };
      }
      
      // Prevent predictable suffixes
      const suffixNum = parseInt(nonceSuffix, 16);
      if (suffixNum === 0 || suffixNum % 1000 === 0) {
        return { valid: false, error: 'Predictable nonce suffix' };
      }
      
      return { valid: true };
    } catch {
      return { valid: false, error: 'Nonce validation error' };
    }
  }

  // SERVER-SIDE: Client request'inden güvenli validation keys üret
  generateSecureValidationKeys(
    clientRequest: ClientValidationRequest
  ): ValidationKeys {
    const { playerAddress, scoreAmount, transactionAmount, timestamp, clientNonce } = clientRequest;
    
    // Server-side secret generation - client hiçbir zaman bu logici görmez
    const temporalNonce = crypto.randomBytes(16).toString('hex');
    const temporalData = `${timestamp}-${temporalNonce}-${clientNonce}`;
    const temporalKey = crypto
      .createHmac('sha256', this.SERVER_TEMPORAL_SECRET)
      .update(temporalData)
      .digest('hex');

    const payloadSalt = crypto.randomBytes(12).toString('hex');
    const payloadData = `${playerAddress}-${scoreAmount}-${transactionAmount}-${payloadSalt}-${timestamp}`;
    const payloadKey = crypto
      .createHmac('sha256', this.SERVER_PAYLOAD_SECRET)
      .update(payloadData)
      .digest('hex');

    const sessionId = crypto.randomBytes(20).toString('hex');
    const identityData = `${playerAddress}-${timestamp}-${sessionId}-${clientNonce}`;
    const identityKey = crypto
      .createHmac('sha256', this.SERVER_IDENTITY_SECRET)
      .update(identityData)
      .digest('hex');

    return {
      temporalKey: `${temporalData}:${temporalKey}`,
      payloadKey: `${payloadData}:${payloadKey}`,
      identityKey: `${identityData}:${identityKey}`
    };
  }

  // DEPRECATED: Bu method artık kullanılmayacak - güvenlik riski
  generateValidationKeys(
    playerAddress: string, 
    scoreAmount: number, 
    transactionAmount: number, 
    timestamp: number
  ): ValidationKeys {
    // Key 1: Temporal Key - Zaman + rastgele nonce
    const temporalNonce = crypto.randomBytes(16).toString('hex');
    const temporalData = `${timestamp}-${temporalNonce}`;
    const temporalKey = crypto
      .createHmac('sha256', this.SERVER_TEMPORAL_SECRET)
      .update(temporalData)
      .digest('hex');

    // Key 2: Payload Key - İstek içeriği + rastgele salt
    const payloadSalt = crypto.randomBytes(12).toString('hex');
    const payloadData = `${playerAddress}-${scoreAmount}-${transactionAmount}-${payloadSalt}`;
    const payloadKey = crypto
      .createHmac('sha256', this.SERVER_PAYLOAD_SECRET)
      .update(payloadData)
      .digest('hex');

    // Key 3: Identity Key - Kullanıcı kimliği + session identifier
    const sessionId = crypto.randomBytes(20).toString('hex');
    const identityData = `${playerAddress}-${timestamp}-${sessionId}`;
    const identityKey = crypto
      .createHmac('sha256', this.SERVER_IDENTITY_SECRET)
      .update(identityData)
      .digest('hex');

    return {
      temporalKey: `${temporalData}:${temporalKey}`,
      payloadKey: `${payloadData}:${payloadKey}`,
      identityKey: `${identityData}:${identityKey}`
    };
  }

  // SERVER-SIDE: Client request'i güvenli şekilde doğrula ve anahtar üret
  validateClientRequest(clientRequest: ClientValidationRequest): {
    valid: boolean;
    errors: string[];
    securityLevel: 'HIGH' | 'MEDIUM' | 'LOW' | 'FAILED';
    validationKeys?: ValidationKeys;
  } {
    const errors: string[] = [];
    
    // 1. Basic request validation
    if (!clientRequest.playerAddress || !clientRequest.playerAddress.startsWith('0x')) {
      errors.push('Invalid player address');
    }
    
    if (clientRequest.scoreAmount < 0 || clientRequest.scoreAmount > 1000000) {
      errors.push('Invalid score amount');
    }
    
    if (clientRequest.transactionAmount < 0 || clientRequest.transactionAmount > 1000) {
      errors.push('Invalid transaction amount');
    }
    
    // 2. Timestamp validation
    const now = Date.now();
    const timeDiff = Math.abs(now - clientRequest.timestamp);
    if (timeDiff > 5 * 60 * 1000) { // 5 minutes tolerance
      errors.push('Request timestamp too old or invalid');
    }
    
    // 3. Enhanced Client nonce validation with challenge system
    if (!clientRequest.clientNonce || clientRequest.clientNonce.length !== 32) {
      errors.push('Invalid client nonce format');
    } else {
      // Check for nonce reuse first
      if (this.usedNonces.has(clientRequest.clientNonce)) {
        errors.push('Nonce has already been used');
      } else {
        // Validate nonce against challenge
        const nonceValidation = this.validateNonceWithChallenge(
          clientRequest.clientNonce, 
          clientRequest.playerAddress
        );
        if (!nonceValidation.valid) {
          errors.push(`Nonce challenge validation failed: ${nonceValidation.error}`);
        }
      }
    }
    
    // 4. Enhanced duplicate request detection
    const requestKey = `${clientRequest.playerAddress}-${clientRequest.clientNonce}`;
    if (this.usedTemporalKeys.has(requestKey)) {
      errors.push('Duplicate request nonce detected');
    }
    
    // 5. Additional rate limiting per timestamp window
    const timestampWindow = Math.floor(clientRequest.timestamp / (30 * 1000)); // 30 second windows
    const windowKey = `${clientRequest.playerAddress}-${timestampWindow}`;
    if (this.usedPayloadKeys.has(windowKey)) {
      errors.push('Too many requests in timestamp window');
    }
    
    if (errors.length === 0) {
      // Tüm validasyonlar geçti, güvenli anahtar üret
      const validationKeys = this.generateSecureValidationKeys(clientRequest);
      
      // Request'i kullanılmış olarak işaretle
      this.usedTemporalKeys.add(requestKey);
      this.usedPayloadKeys.add(windowKey);
      this.usedNonces.add(clientRequest.clientNonce); // Mark nonce as used
      
      return {
        valid: true,
        errors: [],
        securityLevel: 'HIGH',
        validationKeys
      };
    }
    
    return {
      valid: false,
      errors,
      securityLevel: 'FAILED'
    };
  }

  // Server-side nonce validation - client manipülasyonunu önler
  private validateClientNonce(
    clientNonce: string, 
    playerAddress: string, 
    timestamp: number
  ): { valid: boolean; error?: string } {
    try {
      // 1. Nonce format validation - hex pattern kontrolü
      if (!/^[a-f0-9]{32}$/i.test(clientNonce)) {
        return { valid: false, error: 'Nonce error' };
      }
      
      // 2. Server-side cryptographic challenge
      // Client cannot predict this, so we use it for unique verification
      const serverChallenge = crypto
        .createHmac('sha256', this.SERVER_IDENTITY_SECRET)
        .update(`${playerAddress}-${clientNonce}-${timestamp}`)
        .digest('hex');
      
      // 3. Entropy and pattern checks
      const nonceBytes = Buffer.from(clientNonce, 'hex');
      
      // Check for sufficient entropy (no repeating patterns)
      const uniqueBytes = new Set(nonceBytes);
      if (uniqueBytes.size < 8) {
        return { valid: false, error: 'Insufficient nonce entropy - too many repeated bytes' };
      }
      
      // 4. Prevent simple incremental or predictable nonces
      const firstWord = parseInt(clientNonce.substring(0, 8), 16);
      const secondWord = parseInt(clientNonce.substring(8, 16), 16);
      const thirdWord = parseInt(clientNonce.substring(16, 24), 16);
      const fourthWord = parseInt(clientNonce.substring(24, 32), 16);
      
      // Detect sequential patterns
      if (Math.abs(secondWord - firstWord) < 256 && 
          Math.abs(thirdWord - secondWord) < 256 && 
          Math.abs(fourthWord - thirdWord) < 256) {
        return { valid: false, error: 'Nonce appears to have sequential pattern' };
      }
      
      // 5. Prevent null or common weak nonces
      const weakNonces = [
        '00000000000000000000000000000000',
        'ffffffffffffffffffffffffffffffff',
        '12345678901234567890123456789012',
        'abcdefabcdefabcdefabcdefabcdefab'
      ];
      
      if (weakNonces.includes(clientNonce.toLowerCase())) {
        return { valid: false, error: 'Weak or common nonce detected' };
      }
      
      // 6. Time-based validation - nonce must have been generated recently
      const serverTimestamp = Date.now();
      const timeDiff = Math.abs(serverTimestamp - timestamp);
      if (timeDiff > 2 * 60 * 1000) { // 2 minutes max
        return { valid: false, error: 'Nonce timestamp too old' };
      }
      
      return { valid: true };
    } catch {
      return { valid: false, error: 'Nonce validation error' };
    }
  }

  // DEPRECATED: Eski method - güvenlik riski
  validateKeys(clientValidationKeys: ValidationKeys, request: ValidationRequest): {
    valid: boolean;
    errors: string[];
    securityLevel: 'HIGH' | 'MEDIUM' | 'LOW' | 'FAILED';
  } {
    const errors: string[] = [];
    let validKeyCount = 0;

    // Client'tan gelen raw data'yı server'da imzala ve doğrula
    const serverSignedKeys = this.signClientKeys(clientValidationKeys);

    // 1. Temporal Key Validation
    const temporalValid = this.validateTemporalKey(
      serverSignedKeys.temporalKey, 
      request.timestamp
    );
    if (!temporalValid.valid) {
      errors.push(`Temporal key validation failed: ${temporalValid.error}`);
    } else {
      validKeyCount++;
    }

    // 2. Payload Key Validation  
    const payloadValid = this.validatePayloadKey(
      serverSignedKeys.payloadKey,
      request.playerAddress,
      request.scoreAmount,
      request.transactionAmount
    );
    if (!payloadValid.valid) {
      errors.push(`Payload key validation failed: ${payloadValid.error}`);
    } else {
      validKeyCount++;
    }

    // 3. Identity Key Validation
    const identityValid = this.validateIdentityKey(
      serverSignedKeys.identityKey,
      request.playerAddress,
      request.timestamp
    );
    if (!identityValid.valid) {
      errors.push(`Identity key validation failed: ${identityValid.error}`);
    } else {
      validKeyCount++;
    }

    // Security Level Assessment
    let securityLevel: 'HIGH' | 'MEDIUM' | 'LOW' | 'FAILED';
    if (validKeyCount === 3) {
      securityLevel = 'HIGH';
    } else if (validKeyCount === 2) {
      securityLevel = 'MEDIUM';
    } else if (validKeyCount === 1) {
      securityLevel = 'LOW';
    } else {
      securityLevel = 'FAILED';
    }

    // Sadece tüm anahtarlar geçerliyse kabul et
    const allValid = validKeyCount === 3;

    // Geçerli anahtarları kullanılmış olarak işaretle
    if (allValid) {
      this.markKeysAsUsed(serverSignedKeys);
    }

    return {
      valid: allValid,
      errors,
      securityLevel
    };
  }

  // Client'tan gelen raw data'yı server secret'larıyla imzala
  private signClientKeys(clientKeys: ValidationKeys): ValidationKeys {
    // Temporal key signature
    const temporalSignature = crypto
      .createHmac('sha256', this.SERVER_TEMPORAL_SECRET)
      .update(clientKeys.temporalKey)
      .digest('hex');

    // Payload key signature
    const payloadSignature = crypto
      .createHmac('sha256', this.SERVER_PAYLOAD_SECRET)
      .update(clientKeys.payloadKey)
      .digest('hex');

    // Identity key signature
    const identitySignature = crypto
      .createHmac('sha256', this.SERVER_IDENTITY_SECRET)
      .update(clientKeys.identityKey)
      .digest('hex');

    return {
      temporalKey: `${clientKeys.temporalKey}:${temporalSignature}`,
      payloadKey: `${clientKeys.payloadKey}:${payloadSignature}`,
      identityKey: `${clientKeys.identityKey}:${identitySignature}`
    };
  }

  private validateTemporalKey(temporalKey: string, requestTimestamp: number): {
    valid: boolean;
    error?: string;
  } {
    try {
      const [data, signature] = temporalKey.split(':');
      if (!data || !signature) {
        return { valid: false, error: 'Invalid temporal key format' };
      }

      // Zaten kullanılmış mı kontrol et
      if (this.usedTemporalKeys.has(temporalKey)) {
        return { valid: false, error: 'Temporal key already used' };
      }

      // Signature'ı doğrula
      const expectedSignature = crypto
        .createHmac('sha256', this.SERVER_TEMPORAL_SECRET)
        .update(data)
        .digest('hex');

      if (signature !== expectedSignature) {
        return { valid: false, error: 'Invalid temporal key signature' };
      }

      // Zaman damgası kontrolü - data formatı: timestamp-nonce
      const [timestampStr] = data.split('-');
      const keyTimestamp = parseInt(timestampStr, 10);
      
      if (isNaN(keyTimestamp)) {
        return { valid: false, error: 'Invalid timestamp in temporal key' };
      }

      // 2 dakika tolerans
      const timeDiff = Math.abs(requestTimestamp - keyTimestamp);
      if (timeDiff > 2 * 60 * 1000) {
        return { valid: false, error: 'Temporal key expired or invalid timestamp' };
      }

      return { valid: true };
    } catch {
      return { valid: false, error: 'Temporal key validation error' };
    }
  }

  private validatePayloadKey(
    payloadKey: string, 
    playerAddress: string, 
    scoreAmount: number, 
    transactionAmount: number
  ): { valid: boolean; error?: string; } {
    try {
      const [data, signature] = payloadKey.split(':');
      if (!data || !signature) {
        return { valid: false, error: 'Invalid payload key format' };
      }

      // Zaten kullanılmış mı kontrol et
      if (this.usedPayloadKeys.has(payloadKey)) {
        return { valid: false, error: 'Payload key already used' };
      }

      // Signature'ı doğrula
      const expectedSignature = crypto
        .createHmac('sha256', this.SERVER_PAYLOAD_SECRET)
        .update(data)
        .digest('hex');

      if (signature !== expectedSignature) {
        return { valid: false, error: 'Invalid payload key signature' };
      }

      // Payload verilerini kontrol et - data formatı: playerAddress-scoreAmount-transactionAmount-salt
      const parts = data.split('-');
      if (parts.length !== 4) {
        return { valid: false, error: 'Invalid payload key data format' };
      }

      const [keyPlayerAddress, keyScoreAmount, keyTransactionAmount] = parts;
      
      if (keyPlayerAddress !== playerAddress) {
        return { valid: false, error: 'Player address mismatch in payload key' };
      }

      if (parseInt(keyScoreAmount, 10) !== scoreAmount) {
        return { valid: false, error: 'Score amount mismatch in payload key' };
      }

      if (parseInt(keyTransactionAmount, 10) !== transactionAmount) {
        return { valid: false, error: 'Transaction amount mismatch in payload key' };
      }

      return { valid: true };
    } catch {
      return { valid: false, error: 'Payload key validation error' };
    }
  }

  private validateIdentityKey(
    identityKey: string, 
    playerAddress: string, 
    requestTimestamp: number
  ): { valid: boolean; error?: string; } {
    try {
      const [data, signature] = identityKey.split(':');
      if (!data || !signature) {
        return { valid: false, error: 'Invalid identity key format' };
      }

      // Zaten kullanılmış mı kontrol et
      if (this.usedIdentityKeys.has(identityKey)) {
        return { valid: false, error: 'Identity key already used' };
      }

      // Signature'ı doğrula
      const expectedSignature = crypto
        .createHmac('sha256', this.SERVER_IDENTITY_SECRET)
        .update(data)
        .digest('hex');

      if (signature !== expectedSignature) {
        return { valid: false, error: 'Invalid identity key signature' };
      }

      // Identity verilerini kontrol et - data formatı: playerAddress-timestamp-sessionId
      const parts = data.split('-');
      if (parts.length !== 3) {
        return { valid: false, error: 'Invalid identity key data format' };
      }

      const [keyPlayerAddress, keyTimestamp] = parts;
      
      if (keyPlayerAddress !== playerAddress) {
        return { valid: false, error: 'Player address mismatch in identity key' };
      }

      const identityTimestamp = parseInt(keyTimestamp, 10);
      if (isNaN(identityTimestamp)) {
        return { valid: false, error: 'Invalid timestamp in identity key' };
      }

      // 2 dakika tolerans
      const timeDiff = Math.abs(requestTimestamp - identityTimestamp);
      if (timeDiff > 2 * 60 * 1000) {
        return { valid: false, error: 'Identity key timestamp too old' };
      }

      return { valid: true };
    } catch {
      return { valid: false, error: 'Identity key validation error' };
    }
  }

  private markKeysAsUsed(keys: ValidationKeys): void {
    this.usedTemporalKeys.add(keys.temporalKey);
    this.usedPayloadKeys.add(keys.payloadKey);
    this.usedIdentityKeys.add(keys.identityKey);
  }

  private cleanupOldKeys(): void {
    // 30 dakikadan eski anahtarları temizle
    // Production'da Redis TTL kullanılmalı
    const oldSize = this.usedTemporalKeys.size + this.usedPayloadKeys.size + this.usedIdentityKeys.size + this.usedNonces.size;
    
    // Basit cleanup - gerçek production'da daha sofistike olmalı
    if (oldSize > 10000) {
      this.usedTemporalKeys.clear();
      this.usedPayloadKeys.clear();
      this.usedIdentityKeys.clear();
      this.usedNonces.clear();
    }
  }

  // Client-side için public key'leri expose et (sadece doğrulama için)
  getPublicValidationInfo(): {
    temporalSecretHash: string;
    payloadSecretHash: string;
    identitySecretHash: string;
  } {
    return {
      temporalSecretHash: crypto.createHash('sha256').update(this.SERVER_TEMPORAL_SECRET).digest('hex').substring(0, 16),
      payloadSecretHash: crypto.createHash('sha256').update(this.SERVER_PAYLOAD_SECRET).digest('hex').substring(0, 16),
      identitySecretHash: crypto.createHash('sha256').update(this.SERVER_IDENTITY_SECRET).digest('hex').substring(0, 16),
    };
  }
}

// Singleton instance
let cryptoValidationService: CryptoValidationService;

export function getCryptoValidationService(): CryptoValidationService {
  if (!cryptoValidationService) {
    cryptoValidationService = new CryptoValidationService();
  }
  return cryptoValidationService;
}

// Client-side helper - Challenge-based secure request generation
export async function generateClientValidationRequest(
  playerAddress: string,
  scoreAmount: number, 
  transactionAmount: number
): Promise<ClientValidationRequest> {
  const timestamp = Date.now();
  
  // Use challenge-based nonce generation
  const clientNonce = await generateChallengeBasedNonce(playerAddress);

  return {
    playerAddress,
    scoreAmount,
    transactionAmount,
    timestamp,
    clientNonce
  };
}

// DEPRECATED: Synchronous version - use async version above
export function generateClientValidationRequestSync(
  playerAddress: string,
  scoreAmount: number, 
  transactionAmount: number
): ClientValidationRequest {
  const timestamp = Date.now();
  
  // Browser-compatible crypto random generation
  const getRandomBytes = (length: number): string => {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
      const array = new Uint8Array(length);
      window.crypto.getRandomValues(array);
      return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    } else {
      // Node.js environment
      return crypto.randomBytes(length).toString('hex');
    }
  };

  // Fallback nonce generation (not challenge-based)
  const clientNonce = getRandomBytes(16);

  return {
    playerAddress,
    scoreAmount,
    transactionAmount,
    timestamp,
    clientNonce
  };
}

// Secure client nonce generation - server expectations ile uyumlu
function generateSecureClientNonce(playerAddress: string, timestamp: number): string {
  // Browser-compatible crypto random generation
  const getRandomBytes = (length: number): string => {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
      const array = new Uint8Array(length);
      window.crypto.getRandomValues(array);
      return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    } else {
      // Node.js environment  
      return crypto.randomBytes(length).toString('hex');
    }
  };

  // Client needs to generate nonce that will pass server validation
  // Generate exactly 32-character hexadecimal string (16 bytes)
  const randomBytes16 = getRandomBytes(16); // 16 bytes = exactly 32 hex characters
  
  return randomBytes16;
}

// Challenge-based secure nonce generation for client
export async function generateChallengeBasedNonce(playerAddress: string): Promise<string> {
  try {
    // Request challenge from server
    const challengeResponse = await fetch('/api/get-secure-nonce', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ playerAddress })
    });
    
    if (!challengeResponse.ok) {
      throw new Error('Failed to get challenge from server');
    }
    
    const challengeData = await challengeResponse.json();
    
    if (!challengeData.success || !challengeData.challenge) {
      throw new Error('Invalid challenge response');
    }
    
    // Generate client nonce using challenge
    const challenge = challengeData.challenge; // 16 character challenge prefix
    
    // Browser-compatible crypto random generation for suffix
    const getRandomBytes = (length: number): string => {
      if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
        const array = new Uint8Array(length);
        window.crypto.getRandomValues(array);
        return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
      } else {
        return crypto.randomBytes(length).toString('hex');
      }
    };
    
    // Generate random suffix (16 chars) + add entropy
    const randomSuffix = getRandomBytes(8); // 8 bytes = 16 hex chars
    
    // Combine challenge + random suffix = 32 char nonce
    const nonce = challenge + randomSuffix;
    
    return nonce;
  } catch (error) {
    console.error('Error generating challenge-based nonce:', error);
    // Fallback to basic generation if challenge fails
    const getRandomBytes = (length: number): string => {
      if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
        const array = new Uint8Array(length);
        window.crypto.getRandomValues(array);
        return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
      } else {
        return crypto.randomBytes(length).toString('hex');
      }
    };
    return getRandomBytes(16);
  }
}

// DEPRECATED: Bu function artık kullanılmamalı - güvenlik riski
export function generateClientValidationKeys(
  playerAddress: string,
  scoreAmount: number, 
  transactionAmount: number
): ValidationKeys {
  // Bu function deprecated - güvenlik riski
  console.warn('generateClientValidationKeys is deprecated - use generateClientValidationRequest instead');
  
  const timestamp = Date.now();
  
  // Browser-compatible crypto random generation
  const getRandomBytes = (length: number): string => {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
      const array = new Uint8Array(length);
      window.crypto.getRandomValues(array);
      return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    } else {
      // Node.js environment
      return crypto.randomBytes(length).toString('hex');
    }
  };

  // Client sadece data kısmını oluşturur, server signature'ları ekler
  const temporalNonce = getRandomBytes(16);
  const payloadSalt = getRandomBytes(12);
  const sessionId = getRandomBytes(20);

  return {
    temporalKey: `${timestamp}-${temporalNonce}`,
    payloadKey: `${playerAddress}-${scoreAmount}-${transactionAmount}-${payloadSalt}`,
    identityKey: `${playerAddress}-${timestamp}-${sessionId}`
  };
}