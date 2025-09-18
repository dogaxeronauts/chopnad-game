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

// Server-side Secret Keys (Environment Variables'dan gelecek)
class CryptoValidationService {
  private readonly SERVER_TEMPORAL_SECRET: string;
  private readonly SERVER_PAYLOAD_SECRET: string;
  private readonly SERVER_IDENTITY_SECRET: string;
  
  // Kullanılmış anahtarları takip et (production'da Redis kullan)
  private usedTemporalKeys = new Set<string>();
  private usedPayloadKeys = new Set<string>();
  private usedIdentityKeys = new Set<string>();

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

  // CLIENT-SIDE: 3 Doğrulama anahtarı üret
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

  // SERVER-SIDE: Client'tan gelen data'yı alıp signature'ları oluşturarak doğrula
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
    } catch (error) {
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

      const [keyPlayerAddress, keyScoreAmount, keyTransactionAmount, salt] = parts;
      
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
    } catch (error) {
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

      const [keyPlayerAddress, keyTimestamp, sessionId] = parts;
      
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
    } catch (error) {
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
    const oldSize = this.usedTemporalKeys.size + this.usedPayloadKeys.size + this.usedIdentityKeys.size;
    
    // Basit cleanup - gerçek production'da daha sofistike olmalı
    if (oldSize > 10000) {
      this.usedTemporalKeys.clear();
      this.usedPayloadKeys.clear();
      this.usedIdentityKeys.clear();
      console.log('Crypto validation: Cleared old keys due to memory limit');
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

// Client-side helper (browser-compatible) - Creates validation key data without server secrets
export function generateClientValidationKeys(
  playerAddress: string,
  scoreAmount: number, 
  transactionAmount: number
): ValidationKeys {
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