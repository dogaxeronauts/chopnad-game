# 3-Key Cryptographic Validation System

## Güvenlik Özeti

Bu sistem her istek için **3 farklı tek kullanımlık doğrulama anahtarı** kullanarak müthiş bir anti-abuse koruması sağlar:

### 🔐 3 Anahtar Türü

1. **Temporal Key** - Zaman damgası tabanlı anahtar
   - İstek zamanını doğrular
   - 2 dakika tolerance süresi
   - Asla tekrar kullanılamaz

2. **Payload Key** - İstek içeriğine özgü anahtar
   - playerAddress, scoreAmount, transactionAmount'ı doğrular
   - İçerik değiştirilirse geçersiz olur
   - Her istek için unique

3. **Identity Key** - Kullanıcı kimliğine özgü anahtar
   - Kullanıcı kimliğini ve session'ı doğrular
   - Çapraz kullanıcı saldırılarını engeller
   - Session bazlı güvenlik

### 🛡️ Güvenlik Katmanları

- **Private/Public Key Mantığı**: Server'da private secret'lar, client'ta public derivation
- **Single-Use Nonces**: Her anahtar sadece 1 kez kullanılabilir
- **Cryptographic HMAC**: SHA-256 tabanlı güvenli imzalama
- **Temporal Validation**: Zaman aşımı kontrolü
- **Content Integrity**: İstek içeriği değiştirilemez
- **Cross-User Protection**: Farklı kullanıcılar birbirinin anahtarlarını kullanamaz

### 🚨 Anti-Abuse Koruması

✅ **Replay Attack**: İmkansız (single-use keys)  
✅ **Content Tampering**: İmkansız (payload signature)  
✅ **Time Manipulation**: İmkansız (temporal validation)  
✅ **Cross-User Abuse**: İmkansız (identity binding)  
✅ **Brute Force**: İmkansız (cryptographic strength)  
✅ **Request Flooding**: İmkansız (rate limiting + key validation)

## 🔧 Environment Setup

Gerekli secrets'ları `.env` dosyasına ekleyin:

```bash
# 3-Key Validation Secrets (32 byte each)
CRYPTO_TEMPORAL_SECRET="64_hex_characters_here"
CRYPTO_PAYLOAD_SECRET="64_hex_characters_here"  
CRYPTO_IDENTITY_SECRET="64_hex_characters_here"
```

### Secret Oluşturma

Node.js ile güvenli secret'lar oluşturun:

```javascript
const crypto = require('crypto');
console.log('CRYPTO_TEMPORAL_SECRET=' + crypto.randomBytes(32).toString('hex'));
console.log('CRYPTO_PAYLOAD_SECRET=' + crypto.randomBytes(32).toString('hex'));
console.log('CRYPTO_IDENTITY_SECRET=' + crypto.randomBytes(32).toString('hex'));
```

## 📊 Kullanım

### Client-Side (Otomatik)

```typescript
import { submitPlayerScore } from '@/app/lib/score-api';

// 3 validation key otomatik oluşturulur ve gönderilir
const result = await submitPlayerScore(
  playerAddress,
  scoreAmount,
  transactionAmount
);
```

### Server-Side (Otomatik)

```typescript
// Her istek otomatik olarak 3 key ile doğrulanır
// SECURITY LAYER 3: 3-Key Cryptographic Validation
const cryptoValidation = cryptoService.validateKeys(validationKeys, validationRequest);
```

## 🎯 Güvenlik Seviyeleri

- **HIGH**: Tüm 3 anahtar geçerli ✅
- **MEDIUM**: 2 anahtar geçerli ⚠️ 
- **LOW**: 1 anahtar geçerli ⚠️
- **FAILED**: 0 anahtar geçerli ❌

Sadece **HIGH** seviyeli istekler kabul edilir.

## 🔍 Monitoring

Her istek için detaylı logging:

```
Crypto validation passed with security level: HIGH
✅ Temporal key validated
✅ Payload key validated  
✅ Identity key validated
```

## 🚀 Production Notları

- **Redis**: Memory-based tracking'i Redis'e taşıyın
- **Monitoring**: Key validation metrics toplayın
- **Alerting**: Başarısız validation'lar için alert kurun
- **Backup**: Secret'ları güvenli şekilde backup alın

## 🆚 Önceki Sistemle Karşılaştırma

| Özellik | Önceki CSRF | Yeni 3-Key System |
|---------|-------------|-------------------|
| Tek kullanım | ❌ | ✅ |
| Content integrity | ❌ | ✅ |
| User binding | ❌ | ✅ |
| Crypto strength | Orta | Yüksek |
| Abuse resistance | Düşük | Ultra Yüksek |
| Replay protection | Kısmi | Tam |

## 💡 Gelecek Geliştirmeler

- [ ] Hardware Security Module (HSM) entegrasyonu
- [ ] Quantum-resistant algoritmalara geçiş hazırlığı  
- [ ] Machine learning tabanlı anomali detection
- [ ] Blockchain-based key verification