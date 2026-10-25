import { json, type LoaderFunctionArgs } from "@remix-run/node";
import mongoose from "mongoose";
import { connectDB } from "../db.server";

// 30-Second DB keep-alive cooldown & rate shield (Issue 11.2 & Extra Trap #4)
let lastDbWarmupTs = 0;
const DB_WARMUP_COOLDOWN_MS = 30_000;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  let dbStatus = "warm";
  const now = Date.now();

  // Only hit MongoDB if 30 seconds have elapsed since last check
  if (now - lastDbWarmupTs > DB_WARMUP_COOLDOWN_MS) {
    try {
      if (mongoose.connection.readyState !== 1) {
        await connectDB();
      }
      dbStatus = mongoose.connection.readyState === 1 ? "warm" : "connecting";
      lastDbWarmupTs = now;
    } catch (error: any) {
      console.error("Health check DB warm-up error:", error?.message || error);
      dbStatus = "error";
    }
  } else {
    // Within 30s cooldown: report warm from cached connection state without touching DB pool
    dbStatus = mongoose.connection.readyState === 1 ? "warm (cached)" : "standby";
  }

  const responseHeaders = {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };

  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...responseHeaders,
      },
    });
  }

  return json(
    {
      status: "ok",
      db: dbStatus,
      region: process.env.VERCEL_REGION || "sin1",
      timestamp: now,
    },
    {
      status: 200,
      headers: responseHeaders,
    }
  );
};
