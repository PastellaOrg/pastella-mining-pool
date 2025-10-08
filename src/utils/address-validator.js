/**
 * Wallet Address Validator for Mining Pool
 * Validates P2PKH addresses that start with '1'
 */

/**
 * Validate P2PKH wallet address format
 * @param {string} address - Wallet address to validate
 * @returns {Object} Validation result with success status and error message
 */
function validateWalletAddress(address) {
  // Check if address is provided
  if (!address || typeof address !== 'string') {
    return {
      valid: false,
      error: 'INVALID_ADDRESS_FORMAT',
      message: 'Wallet address is required and must be a string'
    };
  }

  // Trim whitespace
  address = address.trim();

  // Check minimum and maximum length (P2PKH addresses are typically 26-35 characters)
  if (address.length < 26 || address.length > 35) {
    return {
      valid: false,
      error: 'INVALID_ADDRESS_LENGTH',
      message: `Invalid wallet address length. Expected 26-35 characters, got ${address.length}`
    };
  }

  // Check if address starts with '1' (P2PKH format)
  if (!address.startsWith('1')) {
    return {
      valid: false,
      error: 'INVALID_ADDRESS_PREFIX',
      message: 'Invalid wallet address format. Address must start with "1" (P2PKH format)'
    };
  }

  // Validate Base58 character set (excludes 0, O, I, l to avoid confusion)
  // Valid characters: 123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz
  const base58Regex = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/;
  if (!base58Regex.test(address)) {
    return {
      valid: false,
      error: 'INVALID_ADDRESS_CHARACTERS',
      message: 'Invalid wallet address format. Address contains invalid characters'
    };
  }

  // Full P2PKH address format validation: starts with 1, followed by valid Base58 characters
  const p2pkhRegex = /^1[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{25,34}$/;
  if (!p2pkhRegex.test(address)) {
    return {
      valid: false,
      error: 'INVALID_ADDRESS_FORMAT',
      message: 'Invalid P2PKH wallet address format'
    };
  }

  // Address is valid
  return {
    valid: true,
    error: null,
    message: 'Valid wallet address'
  };
}

/**
 * Quick validation check - returns boolean only
 * @param {string} address - Wallet address to validate
 * @returns {boolean} True if valid, false otherwise
 */
function isValidWalletAddress(address) {
  const result = validateWalletAddress(address);
  return result.valid;
}

module.exports = {
  validateWalletAddress,
  isValidWalletAddress
};
