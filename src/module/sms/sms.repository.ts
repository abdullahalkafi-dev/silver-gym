import { TSmsHistory } from "./sms.interface";
import { SmsHistory } from "./sms.model";

type QueryOptions = {
  sort?: Record<string, 1 | -1> | string;
  limit?: number;
  skip?: number;
  select?: Record<string, 0 | 1> | string;
};

export const SmsRepository = {
  createMany(payload: TSmsHistory[]) {
    return SmsHistory.insertMany(payload, { ordered: false });
  },

  findMany(filter: object = {}, options: QueryOptions = {}) {
    let query = SmsHistory.find(filter);

    if (options.select) {
      query = query.select(options.select);
    }

    if (options.sort) {
      query = query.sort(options.sort);
    }

    if (typeof options.skip === "number") {
      query = query.skip(options.skip);
    }

    if (typeof options.limit === "number") {
      query = query.limit(options.limit);
    }

    return query;
  },

  count(filter: object = {}) {
    return SmsHistory.countDocuments(filter);
  },
};
