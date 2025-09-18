import { NextRequest, NextResponse } from "next/server";
import { getCryptoValidationService } from "@/app/lib/cryptoValidation";
import {
  validateOrigin,
  createAuthenticatedResponse,
} from "@/app/lib/auth";

export async function POST(request: NextRequest) {
  try {
    // Origin validation
    if (!validateOrigin(request)) {
      return createAuthenticatedResponse(
        { error: "Forbidden: Invalid origin" },
        403
      );
    }

    // Parse request body
    const requestBody = await request.json();
    const { playerAddress } = requestBody;

    // Basic validation
    if (!playerAddress || !playerAddress.startsWith('0x')) {
      return createAuthenticatedResponse(
        { 
          success: false,
          error: "Invalid player address format" 
        },
        400
      );
    }

    // Generate challenge using crypto service
    const cryptoService = getCryptoValidationService();
    const challengeResponse = cryptoService.generateNonceChallenge(playerAddress);

    if (!challengeResponse.success) {
      return createAuthenticatedResponse(
        {
          success: false,
          error: challengeResponse.error || "Failed to generate challenge"
        },
        500
      );
    }

    return createAuthenticatedResponse({
      success: true,
      challenge: challengeResponse.challenge,
      expiresAt: challengeResponse.expiresAt
    });

  } catch (error) {
    console.error("Error in get-secure-nonce:", error);
    return createAuthenticatedResponse(
      { 
        success: false,
        error: "Internal server error" 
      },
      500
    );
  }
}

export async function OPTIONS() {
  return createAuthenticatedResponse({}, 200);
}