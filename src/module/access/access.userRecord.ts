/**
 * ZKTeco F18 user record (72 bytes), as observed on the Rayerbag device:
 *
 *   0-1   uid (uint16 LE)
 *   2     role (0 = user, 14 = device admin)
 *   3-10  password
 *   11-34 name
 *   35-38 card number (uint32 LE)
 *   39    group  (every user is currently 1)   <- the ONLY byte we ever change
 *   40-47 other flags (left untouched)
 *   48-56 user id (ascii, zero terminated)
 *   57-71 zeros
 *
 * The zkteco-js `setUser()` helper must not be used: it writes the card number
 * into 2 bytes and zeroes the other fields, which would damage real records.
 */
export const USER_RECORD_SIZE = 72;
export const GROUP_BYTE_OFFSET = 39;
export const DEVICE_ADMIN_ROLE_MIN = 1;

export type TUserRecord = {
  raw: Buffer;
  uid: number;
  role: number;
  cardno: number;
  userId: string;
  group: number;
};

export const parseUserRecord = (raw: Buffer): TUserRecord => {
  if (raw.length !== USER_RECORD_SIZE) {
    throw new Error(`User record must be ${USER_RECORD_SIZE} bytes, got ${raw.length}`);
  }

  return {
    raw: Buffer.from(raw),
    uid: raw.readUInt16LE(0),
    role: raw.readUInt8(2),
    cardno: raw.readUInt32LE(35),
    userId: raw.subarray(48, 57).toString("ascii").split("\0")[0] ?? "",
    group: raw.readUInt8(GROUP_BYTE_OFFSET),
  };
};

/** Splits the blob the device returns for "get users" (4 byte header + records). */
export const splitUserBlob = (blob: Buffer): Buffer[] => {
  const records: Buffer[] = [];
  let rest = blob.subarray(4);

  while (rest.length >= USER_RECORD_SIZE) {
    records.push(Buffer.from(rest.subarray(0, USER_RECORD_SIZE)));
    rest = rest.subarray(USER_RECORD_SIZE);
  }

  return records;
};

/** Copy of the record with only the group byte changed. */
export const withGroup = (raw: Buffer, group: number): Buffer => {
  if (raw.length !== USER_RECORD_SIZE) {
    throw new Error("Invalid user record length");
  }

  if (!Number.isInteger(group) || group < 0 || group > 255) {
    throw new Error("Group must be a whole number from 0 to 255");
  }

  const next = Buffer.from(raw);
  next.writeUInt8(group, GROUP_BYTE_OFFSET);
  return next;
};

/** True when the two records are identical except for the group byte. */
export const onlyGroupDiffers = (before: Buffer, after: Buffer): boolean => {
  if (before.length !== USER_RECORD_SIZE || after.length !== USER_RECORD_SIZE) {
    return false;
  }

  for (let i = 0; i < USER_RECORD_SIZE; i++) {
    if (i !== GROUP_BYTE_OFFSET && before[i] !== after[i]) {
      return false;
    }
  }

  return true;
};
