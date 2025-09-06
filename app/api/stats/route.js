import { NextResponse } from "next/server";
import { getRecentWinners, getServerTimeInfo, TOKEN_MINT, WALLET_SECRET } from "@/lib/utils";

export async function GET() {
  try {
    const timeInfo = getServerTimeInfo();
    
    // Check if TOKEN_MINT is empty
    if (!TOKEN_MINT || TOKEN_MINT.trim() === "" || !WALLET_SECRET || WALLET_SECRET.trim() === "") {
      return NextResponse.json({
        success: false,
        error: "TOKEN_MINT or WALLET_SECRET not configured. Please check your environment variables.",
        tokenMintEmpty: !TOKEN_MINT || TOKEN_MINT.trim() === "",
        walletNotConfigured: !WALLET_SECRET || WALLET_SECRET.trim() === "",
        winners: [],
        ...timeInfo
      });
    }

    const winners = await getRecentWinners(20);
    return NextResponse.json({
      success: true,
      winners,
      ...getServerTimeInfo()
    });
  } catch (e) {
    console.error("Error fetching winners:", e);
    return NextResponse.json(
      { success: false, error: e.message, ...getServerTimeInfo() },
      { status: 500 }
    );
  }
}
