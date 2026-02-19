import { RESERVED_PROTECTED_COLUMN_NAMES } from '../constants'

const RESERVED_COLUMN_NAME_SET = new Set(
  RESERVED_PROTECTED_COLUMN_NAMES.map((name) => name.toLowerCase()),
)

export function normalizeColumnName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

export function isReservedProtectedColumnName(name: string): boolean {
  return RESERVED_COLUMN_NAME_SET.has(normalizeColumnName(name).toLowerCase())
}

export function isProtectedColumn(column: { name: string; protected: boolean }): boolean {
  return column.protected || isReservedProtectedColumnName(column.name)
}
