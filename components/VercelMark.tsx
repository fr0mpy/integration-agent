export function VercelMark({ size = 16 }: { size?: number }) {
  return (
    <svg
      aria-label="Vercel logomark"
      role="img"
      viewBox="0 0 74 64"
      width={size}
      height={size * (64 / 74)}
    >
      <path
        d="M37.5896 0.25L74.5396 64.25H0.639648L37.5896 0.25Z"
        fill="currentColor"
      />
    </svg>
  )
}
