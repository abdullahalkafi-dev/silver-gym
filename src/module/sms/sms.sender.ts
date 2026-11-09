import config from "../../config";
import { TBranchSMSSenderType } from "../branch/branch.interface";

/**
 * The two sender IDs are fixed for the whole application (not per branch).
 * A branch only chooses which style it uses: masking (brand name) or non-masking (number).
 * Change them in the server env (SMS_MASKING_SENDER_ID / SMS_NON_MASKING_SENDER_ID) and the
 * per-SMS prices (SMS_PRICE_MASKING / SMS_PRICE_NON_MASKING); branch admins can not.
 */
export type TResolvedSender = {
  type: TBranchSMSSenderType;
  /** The value sent to the provider as the sender. */
  id: string;
  label: string;
  /** Taka the provider charges for one SMS part. */
  pricePerSms: number;
};

export const resolveSender = (type: TBranchSMSSenderType): TResolvedSender =>
  type === "nonMasking"
    ? {
        type: "nonMasking",
        id: config.sms.non_masking_sender_id,
        label: "Non-masking",
        pricePerSms: config.sms.price_non_masking,
      }
    : {
        type: "masking",
        id: config.sms.masking_sender_id,
        label: "Masking",
        pricePerSms: config.sms.price_masking,
      };

/** Round to whole paisa so 18 x 0.53 never shows as 9.540000000000001. */
export const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
