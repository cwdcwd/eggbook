import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { generateBeamsToken } from "@/lib/beams-server";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Validate the user_id query param matches the authenticated user
  const requestedUserId = req.nextUrl.searchParams.get("user_id");
  if (requestedUserId && requestedUserId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const beamsToken = generateBeamsToken(userId);
  if ("error" in beamsToken) {
    const status = beamsToken.code === "NOT_CONFIGURED" ? 503 : 500;
    return NextResponse.json(
      { error: beamsToken.error },
      { status }
    );
  }

  return NextResponse.json(beamsToken, {
    headers: { "Cache-Control": "no-store" },
  });
}
