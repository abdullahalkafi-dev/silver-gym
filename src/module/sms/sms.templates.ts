/**
 * Fixed SMS templates. These live in code on purpose: admins can see them but
 * never edit them, so a bad edit can't break sending. Change the wording here.
 *
 * Use plain ASCII only (a normal hyphen "-", straight quotes). Any other
 * character forces Unicode SMS (70 chars/part instead of 160) and costs double.
 */

export type TSmsTemplateKey =
  | "dueReminder"
  | "holiday"
  | "birthday"
  | "paymentConfirmation"
  | "membershipExpired"
  | "welcome";

export type TSmsMessageKind = TSmsTemplateKey | "custom";

export type TSmsTemplateDefinition = {
  key: TSmsTemplateKey;
  label: string;
  text: string;
  placeholders: string[];
  /** Plain-English line shown to the admin: when this message goes out. */
  whenSent: string;
  /** Plain-English line shown to the admin: who gets it. */
  whoReceives: string;
  /** Sent automatically (has an on/off toggle) or manually only. */
  automatic: boolean;
  /** Sample values used for the preview / test message. */
  sample: Record<string, string>;
};

export const SMS_TEMPLATES: Record<TSmsTemplateKey, TSmsTemplateDefinition> = {
  dueReminder: {
    key: "dueReminder",
    label: "Monthly Due Reminder",
    text: "Dear {Member_Name}, your gym fee is due for {Due_Period}. Total Due: BDT {Due_Amount}. Please pay soon. - Silver Gym",
    placeholders: ["Member_Name", "Due_Period", "Due_Amount"],
    whenSent: "On the chosen day of every month",
    whoReceives: "Active members who have dues",
    automatic: true,
    sample: { Member_Name: "Rahim Uddin", Due_Period: "September-October", Due_Amount: "2,000" },
  },
  holiday: {
    key: "holiday",
    label: "Gym Holiday Notice",
    text: "Dear Member, Silver Gym will remain closed on {Holiday_Date} due to {Reason}. Thank you.",
    placeholders: ["Holiday_Date", "Reason"],
    whenSent: "Only when you send it yourself",
    whoReceives: "Active members (inactive optional)",
    automatic: false,
    sample: { Holiday_Date: "6-8 Jun", Reason: "Eid-ul-Adha" },
  },
  birthday: {
    key: "birthday",
    label: "Birthday Wishes",
    text: "Happy Birthday, {Member_Name}! Wishing you health, happiness and fitness. - Silver Gym",
    placeholders: ["Member_Name"],
    whenSent: "Every day, on the member's birthday",
    whoReceives: "Active members with a birth date",
    automatic: true,
    sample: { Member_Name: "Rahim Uddin" },
  },
  paymentConfirmation: {
    key: "paymentConfirmation",
    label: "Payment Confirmation",
    text: "Dear {Member_Name}, your payment of BDT {Paid_Amount} has been received successfully. Thank you! - Silver Gym",
    placeholders: ["Member_Name", "Paid_Amount"],
    whenSent: "Right after a payment is collected",
    whoReceives: "The member who paid",
    automatic: true,
    sample: { Member_Name: "Rahim Uddin", Paid_Amount: "1,000" },
  },
  membershipExpired: {
    key: "membershipExpired",
    label: "Membership Expired",
    text: "Dear {Member_Name}, your Silver Gym membership has expired. Please renew to continue your fitness journey.",
    placeholders: ["Member_Name"],
    whenSent: "When a membership automatically expires",
    whoReceives: "The member whose membership expired",
    automatic: true,
    sample: { Member_Name: "Rahim Uddin" },
  },
  welcome: {
    key: "welcome",
    label: "Welcome SMS",
    text: "Welcome to Silver Gym, {Member_Name}! Your membership is now active. Let's get fit together!",
    placeholders: ["Member_Name"],
    whenSent: "When a new member is added",
    whoReceives: "The new member (if a phone number is given)",
    automatic: true,
    sample: { Member_Name: "Rahim Uddin" },
  },
};

export const SMS_TEMPLATE_LIST = Object.values(SMS_TEMPLATES);

export const HOLIDAY_REASONS = [
  "Eid-ul-Fitr",
  "Eid-ul-Adha",
  "Durga Puja",
  "Victory Day",
  "Independence Day",
  "Maintenance",
] as const;

export const CUSTOM_MESSAGE_MAX_CHARS = 306; // 2 SMS parts of 153
export const HOLIDAY_OTHER_REASON_MAX_CHARS = 40;

const PLAIN_SMS_PATTERN = /^[\x20-\x7E\r\n]*$/;

export const isPlainSmsText = (value: string) => PLAIN_SMS_PATTERN.test(value);

/** Turn dashes and curly quotes into plain characters so a message stays plain text. */
export const sanitizeSmsText = (value: string) =>
  value
    .replace(/[‐-―−]/g, "-")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/ /g, " ")
    .trim();

export const renderSmsText = (
  text: string,
  values: Record<string, string>,
): { text: string; missing: string[] } => {
  const missing: string[] = [];
  const rendered = text.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = values[key]?.trim();
    if (!value) {
      missing.push(key);
      return "";
    }
    return value;
  });
  return { text: rendered, missing };
};

const GSM_SINGLE = 160;
const GSM_MULTI = 153;
const UNICODE_SINGLE = 70;
const UNICODE_MULTI = 67;

export const detectUnicode = (message: string) => !isPlainSmsText(message);

export const estimateSmsUnits = (message: string): number => {
  const unicode = detectUnicode(message);
  const length = Array.from(message).length;
  const single = unicode ? UNICODE_SINGLE : GSM_SINGLE;
  const multi = unicode ? UNICODE_MULTI : GSM_MULTI;
  return length <= single ? 1 : Math.ceil(length / multi);
};

/** Pretty "6-8 Jun" / "16 Dec" / "30 Dec-2 Jan" label for a holiday notice. */
export const formatHolidayDates = (from: Date, to: Date): string => {
  const fmt = (date: Date, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", ...opts }).format(date);
  const sameDay = fmt(from, { day: "numeric", month: "short", year: "numeric" }) ===
    fmt(to, { day: "numeric", month: "short", year: "numeric" });
  if (sameDay) return fmt(from, { day: "numeric", month: "short" });

  const sameMonth = fmt(from, { month: "short", year: "numeric" }) ===
    fmt(to, { month: "short", year: "numeric" });
  if (sameMonth) {
    return `${fmt(from, { day: "numeric" })}-${fmt(to, { day: "numeric", month: "short" })}`;
  }
  return `${fmt(from, { day: "numeric", month: "short" })}-${fmt(to, { day: "numeric", month: "short" })}`;
};
