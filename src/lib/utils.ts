import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatPrice(price: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(price)
}

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(date))
}

export function formatRelativeTime(date: Date | string): string {
  const now = new Date()
  const then = new Date(date)
  const diffInSeconds = Math.floor((now.getTime() - then.getTime()) / 1000)

  if (diffInSeconds < 60) return 'just now'
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`
  if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`
  return formatDate(date)
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

// Calculate distance between two coordinates (Haversine formula)
export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 3959 // Earth's radius in miles
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180)
}

// Fee tier calculation
export function calculateFeeTier(monthlySales: number): {
  tier: 'FREE' | 'STARTER' | 'PRO'
  feePercent: number
} {
  if (monthlySales <= 500) return { tier: 'FREE', feePercent: 0 }
  if (monthlySales <= 2000) return { tier: 'STARTER', feePercent: 2 }
  return { tier: 'PRO', feePercent: 3 }
}

export function calculatePlatformFee(amount: number, feePercent: number): number {
  return Math.round(amount * (feePercent / 100) * 100) / 100
}

// Unit display helpers
export function getUnitDisplay(unit: string, customName?: string | null): string {
  switch (unit) {
    case 'EGG':
      return 'egg'
    case 'HALF_DOZEN':
      return 'half dozen'
    case 'DOZEN':
      return 'dozen'
    case 'FLAT':
      return 'flat (30)'
    case 'CUSTOM':
      return customName || 'unit'
    default:
      return unit.toLowerCase()
  }
}
