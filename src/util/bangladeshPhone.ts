const BANGLADESH_LOCAL_MOBILE_PATTERN = /^01[3-9]\d{8}$/;

const stripFormatting = (value: string) => value.trim().replace(/[\s()-]/g, "");

export const normalizeBangladeshPhone = (
  value?: string | null,
): string | null => {
  if (!value?.trim()) {
    return null;
  }

  const stripped = stripFormatting(value).replace(/(?!^)\+/g, "");

  let normalized = stripped;

  if (normalized.startsWith("+880")) {
    normalized = `0${normalized.slice(4)}`;
  } else if (normalized.startsWith("880")) {
    normalized = `0${normalized.slice(3)}`;
  }

  return BANGLADESH_LOCAL_MOBILE_PATTERN.test(normalized)
    ? normalized
    : null;
};

export const isBangladeshPhone = (value?: string | null): boolean =>
  normalizeBangladeshPhone(value) !== null;
