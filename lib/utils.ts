import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// Merges Tailwind class strings using clsx + tailwind-merge; used throughout the UI to safely combine conditional classes.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Safely extract an error message from an unknown thrown value.
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
