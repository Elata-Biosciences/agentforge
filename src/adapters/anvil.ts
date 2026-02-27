/**
 * Anvil adapter - manages local Ethereum development node
 *
 * Provides:
 * - Spawning Anvil as a subprocess
 * - Time manipulation (evm_increaseTime, evm_mine)
 * - State snapshots (evm_snapshot, evm_revert)
 * - Balance manipulation (anvil_setBalance)
 * - Account impersonation (anvil_impersonateAccount)
 */

import { type ChildProcess, exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { http, type PublicClient, createPublicClient } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';

const execAsync = promisify(exec);

/**
 * Anvil configuration options
 */
export interface AnvilConfig {
  /** Port to run on (default: 8545) */
  port?: number;
  /** Chain ID (default: 31337) */
  chainId?: number;
  /** Block time in seconds (0 = instant mining) */
  blockTime?: number;
  /** Fork URL for mainnet forking */
  forkUrl?: string;
  /** Fork block number */
  forkBlockNumber?: number;
  /** Number of accounts to generate */
  accounts?: number;
  /** Initial balance per account in wei */
  balance?: bigint;
  /** Mnemonic for account generation */
  mnemonic?: string;
  /** Enable auto-impersonation */
  autoImpersonate?: boolean;
  /** Silent mode - suppress Anvil output */
  silent?: boolean;
  /** Base fee */
  baseFee?: bigint;
  /** Gas limit */
  gasLimit?: bigint;
  /** Gas price */
  gasPrice?: bigint;
  /** Contract code size limit in bytes (default: 24576 per EIP-170) */
  codeSizeLimit?: number;
  /** Genesis timestamp for deterministic chain time */
  timestamp?: number;
}

/**
 * Anvil instance state
 */
export interface AnvilInstance {
  /** Process handle */
  process: ChildProcess | null;
  /** RPC URL */
  url: string;
  /** WebSocket URL */
  wsUrl: string;
  /** Chain ID */
  chainId: number;
  /** Port */
  port: number;
  /** Generated accounts (addresses) */
  accounts: string[];
  /** Private keys for generated accounts */
  privateKeys: string[];
  /** Whether instance is running */
  running: boolean;
  /** Viem public client for RPC calls */
  client: PublicClient | null;
}

/**
 * Default Anvil configuration
 */
export const DEFAULT_ANVIL_CONFIG: Required<
  Omit<
    AnvilConfig,
    | 'forkUrl'
    | 'forkBlockNumber'
    | 'mnemonic'
    | 'baseFee'
    | 'gasLimit'
    | 'gasPrice'
    | 'codeSizeLimit'
    | 'timestamp'
  >
> = {
  port: 8545,
  chainId: 31337,
  blockTime: 0,
  accounts: 10,
  balance: 10000n * 10n ** 18n, // 10000 ETH
  autoImpersonate: false,
  silent: false,
};

/**
 * Default mnemonic used by Anvil
 */
export const DEFAULT_ANVIL_MNEMONIC = 'test test test test test test test test test test test junk';

/**
 * Check if Anvil is installed
 * @returns True if Anvil is available in PATH
 */
export async function isAnvilInstalled(): Promise<boolean> {
  try {
    await execAsync('anvil --version');
    return true;
  } catch {
    return false;
  }
}

/**
 * Get Anvil version
 * @returns The Anvil version string or null if not installed
 */
export async function getAnvilVersion(): Promise<string | null> {
  try {
    const { stdout } = await execAsync('anvil --version');
    return stdout.trim().split('\n')[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Wait for Anvil to be ready by polling the RPC endpoint
 */
async function waitForAnvil(url: string, timeoutMs = 30000): Promise<void> {
  const startTime = Date.now();
  const pollInterval = 100;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_chainId',
          params: [],
          id: 1,
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as { result?: string };
        if (data.result) {
          return; // Anvil is ready
        }
      }
    } catch {
      // Anvil not ready yet, continue polling
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(`Anvil failed to start within ${timeoutMs}ms`);
}

/**
 * Parse Anvil output to extract accounts and private keys
 */
function parseAnvilOutput(output: string): { accounts: string[]; privateKeys: string[] } {
  const accounts: string[] = [];
  const privateKeys: string[] = [];

  // Match account addresses (0x followed by 40 hex chars)
  const addressRegex = /\((\d+)\)\s+(0x[a-fA-F0-9]{40})\s+\(/g;
  let match: RegExpExecArray | null;
  while ((match = addressRegex.exec(output)) !== null) {
    if (match[2]) {
      accounts.push(match[2]);
    }
  }

  // Match private keys (0x followed by 64 hex chars)
  const keyRegex = /\((\d+)\)\s+(0x[a-fA-F0-9]{64})/g;
  while ((match = keyRegex.exec(output)) !== null) {
    if (match[2]) {
      privateKeys.push(match[2]);
    }
  }

  return { accounts, privateKeys };
}

/**
 * Derive a private key from a mnemonic at a specific index using BIP-44 path
 * Path: m/44'/60'/0'/0/{index}
 */
function derivePrivateKey(mnemonic: string, index: number): `0x${string}` {
  const seed = mnemonicToSeedSync(mnemonic);
  const hdKey = HDKey.fromMasterSeed(seed);
  const derived = hdKey.derive(`m/44'/60'/0'/0/${index}`);
  if (!derived.privateKey) {
    throw new Error(`Failed to derive private key at index ${index}`);
  }
  const hexKey = Buffer.from(derived.privateKey).toString('hex');
  return `0x${hexKey}` as `0x${string}`;
}

/**
 * Get default Anvil accounts (derived from default mnemonic)
 * Uses proper HD key derivation for any number of accounts
 */
function getDefaultAccounts(count: number): { accounts: string[]; privateKeys: string[] } {
  const accounts: string[] = [];
  const privateKeys: string[] = [];

  // Derive all accounts from the default Anvil mnemonic using proper HD derivation
  for (let i = 0; i < count; i++) {
    try {
      // Get the address using viem's mnemonic account
      const account = mnemonicToAccount(DEFAULT_ANVIL_MNEMONIC, {
        addressIndex: i,
      });
      accounts.push(account.address);

      // Derive the private key using HD key derivation
      const privateKey = derivePrivateKey(DEFAULT_ANVIL_MNEMONIC, i);
      privateKeys.push(privateKey);
    } catch (error) {
      console.warn(`Failed to derive account at index ${i}:`, error);
      break;
    }
  }

  return {
    accounts,
    privateKeys,
  };
}

/**
 * Spawn an Anvil instance
 * @param config - Anvil configuration options
 * @returns A running Anvil instance with accounts and RPC client
 */
export async function spawnAnvil(config: AnvilConfig = {}): Promise<AnvilInstance> {
  const port = config.port ?? DEFAULT_ANVIL_CONFIG.port;
  const chainId = config.chainId ?? DEFAULT_ANVIL_CONFIG.chainId;
  const accountCount = config.accounts ?? DEFAULT_ANVIL_CONFIG.accounts;
  const balance = config.balance ?? DEFAULT_ANVIL_CONFIG.balance;

  // Build command arguments
  const args: string[] = [
    '--port',
    port.toString(),
    '--chain-id',
    chainId.toString(),
    '--accounts',
    accountCount.toString(),
    '--balance',
    (balance / 10n ** 18n).toString(), // Anvil expects ETH, not wei
  ];

  if (config.blockTime !== undefined && config.blockTime > 0) {
    args.push('--block-time', config.blockTime.toString());
  }

  if (config.forkUrl) {
    args.push('--fork-url', config.forkUrl);
    if (config.forkBlockNumber !== undefined) {
      args.push('--fork-block-number', config.forkBlockNumber.toString());
    }
  }

  if (config.mnemonic) {
    args.push('--mnemonic', config.mnemonic);
  }

  if (config.autoImpersonate) {
    args.push('--auto-impersonate');
  }

  if (config.baseFee !== undefined) {
    args.push('--base-fee', config.baseFee.toString());
  }

  if (config.gasLimit !== undefined) {
    args.push('--gas-limit', config.gasLimit.toString());
  }

  if (config.gasPrice !== undefined) {
    args.push('--gas-price', config.gasPrice.toString());
  }

  if (config.codeSizeLimit !== undefined) {
    args.push('--code-size-limit', config.codeSizeLimit.toString());
  }

  if (config.timestamp !== undefined) {
    args.push('--timestamp', Math.floor(config.timestamp).toString());
  }

  const url = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}`;

  // Spawn Anvil process
  const anvilProcess = spawn('anvil', args, {
    stdio: config.silent ? 'ignore' : 'pipe',
    detached: false,
  });

  let outputBuffer = '';

  // Capture output for account parsing (if not silent)
  if (!config.silent && anvilProcess.stdout) {
    anvilProcess.stdout.on('data', (data: Buffer) => {
      outputBuffer += data.toString();
    });
  }

  // Handle process errors
  anvilProcess.on('error', (error) => {
    throw new Error(`Failed to spawn Anvil: ${error.message}`);
  });

  // Wait for Anvil to be ready
  await waitForAnvil(url);

  // Give stdout time to flush all account output (race condition fix)
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Parse accounts from output or use defaults
  let accounts: string[] = [];
  let privateKeys: string[] = [];

  if (outputBuffer) {
    const parsed = parseAnvilOutput(outputBuffer);
    accounts = parsed.accounts;
    privateKeys = parsed.privateKeys;
  }

  // Fall back to default accounts if parsing failed or incomplete
  if (accounts.length === 0 || accounts.length < accountCount) {
    if (accounts.length > 0 && accounts.length < accountCount) {
      // Partial parse - log warning
      console.warn(
        `Parsed ${accounts.length} accounts but requested ${accountCount}, using hardcoded defaults`
      );
    }
    const defaults = getDefaultAccounts(accountCount);
    accounts = defaults.accounts;
    privateKeys = defaults.privateKeys;
  }

  // Create viem client
  const client = createPublicClient({
    transport: http(url),
  });

  return {
    process: anvilProcess,
    url,
    wsUrl,
    chainId,
    port,
    accounts: accounts!,
    privateKeys: privateKeys!,
    running: true,
    client,
  };
}

/**
 * Stop an Anvil instance
 * @param instance - The Anvil instance to stop
 */
export async function stopAnvil(instance: AnvilInstance): Promise<void> {
  if (!instance.running || !instance.process) {
    return;
  }

  const process = instance.process;
  if (!process) {
    instance.running = false;
    instance.client = null;
    return;
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      // Force kill if graceful shutdown takes too long
      process.kill('SIGKILL');
      instance.running = false;
      instance.client = null;
      resolve();
    }, 5000);

    process.on('exit', () => {
      clearTimeout(timeout);
      instance.running = false;
      instance.client = null;
      resolve();
    });

    process.on('error', (error) => {
      clearTimeout(timeout);
      instance.running = false;
      instance.client = null;
      reject(error);
    });

    // Send SIGTERM for graceful shutdown
    process.kill('SIGTERM');
  });
}

/**
 * Make a JSON-RPC call to Anvil
 */
async function rpcCall<T>(url: string, method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
      id: Date.now(),
    }),
  });

  if (!response.ok) {
    throw new Error(`RPC call failed: ${response.statusText}`);
  }

  const data = (await response.json()) as { result?: T; error?: { message: string } };

  if (data.error) {
    throw new Error(`RPC error: ${data.error.message}`);
  }

  return data.result as T;
}

/**
 * Anvil RPC helper methods
 */
export const anvilRpc = {
  /**
   * Increase EVM time by the specified number of seconds
   */
  async increaseTime(url: string, seconds: number): Promise<void> {
    await rpcCall(url, 'evm_increaseTime', [seconds]);
  },

  /**
   * Mine one or more blocks
   */
  async mine(url: string, blocks = 1): Promise<void> {
    if (blocks === 1) {
      await rpcCall(url, 'evm_mine', []);
    } else {
      // Mine multiple blocks
      for (let i = 0; i < blocks; i++) {
        await rpcCall(url, 'evm_mine', []);
      }
    }
  },

  /**
   * Mine a block with a specific timestamp
   */
  async mineAt(url: string, timestamp: number): Promise<void> {
    await rpcCall(url, 'evm_mine', [timestamp]);
  },

  /**
   * Take a state snapshot and return the snapshot ID
   */
  async snapshot(url: string): Promise<string> {
    return rpcCall<string>(url, 'evm_snapshot', []);
  },

  /**
   * Revert to a previous snapshot
   */
  async revert(url: string, snapshotId: string): Promise<void> {
    const success = await rpcCall<boolean>(url, 'evm_revert', [snapshotId]);
    if (!success) {
      throw new Error(`Failed to revert to snapshot ${snapshotId}`);
    }
  },

  /**
   * Set the balance of an account
   */
  async setBalance(url: string, address: string, balance: bigint): Promise<void> {
    const hexBalance = `0x${balance.toString(16)}`;
    await rpcCall(url, 'anvil_setBalance', [address, hexBalance]);
  },

  /**
   * Set the code at an address
   */
  async setCode(url: string, address: string, code: string): Promise<void> {
    await rpcCall(url, 'anvil_setCode', [address, code]);
  },

  /**
   * Set the nonce of an account
   */
  async setNonce(url: string, address: string, nonce: number): Promise<void> {
    const hexNonce = `0x${nonce.toString(16)}`;
    await rpcCall(url, 'anvil_setNonce', [address, hexNonce]);
  },

  /**
   * Set a storage slot value
   */
  async setStorageAt(url: string, address: string, slot: string, value: string): Promise<void> {
    await rpcCall(url, 'anvil_setStorageAt', [address, slot, value]);
  },

  /**
   * Impersonate an account (allows sending transactions from any address)
   */
  async impersonateAccount(url: string, address: string): Promise<void> {
    await rpcCall(url, 'anvil_impersonateAccount', [address]);
  },

  /**
   * Stop impersonating an account
   */
  async stopImpersonatingAccount(url: string, address: string): Promise<void> {
    await rpcCall(url, 'anvil_stopImpersonatingAccount', [address]);
  },

  /**
   * Enable or disable auto-mining
   */
  async setAutomine(url: string, enabled: boolean): Promise<void> {
    await rpcCall(url, 'evm_setAutomine', [enabled]);
  },

  /**
   * Set the mining interval (0 = instant mining)
   */
  async setIntervalMining(url: string, intervalMs: number): Promise<void> {
    await rpcCall(url, 'evm_setIntervalMining', [intervalMs]);
  },

  /**
   * Get the current block number
   */
  async getBlockNumber(url: string): Promise<bigint> {
    const hex = await rpcCall<string>(url, 'eth_blockNumber', []);
    return BigInt(hex);
  },

  /**
   * Get the current block timestamp
   */
  async getBlockTimestamp(url: string): Promise<number> {
    const blockNumber = await rpcCall<string>(url, 'eth_blockNumber', []);
    const block = await rpcCall<{ timestamp: string }>(url, 'eth_getBlockByNumber', [
      blockNumber,
      false,
    ]);
    return Number.parseInt(block.timestamp, 16);
  },

  /**
   * Set the next block's base fee
   */
  async setNextBlockBaseFee(url: string, baseFee: bigint): Promise<void> {
    const hexBaseFee = `0x${baseFee.toString(16)}`;
    await rpcCall(url, 'anvil_setNextBlockBaseFeePerGas', [hexBaseFee]);
  },

  /**
   * Drop a pending transaction from the mempool
   */
  async dropTransaction(url: string, txHash: string): Promise<void> {
    await rpcCall(url, 'anvil_dropTransaction', [txHash]);
  },

  /**
   * Reset the fork to a specific block or remove the fork
   */
  async reset(
    url: string,
    options?: { forkUrl?: string; forkBlockNumber?: number }
  ): Promise<void> {
    if (options) {
      await rpcCall(url, 'anvil_reset', [
        {
          forking: {
            jsonRpcUrl: options.forkUrl,
            blockNumber: options.forkBlockNumber,
          },
        },
      ]);
    } else {
      await rpcCall(url, 'anvil_reset', []);
    }
  },

  /**
   * Deal ERC20 tokens to an address (if supported by the token)
   */
  async deal(url: string, tokenAddress: string, toAddress: string, amount: bigint): Promise<void> {
    // This uses storage manipulation to set balance
    // Standard ERC20 balanceOf slot calculation
    const slot = await calculateBalanceSlot(toAddress);
    const hexAmount = `0x${amount.toString(16).padStart(64, '0')}`;
    await rpcCall(url, 'anvil_setStorageAt', [tokenAddress, slot, hexAmount]);
  },
};

/**
 * Calculate the storage slot for an ERC20 balance mapping
 * This assumes a standard mapping(address => uint256) at slot 0
 */
function calculateBalanceSlot(address: string): string {
  // For a mapping at slot N, the value for key K is at keccak256(K . N)
  // where . is concatenation and values are padded to 32 bytes
  const paddedAddress = address.toLowerCase().replace('0x', '').padStart(64, '0');
  const paddedSlot = '0'.padStart(64, '0');

  // In practice, this varies by contract implementation
  // Most ERC20s use slot 0 for balances, but some use different slots
  // For accurate manipulation, you'd need to know the contract's storage layout
  return `0x${paddedAddress}${paddedSlot}`;
}

/**
 * Create an Anvil instance configuration for testing
 * @param overrides - Optional configuration overrides
 * @returns A test-friendly Anvil configuration
 */
export function createTestAnvilConfig(overrides?: Partial<AnvilConfig>): AnvilConfig {
  return {
    port: 8546, // Use different port to avoid conflicts
    chainId: 31337,
    accounts: 10,
    balance: 10000n * 10n ** 18n,
    silent: true, // Silent for tests
    autoImpersonate: true, // Convenient for tests
    ...overrides,
  };
}

/**
 * Higher-level utility: Advance time and mine a block in one call
 * @param url - The Anvil RPC URL
 * @param seconds - Number of seconds to advance
 */
export async function advanceTime(url: string, seconds: number): Promise<void> {
  await anvilRpc.increaseTime(url, seconds);
  await anvilRpc.mine(url);
}

/**
 * Higher-level utility: Advance to a specific timestamp
 * @param url - The Anvil RPC URL
 * @param timestamp - Target Unix timestamp
 * @throws Error if timestamp is not in the future
 */
export async function advanceToTimestamp(url: string, timestamp: number): Promise<void> {
  const currentTimestamp = await anvilRpc.getBlockTimestamp(url);
  if (timestamp <= currentTimestamp) {
    throw new Error(
      `Target timestamp ${timestamp} is not in the future (current: ${currentTimestamp})`
    );
  }
  await anvilRpc.increaseTime(url, timestamp - currentTimestamp);
  await anvilRpc.mine(url);
}

/**
 * Higher-level utility: Fund multiple accounts with ETH
 * @param url - The Anvil RPC URL
 * @param accounts - Array of addresses to fund
 * @param amount - Amount in wei to give each account
 */
export async function fundAccounts(url: string, accounts: string[], amount: bigint): Promise<void> {
  await Promise.all(accounts.map((account) => anvilRpc.setBalance(url, account, amount)));
}
