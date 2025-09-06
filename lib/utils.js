import { Connection, Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction, VersionedTransaction } from "@solana/web3.js";
import { createClient } from "@supabase/supabase-js";
import { Orao } from "@orao-network/solana-vrf";
import bs58 from "bs58";

// Environment variables
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const WALLET_SECRET = process.env.WALLET_SECRET;
const TOKEN_MINT = process.env.TOKEN_MINT || "";
const DEV_WALLET = process.env.DEV_WALLET;
const JACKPOT_ADDRESS = process.env.JACKPOT_ADDRESS;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Initialize connections
const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const connection = new Connection(RPC_URL, "confirmed");

// Initialize wallet with error handling
let WALLET = null;
if (WALLET_SECRET && typeof WALLET_SECRET === 'string' && WALLET_SECRET.trim() !== '') {
  try {
    WALLET = Keypair.fromSecretKey(bs58.decode(WALLET_SECRET));
  } catch (error) {
    console.error('Error creating wallet from secret:', error);
  }
}

// Initialize Supabase with error handling
let supabase = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (error) {
    console.error('Error creating Supabase client:', error);
  }
} else {
  console.warn('Supabase configuration missing - SUPABASE_URL or SUPABASE_ANON_KEY not set');
}

// Export configured instances
export { connection, WALLET, supabase, TOKEN_MINT, DEV_WALLET, JACKPOT_ADDRESS, HELIUS_API_KEY, WALLET_SECRET };

// Helper function to sleep
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper function to get server time info for 5-minute cycles
export function getServerTimeInfo() {
  const now = new Date();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  const milliseconds = now.getMilliseconds();

  // Calculate minutes elapsed in the current 5-minute cycle
  const minutesInCycle = minutes % 5;

  // Calculate total elapsed time in the current 5-minute cycle
  const totalElapsedMs = (minutesInCycle * 60 * 1000) + (seconds * 1000) + milliseconds;

  // Calculate milliseconds until the next 5-minute mark
  const millisecondsUntilNext = (5 * 60 * 1000) - totalElapsedMs;
  const secondsUntilNext = millisecondsUntilNext / 1000;

  // Get the timestamp of the next scheduled distribution (next 5-minute mark)
  const nextDistribution = new Date(now);
  nextDistribution.setSeconds(0, 0);
  const currentMinute = nextDistribution.getMinutes();
  const nextFiveMinuteMark = Math.ceil((currentMinute + 1) / 5) * 5;
  nextDistribution.setMinutes(nextFiveMinuteMark);

  // Get the timestamp of the last distribution (previous 5-minute mark)
  const lastDistribution = new Date(now);
  lastDistribution.setSeconds(0, 0);
  const lastFiveMinuteMark = Math.floor(currentMinute / 5) * 5;
  lastDistribution.setMinutes(lastFiveMinuteMark);

  return {
    serverTime: now.toISOString(),
    secondsUntilNext: Math.ceil(secondsUntilNext),
    nextDistributionTime: nextDistribution.toISOString(),
    lastDistributionTime: lastDistribution.toISOString(),
    currentCycle: Math.floor(now.getTime() / (5 * 60 * 1000)),
    tokenMintEmpty: !TOKEN_MINT || TOKEN_MINT.trim() === "",
    walletNotConfigured: !WALLET_SECRET || WALLET_SECRET.trim() === "",
    walletInitialized: !!WALLET
  };
}

// Database functions
export async function saveWinnerWithCycle(wallet, amount, signature, cycleId, vrfData = null, jackpotData = null) {
  const winnerRecord = {
    wallet: wallet || 'No winner (no fees)',
    amount,
    signature,
    cycle_id: cycleId,
    distributed_at: new Date().toISOString()
  };

  // Add VRF data if provided
  if (vrfData) {
    winnerRecord.vrf_seed = vrfData.seed;
    winnerRecord.vrf_tx = vrfData.tx;
    winnerRecord.vrf_randomness = vrfData.randomness;
    winnerRecord.vrf_random_value = vrfData.randomValue;
    winnerRecord.randomness_source = vrfData.source;

    // Add error information if VRF failed
    if (vrfData.error) {
      winnerRecord.vrf_error = vrfData.error;
    }
  }

  // Add jackpot data if provided
  if (jackpotData) {
    winnerRecord.jackpot_address = jackpotData.address;
    winnerRecord.jackpot_amount = jackpotData.amount;
    winnerRecord.jackpot_signature = jackpotData.signature;
  }

  const { data, error } = await supabase
    .from('winners')
    .insert([winnerRecord])
    .select();

  if (error) {
    console.error('Error saving winner:', error);
    throw error;
  }

  console.log(`Saved winner for cycle ${cycleId}:`, data[0]);
  return data[0];
}

export async function getRecentWinners(limit = 20) {
  const { data, error } = await supabase
    .from('winners')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error fetching winners:', error);
    throw error;
  }

  return data;
}

// PumpPortal fee collection
export async function claimFees() {
  try {
    if (!WALLET) {
      throw new Error("Wallet not initialized. Check WALLET_SECRET environment variable.");
    }

    console.log("Generating local transaction for fee collection...");
    
    // Generate transaction locally using trade-local endpoint
    const response = await fetch(`https://pumpportal.fun/api/trade-local`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        "publicKey": WALLET.publicKey.toBase58(),
        "action": "collectCreatorFee",
        "priorityFee": 0.000001,
      })
    });

    if (response.status === 200) {
      // Successfully generated transaction
      console.log("Transaction generated successfully, signing and sending...");
      
      const data = await response.arrayBuffer();
      const tx = VersionedTransaction.deserialize(new Uint8Array(data));
      
      // Sign the transaction
      tx.sign([WALLET]);
      
      // Send the transaction
      const signature = await connection.sendTransaction(tx);
      
      console.log("Fee collection transaction sent:", signature);
      console.log("Transaction: https://solscan.io/tx/" + signature);
      
      return {
        success: true,
        signature: signature,
        message: "Fee collection transaction sent successfully"
      };
    } else {
      // Error generating transaction
      const errorText = await response.text();
      console.error("Error generating transaction:", response.status, errorText);
      
      return {
        success: false,
        error: `Failed to generate transaction: ${response.status} ${errorText}`,
        statusCode: response.status
      };
    }
  } catch (error) {
    console.error("Error in claimFees:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Orao VRF functions
export async function getOraoRandomness() {
  try {
    if (!WALLET) {
      throw new Error("Wallet not initialized. Check WALLET_SECRET environment variable.");
    }

    // Create Orao VRF instance
    const vrf = new Orao(connection);

    // Request randomness
    console.log("Requesting randomness from Orao VRF...");
    const request = await vrf.request(WALLET.publicKey, WALLET);

    // Wait for initial processing
    await sleep(3000);

    // Submit the request with compute unit price multiplier
    const [seed, tx] = await request
      .withComputeUnitPriceMultiplier(1.25)
      .rpc();

    console.log(`VRF request submitted. Seed: ${seed}, TX: ${tx}`);

    // Wait for fulfillment
    await sleep(5000);

    // Wait for the randomness to be fulfilled
    const { randomness } = await vrf.waitFulfilled(seed, 'confirmed');

    console.log("Randomness received from Orao VRF:", Array.from(randomness));

    // Return structured VRF data
    return {
      seed: seed,
      tx: tx,
      randomness: Array.from(randomness), // Convert Uint8Array to regular array for JSON storage
      source: 'orao_vrf'
    };
  } catch (error) {
    console.error("Error getting Orao randomness:", error);
    // Instead of fallback, throw error to cancel the distribution
    throw new Error(`Orao VRF failed: ${error.message}. Distribution cancelled, will retry in next cycle.`);
  }
}

// Token holder functions
export async function getRandomHolder(mint) {
  // Use Solana RPC getProgramAccounts to get token holders
  const url = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'get-token-accounts',
      method: 'getProgramAccounts',
      params: [
        'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token Program ID
        {
          encoding: 'jsonParsed',
          filters: [
            {
              dataSize: 165 // Token account data size
            },
            {
              memcmp: {
                offset: 0,
                bytes: mint // Filter by mint address
              }
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch token accounts: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`RPC error: ${data.error.message}`);
  }

  const accounts = data.result || [];

  if (accounts.length === 0) {
    throw new Error("No token accounts found");
  }

  // Filter accounts with positive balance and exclude dev wallet
  let validAccounts = accounts
    .filter(account => {
      const tokenAmount = account?.account?.data?.parsed?.info?.tokenAmount;
      const balance = parseFloat(tokenAmount?.amount || '0');
      const owner = account?.account?.data?.parsed?.info?.owner;

      // Exclude accounts with zero balance or dev wallet
      return balance > 0 && owner !== DEV_WALLET;
    })
    .map(account => ({
      owner: account?.account?.data?.parsed?.info?.owner,
      balance: parseFloat(account?.account?.data?.parsed?.info?.tokenAmount?.amount || '0')
    }))
    .sort((a, b) => b.balance - a.balance); // Sort descending by balance

  if (validAccounts.length === 0) {
    throw new Error("No token holders with positive balance found (excluding dev wallet)");
  }

  // Remove the top holder (liquidity pool)
  validAccounts = validAccounts.slice(1);

  if (validAccounts.length === 0) {
    throw new Error("No eligible holders found (only liquidity pool and/or dev wallet detected)");
  }

  // Calculate total supply among eligible holders
  const totalSupply = validAccounts.reduce((sum, account) => sum + account.balance, 0);

  // Create weighted selection based on token holdings
  const weightedHolders = validAccounts.map(account => ({
    owner: account.owner,
    balance: account.balance,
    weight: account.balance / totalSupply,
    cumulativeWeight: 0
  }));

  // Calculate cumulative weights for selection
  let cumulativeWeight = 0;
  for (let i = 0; i < weightedHolders.length; i++) {
    cumulativeWeight += weightedHolders[i].weight;
    weightedHolders[i].cumulativeWeight = cumulativeWeight;
  }

  // Get randomness from Orao VRF instead of Math.random()
  console.log("Getting randomness from Orao VRF for holder selection...");
  const vrfData = await getOraoRandomness();

  // Convert the first 8 bytes of randomness to a number between 0 and 1
  let randomValue = 0;
  for (let i = 0; i < 8; i++) {
    randomValue += vrfData.randomness[i] * Math.pow(256, -i - 1);
  }

  console.log("VRF-generated random value:", randomValue);

  // Add the computed random value to VRF data
  vrfData.randomValue = randomValue;

  // Find the holder based on weighted random selection using VRF randomness
  const selectedHolder = weightedHolders.find(holder => randomValue <= holder.cumulativeWeight);

  if (!selectedHolder || !selectedHolder.owner) {
    throw new Error("Failed to select weighted random holder");
  }

  console.log(`Selected holder with ${selectedHolder.balance} tokens (${(selectedHolder.weight * 100).toFixed(2)}% of supply) using ${vrfData.source}`);

  return {
    holder: new PublicKey(selectedHolder.owner),
    vrfData: vrfData
  };
}

// SOL transfer functions
export async function sendSol(recipient, lamports) {
  if (!WALLET) {
    throw new Error("Wallet not initialized. Check WALLET_SECRET environment variable.");
  }

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: WALLET.publicKey,
      toPubkey: recipient,
      lamports,
    })
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [WALLET]);
  return sig;
}

export async function sendSolToMultipleRecipients(recipients) {
  if (!WALLET) {
    throw new Error("Wallet not initialized. Check WALLET_SECRET environment variable.");
  }

  const tx = new Transaction();
  
  // Add all transfers to the same transaction
  for (const { recipient, lamports } of recipients) {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: WALLET.publicKey,
        toPubkey: recipient,
        lamports,
      })
    );
  }

  const sig = await sendAndConfirmTransaction(connection, tx, [WALLET]);
  return sig;
}
