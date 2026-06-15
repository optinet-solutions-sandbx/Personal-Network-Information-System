import { ImageResponse } from "next/og";

// Networky.ai Apple touch icon — larger, full-bleed indigo with white "N".
export const size = {
  width: 180,
  height: 180,
};
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 120,
          fontWeight: 700,
          color: "#ffffff",
          background: "#4f46e5", // indigo-600
        }}
      >
        N
      </div>
    ),
    {
      ...size,
    }
  );
}
