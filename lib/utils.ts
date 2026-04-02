import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// Merges Tailwind class strings using clsx + tailwind-merge; used throughout the UI to safely combine conditional classes.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
