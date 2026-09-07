import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto';

/**
 * Cifrado simétrico para secretos de terceros (tokens de Mercado Pago).
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ AES-256-GCM
 * ---------------------------------------------------------------------------
 * GCM es cifrado autenticado: además de ocultar el dato, detecta si el
 * ciphertext fue alterado. Si alguien toca la fila en la base, el descifrado
 * falla en vez de devolver basura silenciosamente.
 *
 * Formato del texto guardado (todo en base64, separado por ':'):
 *   salt : iv : authTag : ciphertext
 *
 * La clave se deriva de PAYMENTS_ENC_KEY (env) + un salt aleatorio por
 * secreto. Así, dos tokens iguales de dos clubes no producen el mismo
 * ciphertext, y comprometer un registro no compromete al resto.
 *
 * IMPORTANTE: si perdés PAYMENTS_ENC_KEY, perdés todos los tokens (los clubes
 * tienen que reconectar). Guardala en el secret manager, no en el repo.
 * ---------------------------------------------------------------------------
 */
@Injectable()
export class CryptoService {
  private readonly masterKey: string;

  constructor(private readonly config: ConfigService) {
    const key = this.config.get<string>('PAYMENTS_ENC_KEY');
    if (!key || key.length < 32) {
      throw new InternalServerErrorException(
        'PAYMENTS_ENC_KEY ausente o demasiado corta (mínimo 32 caracteres). ' +
          'Generá una con: openssl rand -base64 48',
      );
    }
    this.masterKey = key;
  }

  encrypt(plaintext: string): string {
    const salt = randomBytes(16);
    const iv = randomBytes(12); // 96 bits, recomendado para GCM
    const key = scryptSync(this.masterKey, salt, 32);

    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
      salt.toString('base64'),
      iv.toString('base64'),
      authTag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  decrypt(payload: string): string {
    const parts = payload.split(':');
    if (parts.length !== 4) {
      throw new InternalServerErrorException(
        'Formato de secreto inválido (esperaba salt:iv:tag:data).',
      );
    }

    const [saltB64, ivB64, tagB64, dataB64] = parts;
    const salt = Buffer.from(saltB64, 'base64');
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');
    const ciphertext = Buffer.from(dataB64, 'base64');

    const key = scryptSync(this.masterKey, salt, 32);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    try {
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      // authTag no coincide → el dato fue alterado o la clave cambió.
      throw new InternalServerErrorException(
        'No se pudo descifrar el secreto (dato corrupto o clave incorrecta).',
      );
    }
  }
}
