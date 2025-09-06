import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { 
  connection, 
  WALLET, 
  supabase, 
  TOKEN_MINT, 
  JACKPOT_ADDRESS,
  WALLET_SECRET,
  getServerTimeInfo,
  saveWinnerWithCycle,
  getRecentWinners,
  claimFees,
  getRandomHolder,
  sendSol,
  sendSolToMultipleRecipients
} from "@/lib/utils";

export async function GET(request) {
  try {
    // Verify CRON_SECRET for security
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({
        success: false,
        error: 'Unauthorized'
      }, { status: 401 });
    }

    const timeInfo = getServerTimeInfo();
    
    // Check if TOKEN_MINT is empty or wallet not configured
    if (!TOKEN_MINT || TOKEN_MINT.trim() === "" || !WALLET_SECRET || WALLET_SECRET.trim() === "" || !WALLET) {
      return NextResponse.json({
        success: false,
        error: "TOKEN_MINT, WALLET_SECRET not configured or wallet initialization failed",
        tokenMintEmpty: !TOKEN_MINT || TOKEN_MINT.trim() === "",
        walletNotConfigured: !WALLET_SECRET || WALLET_SECRET.trim() === "",
        walletInitialized: !!WALLET,
        winners: [],
        ...timeInfo
      });
    }

    console.log(`[CRON] ${timeInfo.serverTime} - Starting distribution check for cycle ${timeInfo.currentCycle}`);

    // Check if we already distributed in this exact 5-minute cycle
    const { data: existingDistribution, error: queryError } = await supabase
      .from('winners')
      .select('*')
      .eq('cycle_id', timeInfo.currentCycle)
      .limit(1);

    if (queryError) {
      console.error('Error checking existing distribution:', queryError);
    }

    if (existingDistribution && existingDistribution.length > 0) {
      console.log(`Distribution already completed for cycle ${timeInfo.currentCycle}`);
      return NextResponse.json({
        success: false,
        error: `Distribution already completed for cycle ${timeInfo.currentCycle}`,
        existingDistribution: existingDistribution[0],
        winners: await getRecentWinners(20),
        ...timeInfo
      });
    }

    console.log(`Starting distribution for cycle ${timeInfo.currentCycle} at ${timeInfo.serverTime}`);

    // Get wallet balance before claiming fees
    const balanceBefore = await connection.getBalance(WALLET.publicKey);

    const claimResult = await claimFees();
    await new Promise((r) => setTimeout(r, 10_000));

    // Get wallet balance after claiming fees
    const balanceAfter = await connection.getBalance(WALLET.publicKey);

    // Calculate the amount of SOL claimed from fees
    const claimedAmount = balanceAfter - balanceBefore;

    console.log(`Cycle ${timeInfo.currentCycle} - Balance before: ${balanceBefore / 1e9} SOL`);
    console.log(`Cycle ${timeInfo.currentCycle} - Balance after: ${balanceAfter / 1e9} SOL`);
    console.log(`Cycle ${timeInfo.currentCycle} - Claimed from fees: ${claimedAmount / 1e9} SOL`);

    let recipient = null;
    let sig = null;
    let sendAmount = 0;
    let vrfData = null;
    let jackpotData = null;

    // Only send if we actually claimed some fees (and it's a meaningful amount)
    if (claimedAmount > 5000000) { // Only distribute if claimed amount > 0.005 SOL
      sendAmount = claimedAmount - 5000000; // Keep 0.005 SOL for transaction fee

      if (sendAmount > 0) {
        try {
          const holderSelection = await getRandomHolder(TOKEN_MINT);
          recipient = holderSelection.holder;
          vrfData = holderSelection.vrfData;

          // Check if JACKPOT_ADDRESS is configured
          if (!JACKPOT_ADDRESS || JACKPOT_ADDRESS.trim() === "") {
            console.warn("JACKPOT_ADDRESS not configured, sending 100% to winner");
            // Send all to winner if jackpot not configured
            sig = await sendSol(recipient, sendAmount);
            console.log(`Cycle ${timeInfo.currentCycle} - Sent ${sendAmount / 1e9} SOL to ${recipient.toBase58()} (100% - no jackpot)`);
          } else {
            // Split rewards: 90% to winner, 10% to jackpot
            const winnerAmount = Math.floor(sendAmount * 0.9);
            const jackpotAmount = sendAmount - winnerAmount;
            
            const jackpotPublicKey = new PublicKey(JACKPOT_ADDRESS);
            
            // Send to both recipients in a single transaction
            sig = await sendSolToMultipleRecipients([
              { recipient: recipient, lamports: winnerAmount },
              { recipient: jackpotPublicKey, lamports: jackpotAmount }
            ]);
            
            // Store jackpot data
            jackpotData = {
              address: JACKPOT_ADDRESS,
              amount: jackpotAmount / 1e9, // in SOL
              signature: sig
            };
            
            console.log(`Cycle ${timeInfo.currentCycle} - Sent ${winnerAmount / 1e9} SOL to winner ${recipient.toBase58()} (90%)`);
            console.log(`Cycle ${timeInfo.currentCycle} - Sent ${jackpotAmount / 1e9} SOL to jackpot ${JACKPOT_ADDRESS} (10%)`);
            
            // Update sendAmount to reflect winner's portion for database
            sendAmount = winnerAmount;
          }
        } catch (vrfError) {
          // If VRF fails, cancel distribution and save failure record
          console.error(`Cycle ${timeInfo.currentCycle} - VRF failed, cancelling distribution:`, vrfError.message);

          // Save failed attempt record
          const failedAttempt = await saveWinnerWithCycle(
            null, // No winner
            0, // No amount distributed
            null, // No transaction
            timeInfo.currentCycle,
            {
              seed: null,
              tx: null,
              randomness: null,
              randomValue: null,
              source: 'vrf_failed',
              error: vrfError.message
            }
          );

          return NextResponse.json({
            success: false,
            error: "VRF randomness failed - distribution cancelled for this cycle",
            vrfError: vrfError.message,
            cycleId: timeInfo.currentCycle,
            claimResult,
            balanceBefore: balanceBefore / 1e9,
            balanceAfter: balanceAfter / 1e9,
            claimedFromFees: claimedAmount / 1e9,
            forwardedSOL: 0,
            message: "Fees collected but not distributed due to VRF failure. Will retry in next cycle.",
            failedAttempt,
            winners: await getRecentWinners(20),
            ...timeInfo
          });
        }
      }
    } else {
      console.log(`Cycle ${timeInfo.currentCycle} - No meaningful fees to distribute (${claimedAmount / 1e9} SOL)`);
    }

    // Save winner to database with cycle ID, VRF data, and jackpot data
    const winner = await saveWinnerWithCycle(
      recipient ? recipient.toBase58() : null,
      sendAmount / 1e9, // in SOL (winner's portion)
      sig,
      timeInfo.currentCycle,
      vrfData,
      jackpotData
    );

    // Get recent winners for response
    const winners = await getRecentWinners(20);

    return NextResponse.json({
      success: true,
      cycleId: timeInfo.currentCycle,
      claimResult,
      recipient: recipient ? recipient.toBase58() : null,
      balanceBefore: balanceBefore / 1e9,
      balanceAfter: balanceAfter / 1e9,
      claimedFromFees: claimedAmount / 1e9,
      forwardedLamports: sendAmount,
      forwardedSOL: sendAmount / 1e9,
      txSignature: sig,
      jackpot: jackpotData ? {
        address: jackpotData.address,
        amount: jackpotData.amount,
        signature: jackpotData.signature
      } : null,
      vrfData: vrfData ? {
        seed: vrfData.seed,
        vrfTx: vrfData.tx,
        randomValue: vrfData.randomValue,
        randomnessSource: vrfData.source
      } : null,
      winner,
      winners,
      ...timeInfo
    });
  } catch (e) {
    console.error(`Error in GET handler for cycle ${getServerTimeInfo().currentCycle}:`, e);
    return NextResponse.json(
      { success: false, error: e.message, ...getServerTimeInfo() },
      { status: 500 }
    );
  }
}
