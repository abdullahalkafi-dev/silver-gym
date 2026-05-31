const BD_TZ = "Asia/Dhaka";

export const BD_OFFSET_MS = 6 * 60 * 60 * 1000;

export const toDhakaDate = (date: Date = new Date()): Date => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BD_TZ,
    year: "numeric",
    month: "2-digit",
    day: "numeric",
  }).formatToParts(date);

  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");

  return new Date(get("year"), get("month") - 1, get("day"));
};

export const getDhakaDateString = (date: Date = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: BD_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

export const getDhakaDayOfMonth = (date: Date = new Date()): number =>
  Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: BD_TZ,
      day: "numeric",
    }).format(date),
  );

export const getDhakaMonth = (date: Date = new Date()): number =>
  Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: BD_TZ,
      month: "numeric",
    }).format(date),
  );

export const getDhakaYear = (date: Date = new Date()): number =>
  Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: BD_TZ,
      year: "numeric",
    }).format(date),
  );

export const dhakaStartOfDay = (date: Date = new Date()): Date => {
  const dhaka = toDhakaDate(date);
  dhaka.setHours(0, 0, 0, 0);
  return dhaka;
};

export const dhakaStartOfMonth = (date: Date = new Date()): Date => {
  const dhaka = toDhakaDate(date);
  return new Date(dhaka.getFullYear(), dhaka.getMonth(), 1);
};

export const dhakaStartOfNextMonth = (date: Date = new Date()): Date => {
  const dhaka = toDhakaDate(date);
  return new Date(dhaka.getFullYear(), dhaka.getMonth() + 1, 1);
};

export const dhakaStartOfNextCalendarMonth = (date: Date): Date => {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
};

export const formatEnglishMonth = (date: Date, includeYear = false): string =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: BD_TZ,
    month: "long",
    ...(includeYear ? { year: "numeric" } : {}),
  }).format(date);

export const formatEnglishAmount = (amount: number): string =>
  new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(amount);
