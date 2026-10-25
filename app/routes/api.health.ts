import { json, type LoaderFunctionArgs } from "@remix-run/node";
import mongoose from "mongoose";
import { connectDB } from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  let dbStatus = "warm";
  try {
    if (mongoose.connection.readyState !== 1) {
      await connectDB();
    }
    dbStatus = mongoose.connection.readyState === 1 ? "warm" : "connecting";
  } catch (error: any) {
    console.error("Health check DB warm-up error:", error?.message || error);
    dbStatus = "error";
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
      timestamp: Date.now(),
    },
    {
      status: 200,
      headers: responseHeaders,
    }
  );
};
