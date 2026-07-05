const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

export const isHexHash = (value: string) => /^[a-f0-9]{40}$/i.test(value);
export const isBase32Hash = (value: string) => /^[a-z2-7]{32}$/i.test(value);

export const isInfoHash = (value: string) => isHexHash(value) || isBase32Hash(value);

const base32ToHex = (value: string) => {
  let bits = '';

  for (const char of value.toLowerCase()) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      return '';
    }
    bits += index.toString(2).padStart(5, '0');
  }

  let hex = '';
  for (let i = 0; i + 4 <= bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }

  return hex.slice(0, 40);
};

export const normalizeInfoHash = (value: string) => {
  const trimmed = value.trim().toLowerCase();
  if (isHexHash(trimmed)) {
    return trimmed;
  }
  if (isBase32Hash(trimmed)) {
    return base32ToHex(trimmed);
  }
  return '';
};
