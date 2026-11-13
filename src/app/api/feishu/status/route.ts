import { NextResponse } from "next/server";
import { getFeishuConfiguration } from "@/lib/feishu-configuration";

export async function GET() {
  return NextResponse.json(getFeishuConfiguration(), { headers: { "Cache-Control": "no-store" } });
}
