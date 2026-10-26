import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { put } from "@vercel/blob";
import { rateLimit } from "@/lib/rate-limit";
import { sniffImageType, type SniffedImageType } from "@/lib/image-sniff";

const MAX_SIZE = 5 * 1024 * 1024;

const mimeToExt: Record<SniffedImageType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = await rateLimit(userId, "upload");
    if (!rl.success) return rl.response;

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file size (max 5MB) BEFORE buffering
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "File too large. Max size is 5MB." },
        { status: 400 }
      );
    }

    // Validate file type by CONTENT, not the caller-controlled MIME type:
    // the multipart file.type is attacker-controlled metadata, and previously
    // any body whose headers claimed image/* was stored verbatim on our blob
    // origin. Sniff the leading magic bytes and allow only real images.
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length === 0) {
      return NextResponse.json({ error: "Empty file" }, { status: 400 });
    }
    const sniffed = sniffImageType(bytes);
    if (!sniffed) {
      return NextResponse.json(
        { error: "Invalid file type. Only images are allowed." },
        { status: 400 }
      );
    }

    // Store the re-validated content; filename is derived server-side from the
    // SNIFFED type — never from the user's filename or claimed MIME.
    const extension = mimeToExt[sniffed];
    const timestamp = Date.now();
    const filename = `${userId}/${timestamp}.${extension}`;

    const blob = await put(filename, file, {
      access: "public",
      addRandomSuffix: true,
      contentType: sniffed,
    });

    return NextResponse.json({ url: blob.url });
  } catch (error) {
    const kind = error instanceof Error ? error.name : "unknown";
    console.error("Error uploading file:", kind);
    return NextResponse.json({ error: "Failed to upload file" }, { status: 500 });
  }
}