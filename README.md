# Megapump Serverless

A Next.js serverless application for Solana token lottery system with random winner selection and prize distribution.

## Overview

This application provides:
- **Random Winner Selection**: Uses Orao VRF (Verifiable Random Function) for provably fair randomness
- **Token Holder Lottery**: Automatically selects winners from token holders every 10 minutes
- **Prize Distribution**: Sends SOL rewards to winners via Solana blockchain
- **Statistics API**: Tracks recent winners and lottery cycles
- **Database Integration**: Uses Supabase for storing winner history

## Setup Instructions

### 1. Environment Variables

Create a `.env` file in the root directory with the following variables:

```bash
# Helius RPC (for Solana blockchain access)
HELIUS_API_KEY=your_helius_api_key

# Wallet Configuration (base58 encoded secret key)
WALLET_SECRET=your_wallet_secret_key

# Token Configuration
TOKEN_MINT=your_token_mint_address
DEV_WALLET=developer_wallet_address
JACKPOT_ADDRESS=jackpot_wallet_address

# Supabase Database
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key

# Cron Job Security (for Vercel cron authentication)
CRON_SECRET=your_secure_random_string
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Run Development Server

### 3. Run Development Server

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## API Endpoints

### `/api/stats`
Returns lottery statistics and recent winners with VRF data:
```json
{
  "success": true,
  "winners": [
    {
      "id": 1,
      "wallet": "7xKKtYXNFa...",
      "amount": 1000000,
      "signature": "5J7qF8pN...",
      "cycle_id": "2025-09-06T10:35:00.000Z",
      "distributed_at": "2025-09-06T10:35:42.123Z",
      "vrf_seed": "abc123...",
      "vrf_tx": "4K9mN2pL...",
      "vrf_randomness": "def456...",
      "vrf_random_value": 0.7234567,
      "randomness_source": "orao_vrf",
      "vrf_error": null,
      "jackpot_address": "9xLLtYXNFa...",
      "jackpot_amount": 5000000,
      "jackpot_signature": "6H8qF9pM..."
    }
  ],
  "serverTime": "2025-09-06T10:37:15.456Z",
  "currentCycle": "2025-09-06T10:35:00.000Z",
  "minutesInCycle": 2,
  "secondsUntilNext": 180,
  "millisecondsUntilNext": 180000
}
}
```

**VRF Data Fields Explanation:**
- `vrf_seed`: The seed used for VRF generation
- `vrf_tx`: Transaction signature of the VRF request
- `vrf_randomness`: Raw randomness bytes from VRF
- `vrf_random_value`: Normalized random value (0-1)
- `randomness_source`: Source of randomness (e.g., "orao_vrf")
- `vrf_error`: Error message if VRF failed (null if successful)
- `jackpot_address`: Address that received jackpot funds
- `jackpot_amount`: Amount sent to jackpot (in lamports)
- `jackpot_signature`: Transaction signature for jackpot transfer

### `/api/random`
Triggers random winner selection (manual testing):
```json
{
  "success": true,
  "winner": "wallet_address",
  "amount": 1000000,
  "signature": "transaction_signature"
}
```

## How It Works

1. **10-Minute Cycles**: The system operates on 10-minute lottery cycles
2. **Random Selection**: Uses Orao VRF for cryptographically secure randomness
3. **Token Holder Query**: Fetches current token holders from Helius API
4. **Winner Selection**: Randomly selects one holder as the winner
5. **Prize Distribution**: Sends SOL from the configured wallet to the winner
6. **Database Recording**: Stores winner information in Supabase database

## Required Services

- **Helius**: Solana RPC provider for blockchain access
- **Supabase**: Database for storing winner history
- **Orao VRF**: Verifiable random function for fair winner selection

## Development Notes

- Ensure your wallet has sufficient SOL for prize distribution
- Token holders are fetched in real-time for each lottery
- All transactions are recorded on Solana blockchain
- The system handles error cases gracefully (missing env vars, network issues)

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
