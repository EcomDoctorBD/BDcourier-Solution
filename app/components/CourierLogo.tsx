import React, { useState } from "react";

export interface CourierLogoProps {
  courier: "pathao" | "steadfast" | "redx" | "carrybee" | "bahok" | string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export const COURIER_LOGO_PATHS = {
  pathao: "/logos/pathao.png",
  steadfast: "/logos/steadfast.png",
  redx: "/logos/redx.png",
  carrybee: "/logos/carrybee.png",
  bahok: "/logos/bahok.png",
} as const;

export function CourierLogo({
  courier,
  size = 44,
  className,
  style,
}: CourierLogoProps) {
  const [imgError, setImgError] = useState(false);

  const normalizedCourier = (courier || "").toLowerCase().trim();

  const configMap: Record<
    string,
    { name: string; src: string; bgColor: string; padding: string }
  > = {
    pathao: {
      name: "Pathao Courier",
      src: COURIER_LOGO_PATHS.pathao,
      bgColor: "#FFFFFF",
      padding: "2px",
    },
    steadfast: {
      name: "Steadfast Courier",
      src: COURIER_LOGO_PATHS.steadfast,
      bgColor: "#E8FCE8",
      padding: "0px",
    },
    redx: {
      name: "REDX Delivery",
      src: COURIER_LOGO_PATHS.redx,
      bgColor: "#FFFFFF",
      padding: "5px",
    },
    carrybee: {
      name: "CarryBee",
      src: COURIER_LOGO_PATHS.carrybee,
      bgColor: "#000000",
      padding: "0px",
    },
    bahok: {
      name: "Bahok Courier",
      src: COURIER_LOGO_PATHS.bahok,
      bgColor: "#FFFFFF",
      padding: "0px",
    },
  };

  const config = configMap[normalizedCourier] || {
    name: "Courier Partner",
    src: COURIER_LOGO_PATHS.steadfast,
    bgColor: "#FFFFFF",
    padding: "2px",
  };

  const isCover =
    normalizedCourier === "steadfast" ||
    normalizedCourier === "carrybee" ||
    normalizedCourier === "bahok";

  return (
    <div
      className={className}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        minWidth: `${size}px`,
        minHeight: `${size}px`,
        maxWidth: `${size}px`,
        maxHeight: `${size}px`,
        borderRadius: "10px",
        overflow: "hidden",
        flexShrink: 0,
        border: "1px solid #e2e8f0",
        backgroundColor: config.bgColor,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        padding: config.padding,
        boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
        ...style,
      }}
    >
      {!imgError ? (
        <img
          src={config.src}
          alt={config.name}
          width={size}
          height={size}
          loading="eager"
          decoding="sync"
          fetchPriority="high"
          onError={() => setImgError(true)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: isCover ? "cover" : "contain",
            display: "block",
          }}
        />
      ) : normalizedCourier === "pathao" ? (
        <svg viewBox="0 0 100 100" width="100%" height="100%">
          <circle cx="50" cy="50" r="45" fill="#E82A2A" />
          <path
            d="M38 72V30c0-2 2-4 4-4h18a16 16 0 1 1 0 32H48v14a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2zm10-24h12a8 8 0 1 0 0-16H48v16z"
            fill="#FFFFFF"
          />
        </svg>
      ) : normalizedCourier === "steadfast" ? (
        <svg viewBox="0 0 100 100" width="100%" height="100%">
          <rect width="100" height="100" rx="8" fill="#E8FCE8" />
          <path d="M50 18 L76 34 L52 50 Z" fill="#1E293B" />
          <path d="M46 22 L24 44 C24 64 42 76 66 76 L50 56 Z" fill="#00B14F" />
          <path d="M22 68 L16 82 L30 76 Z" fill="#00B14F" />
        </svg>
      ) : normalizedCourier === "carrybee" ? (
        <svg viewBox="0 0 100 100" width="100%" height="100%">
          <rect width="100" height="100" fill="#000000" />
          <circle cx="50" cy="50" r="32" fill="#F5B400" />
          <text
            x="50"
            y="58"
            fontFamily="Arial, sans-serif"
            fontWeight="900"
            fontSize="22"
            fill="#000000"
            textAnchor="middle"
          >
            CB
          </text>
        </svg>
      ) : normalizedCourier === "bahok" ? (
        <svg viewBox="0 0 100 100" width="100%" height="100%">
          <rect width="100" height="100" fill="#FFFFFF" />
          <circle cx="50" cy="50" r="36" fill="#D8232A" />
          <text
            x="50"
            y="57"
            fontFamily="Arial, sans-serif"
            fontWeight="900"
            fontSize="18"
            fill="#FFFFFF"
            textAnchor="middle"
          >
            বাহক
          </text>
        </svg>
      ) : (
        <svg viewBox="0 0 120 40" width="100%" height="100%">
          <text
            x="5"
            y="28"
            fontFamily="Arial, Helvetica, sans-serif"
            fontWeight="900"
            fontSize="26"
            fill="#111827"
          >
            RED
          </text>
          <path
            d="M72 10 L84 22 L72 34 L80 34 L88 25 L96 34 L104 34 L92 22 L104 10 L96 10 L88 19 L80 10 Z"
            fill="#ED1C24"
          />
        </svg>
      )}
    </div>
  );
}

export default CourierLogo;
