import { Injectable } from "@nestjs/common";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const HASH_PREFIX = "scrypt";
const HASH_VERSION = "1";
const SCRYPT_COST = 2 ** 17;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_MAX_MEMORY = 256 * 1024 * 1024;
const ENCODED_PARAMETERS = [
  HASH_PREFIX,
  HASH_VERSION,
  String(SCRYPT_COST),
  String(SCRYPT_BLOCK_SIZE),
  String(SCRYPT_PARALLELIZATION),
] as const;

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_LENGTH,
      {
        N: SCRYPT_COST,
        maxmem: SCRYPT_MAX_MEMORY,
        p: SCRYPT_PARALLELIZATION,
        r: SCRYPT_BLOCK_SIZE,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(derivedKey);
      },
    );
  });
}

@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derivedKey = await deriveKey(password, salt);

    return [
      ...ENCODED_PARAMETERS,
      salt.toString("base64url"),
      derivedKey.toString("base64url"),
    ].join("$");
  }

  async verify(password: string, encodedHash: string): Promise<boolean> {
    const [
      prefix,
      version,
      cost,
      blockSize,
      parallelization,
      encodedSalt,
      encodedKey,
      ...extraParts
    ] = encodedHash.split("$");

    if (
      prefix !== ENCODED_PARAMETERS[0] ||
      version !== ENCODED_PARAMETERS[1] ||
      cost !== ENCODED_PARAMETERS[2] ||
      blockSize !== ENCODED_PARAMETERS[3] ||
      parallelization !== ENCODED_PARAMETERS[4] ||
      !encodedSalt ||
      !encodedKey ||
      extraParts.length > 0
    ) {
      return false;
    }

    const salt = Buffer.from(encodedSalt, "base64url");
    const storedKey = Buffer.from(encodedKey, "base64url");

    if (salt.length !== 16 || storedKey.length !== KEY_LENGTH) {
      return false;
    }

    const suppliedKey = await deriveKey(password, salt);
    return timingSafeEqual(storedKey, suppliedKey);
  }
}
