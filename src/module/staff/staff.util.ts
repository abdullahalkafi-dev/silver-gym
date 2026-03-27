/**
 * Pad number with leading zeros
 */
function pad(n: number, digits: number): string {
  return String(n).padStart(digits, "0");
}

/**
 * Generate readable staff username options
 * 
 * Patterns:
 * - abdullah01, abdullah02...abdullah99 (zero-padded)
 * - abdullah2025, abdullah25 (year variants)
 * - abd_ullah, ab_dullah (underscore split)
 * - abdullah_pro, abdullah_x (word suffixes)
 * - the.abdullah, mr.abdullah (word prefixes)
 * - abd.ullah (dot split)
 * 
 * Returns ~60 username options ordered by readability
 */
export function generateStaffUsernameOptions(
  base: string,
  count = 60
): string[] {
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 15);

  if (!cleaned) return [];

  const options: string[] = [];

  // 1. Zero-padded numbers (most readable, Gmail-style)
  for (let i = 1; i <= 99; i++) {
    options.push(`${cleaned}${pad(i, 2)}`); // abdullah01 → abdullah99
  }

  // 2. Year variants (2025, 25, 2024, 24, etc)
  const year = new Date().getFullYear();
  for (let y = year; y >= year - 10; y--) {
    options.push(`${cleaned}${y}`); // abdullah2025
    options.push(`${cleaned}${String(y).slice(2)}`); // abdullah25
  }

  // 3. Underscore splits
  if (cleaned.length >= 6) {
    const mid = Math.floor(cleaned.length / 2);
    options.push(`${cleaned.slice(0, mid)}_${cleaned.slice(mid)}`);
    options.push(`${cleaned.slice(0, 3)}_${cleaned.slice(3)}`);
  }

  // 4. Word suffixes
  const SUFFIXES = [
    "_pro",
    "_x",
    "_hq",
    "_mg",
    "_go",
    "_ok",
    "_on",
    "_jr",
    "_sr",
    "_1st",
  ];
  SUFFIXES.forEach((s) => options.push(`${cleaned}${s}`));

  // 5. Word prefixes (Gmail style)
  const PREFIXES = ["the.", "mr.", "ms.", "its.", "hey."];
  PREFIXES.forEach((p) => options.push(`${p}${cleaned}`));

  // 6. Dot variants
  if (cleaned.length >= 5) {
    options.push(`${cleaned.slice(0, 3)}.${cleaned.slice(3)}`); // abd.ullah
  }

  // Deduplicate and return top N
  return [...new Set(options)].slice(0, count);
}

/**
 * Validate if username format is acceptable
 */
export function isValidUsername(username: string): boolean {
  // 3-30 chars, alphanumeric + dot, underscore, hyphen
  return /^[a-z0-9._-]{3,30}$/.test(username.toLowerCase());
}
