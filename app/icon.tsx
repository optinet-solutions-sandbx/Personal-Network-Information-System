import { ImageResponse } from "next/og";

// Networky.ai favicon — indigo rounded square with a white "N",
// matching the brand mark in app/layout.tsx.
export const size = {
  width: 32,
  height: 32,
};
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 22,
          fontWeight: 700,
          color: "#ffffff",
          background: "#4f46e5", // indigo-600
          borderRadius: 7,
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
